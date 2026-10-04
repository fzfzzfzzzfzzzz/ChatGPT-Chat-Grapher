import type { DiscussionMapDatabase } from "../db/database";
import { ReviewRepository } from "../db/repositories/reviewRepository";
import type {
  ConversationReviewMessage,
  ReviewCaptureReport,
  ReviewDocument,
  ReviewEntrySource,
  ReviewErrorCode,
  ReviewJob,
  ReviewJobStatus,
  ReviewModuleId,
  ReviewModuleResult,
  ReviewModuleSnapshot,
  ReviewPresetId,
  ReviewScopeType,
  ReviewVersion,
} from "../types/domain";
import type {
  StructuredAIRequest,
  StructuredAIResponse,
} from "../ai/transport";
import {
  requestStructuredAI,
  StructuredAIError,
} from "../ai/transport";
import {
  buildReviewFactExtractionPrompt,
  buildReviewPrompt,
  estimateReviewAncestorContextTokens,
  isReviewModuleId,
  limitReviewAncestorContext,
  limitReviewPromptFacts,
  orderReviewModuleIds,
  parseReviewFactsResponse,
  parseReviewResponse,
  planReviewProcessing,
  resolveReviewScope,
  type ResolvedReviewScope,
  type ReviewPromptFact,
} from "../review";
import { createId } from "../utils/id";

const ACTIVE_JOB_STATUSES = new Set<ReviewJobStatus>([
  "waiting",
  "collecting",
  "organizing",
  "generating",
]);

export type ConversationReviewAIRequester = (
  request: StructuredAIRequest,
  signal?: AbortSignal,
) => Promise<StructuredAIResponse>;

export type ConversationReviewProgressListener = (
  job: ReviewJob,
  liveVersion?: ReviewVersion,
) => void | Promise<void>;

export type StartConversationReviewInput = {
  projectId: string;
  entrySource: ReviewEntrySource;
  scopeType: ReviewScopeType;
  anchorNodeId?: string;
  selectedModuleIds: readonly ReviewModuleId[];
  presetId: ReviewPresetId;
  capture: ReviewCaptureReport;
  allowPartial: boolean;
  title?: string;
};

export type StartConversationReviewResult = {
  job: ReviewJob;
  document: ReviewDocument;
  reused: boolean;
};

export type RetryConversationReviewInput = {
  jobId: string;
  capture: ReviewCaptureReport;
  allowPartial: boolean;
};

export type RetryConversationReviewModuleInput = {
  versionId: string;
  moduleId: ReviewModuleId;
  capture: ReviewCaptureReport;
  allowPartial: boolean;
};

export type ConversationReviewServiceOptions = {
  requestAI?: ConversationReviewAIRequester;
  onProgress?: ConversationReviewProgressListener;
};

type InternalStartInput = StartConversationReviewInput & {
  documentId?: string;
  mergeBaseVersion?: ReviewVersion;
};

type Execution = {
  controller: AbortController;
  messages: ConversationReviewMessage[];
  resolved: ResolvedReviewScope;
  document: ReviewDocument;
  job: ReviewJob;
  title: string;
  liveModules: Map<ReviewModuleId, ReviewModuleResult>;
  liveEvidences: Map<string, ReviewVersion["evidences"][number]>;
  generatedAt: number;
  mergeBaseVersion?: ReviewVersion;
  promise: Promise<ReviewJob>;
};

type GeneratedReview = {
  modules: ReviewModuleResult[];
  evidences: ReviewVersion["evidences"];
  segmented: boolean;
  segmentCount: number;
  missingRanges: string[];
  providerId?: StructuredAIResponse["providerId"];
  model?: string;
};

/**
 * Background-only Conversation Review coordinator.
 *
 * Full messages live solely in the execution map and are released in `finally`.
 * IndexedDB receives only scope metadata, generated summaries, and evidence excerpts.
 */
export class ConversationReviewService {
  private readonly repository: ReviewRepository;
  private readonly requestAI: ConversationReviewAIRequester;
  private readonly onProgress: ConversationReviewProgressListener | undefined;
  private readonly executions = new Map<string, Execution>();

  constructor(
    private readonly database: DiscussionMapDatabase,
    options: ConversationReviewServiceOptions = {},
  ) {
    this.repository = new ReviewRepository(database);
    this.requestAI = options.requestAI ?? requestStructuredAI;
    this.onProgress = options.onProgress;
  }

  /** Resolve a UI preview without retaining or persisting source text. */
  async previewScope(
    input: Pick<
      StartConversationReviewInput,
      "projectId" | "scopeType" | "anchorNodeId" | "capture"
    >,
  ): Promise<ResolvedReviewScope> {
    const nodes = await this.database.nodes
      .where("projectId")
      .equals(input.projectId)
      .toArray();
    return resolveReviewScope({
      projectId: input.projectId,
      scopeType: input.scopeType,
      nodes,
      capture: input.capture,
      ...(input.anchorNodeId ? { targetNodeId: input.anchorNodeId } : {}),
      ...(input.capture.chatId ? { chatId: input.capture.chatId } : {}),
    });
  }

  async startReview(
    input: StartConversationReviewInput,
  ): Promise<StartConversationReviewResult> {
    return this.startInternal(input);
  }

  /** Recollecting the source is mandatory because completed jobs retain no transcript. */
  async retryReview(
    input: RetryConversationReviewInput,
  ): Promise<StartConversationReviewResult> {
    const previousJob = await this.repository.getJob(input.jobId);
    if (!previousJob) throw new ReviewServiceError("SOURCE_UNAVAILABLE", "找不到要重试的总结任务。");
    const document = await this.repository.getDocument(previousJob.documentId);
    if (!document) throw new ReviewServiceError("SOURCE_UNAVAILABLE", "找不到要重试的总结文档。");
    const activeVersion = document.activeVersionId
      ? await this.repository.getVersion(document.activeVersionId)
      : undefined;
    return this.startInternal({
      projectId: previousJob.projectId,
      entrySource: document.entrySource,
      scopeType: previousJob.scope.type,
      ...(previousJob.scope.anchorNodeId
        ? { anchorNodeId: previousJob.scope.anchorNodeId }
        : {}),
      selectedModuleIds: previousJob.selectedModuleIds,
      presetId: previousJob.presetId,
      capture: input.capture,
      allowPartial: input.allowPartial,
      title: activeVersion?.title ?? input.capture.conversationTitle ?? "对话总结",
      documentId: document.id,
    });
  }

  /**
   * Retries one module and appends a new immutable version which keeps all other
   * modules from the selected base version.
   */
  async retryModule(
    input: RetryConversationReviewModuleInput,
  ): Promise<StartConversationReviewResult> {
    if (!isReviewModuleId(input.moduleId)) {
      throw new ReviewServiceError("INVALID_RESPONSE", "未知的总结模块。");
    }
    const version = await this.repository.getVersion(input.versionId);
    if (!version) throw new ReviewServiceError("SOURCE_UNAVAILABLE", "找不到要重试的总结版本。");
    const document = await this.repository.getDocument(version.documentId);
    if (!document) throw new ReviewServiceError("SOURCE_UNAVAILABLE", "找不到要重试的总结文档。");
    return this.startInternal({
      projectId: version.projectId,
      entrySource: document.entrySource,
      scopeType: version.scope.type,
      ...(version.scope.anchorNodeId ? { anchorNodeId: version.scope.anchorNodeId } : {}),
      selectedModuleIds: [input.moduleId],
      presetId: "custom",
      capture: input.capture,
      allowPartial: input.allowPartial,
      title: version.title,
      documentId: document.id,
      mergeBaseVersion: version,
    });
  }

  /** Idempotent. A terminal task is returned unchanged. */
  async cancelReview(jobId: string): Promise<ReviewJob | undefined> {
    const execution = this.executions.get(jobId);
    execution?.controller.abort();
    if (execution) clearMessages(execution.messages);
    let cancelled: ReviewJob | undefined;
    await this.database.transaction("rw", this.database.reviewJobs, async () => {
      const current = await this.database.reviewJobs.get(jobId);
      if (!current) return;
      if (!ACTIVE_JOB_STATUSES.has(current.status)) {
        cancelled = current;
        return;
      }
      const now = Date.now();
      const next: ReviewJob = {
        ...current,
        status: "cancelled",
        errorCode: "CANCELLED",
        error: "总结任务已取消。",
        completedAt: now,
        updatedAt: now,
      };
      await this.database.reviewJobs.put(next);
      cancelled = next;
    });
    if (cancelled) await this.notify(cancelled);
    return cancelled;
  }

  async cancelReviewsForDocument(documentId: string): Promise<void> {
    const jobs = await this.database.reviewJobs.where("documentId").equals(documentId).toArray();
    const jobIds = new Set(jobs
      .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
      .map((job) => job.id));
    for (const [jobId, execution] of this.executions) {
      if (execution.document.id === documentId) jobIds.add(jobId);
    }
    await Promise.all([...jobIds].map((jobId) => this.cancelReview(jobId)));
  }

  async cancelReviewsForProject(projectId: string): Promise<void> {
    const jobs = await this.database.reviewJobs.where("projectId").equals(projectId).toArray();
    const jobIds = new Set(jobs
      .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
      .map((job) => job.id));
    for (const [jobId, execution] of this.executions) {
      if (execution.job.projectId === projectId) jobIds.add(jobId);
    }
    await Promise.all([...jobIds].map((jobId) => this.cancelReview(jobId)));
  }

  getJob(jobId: string): Promise<ReviewJob | undefined> {
    return this.repository.getJob(jobId);
  }

  getVersion(versionId: string): Promise<ReviewVersion | undefined> {
    return this.repository.getVersion(versionId);
  }

  /** Useful for background shutdown/tests; returns immediately for a non-local job. */
  async waitForJob(jobId: string): Promise<ReviewJob | undefined> {
    const execution = this.executions.get(jobId);
    if (execution) return execution.promise;
    return this.repository.getJob(jobId);
  }

  /** Exposed for privacy regression tests and diagnostics; contains no source text. */
  get activeExecutionCount(): number {
    return this.executions.size;
  }

  private async startInternal(
    input: InternalStartInput,
  ): Promise<StartConversationReviewResult> {
    const selectedModuleIds = orderReviewModuleIds(
      [...new Set(input.selectedModuleIds)].filter(isReviewModuleId),
    );
    // Clone at the boundary so the service has one explicit, disposable owner.
    const capture = cloneCapture(input.capture);
    const resolved = await this.previewScope({
      projectId: input.projectId,
      scopeType: input.scopeType,
      ...(input.anchorNodeId ? { anchorNodeId: input.anchorNodeId } : {}),
      capture,
    });

    let document = input.documentId
      ? await this.repository.getDocument(input.documentId)
      : undefined;
    if (input.documentId && !document) {
      clearReviewSource(capture, resolved);
      throw new ReviewServiceError("SOURCE_UNAVAILABLE", "找不到要更新的总结文档。");
    }
    if (document && !documentMatchesResolvedSource(document, input, resolved)) {
      clearReviewSource(capture, resolved);
      throw new ReviewServiceError(
        "SOURCE_UNAVAILABLE",
        "重新采集的来源与原总结范围不一致，请打开原来源会话后重试。",
      );
    }

    const existing = await this.repository.findActiveJob(
      input.projectId,
      resolved.scopeFamilyKey,
    );
    if (existing) {
      clearMessages(capture.messages);
      const document = await this.repository.getDocument(existing.documentId);
      if (!document) {
        throw new ReviewServiceError("STORAGE_FAILED", "活动任务缺少对应的总结文档。");
      }
      return { job: existing, document, reused: true };
    }

    const createdDocument = !document;
    document ??= await this.repository.createDocument({
      projectId: input.projectId,
      chatId: resolved.scope.chatId,
      scopeFamilyKey: resolved.scopeFamilyKey,
      entrySource: input.entrySource,
    });

    let job: ReviewJob;
    try {
      const createdJob = await this.repository.createJobOnce({
        projectId: input.projectId,
        documentId: document.id,
        scopeFamilyKey: resolved.scopeFamilyKey,
        scope: resolved.scope,
        selectedModuleIds,
        presetId: input.presetId,
      });
      job = createdJob.job;
      if (!createdJob.created) {
        clearMessages(capture.messages);
        if (createdDocument && job.documentId !== document.id) {
          await this.repository.deleteDocument(document.id).catch(() => undefined);
        }
        const winningDocument = await this.repository.getDocument(job.documentId);
        if (!winningDocument) {
          throw new ReviewServiceError("STORAGE_FAILED", "活动任务缺少对应的总结文档。");
        }
        return { job, document: winningDocument, reused: true };
      }
    } catch (error) {
      clearMessages(capture.messages);
      if (createdDocument) await this.repository.deleteDocument(document.id).catch(() => undefined);
      throw error;
    }

    // Another start may have won between the explicit lookup and createJob.
    if (job.documentId !== document.id) {
      clearMessages(capture.messages);
      if (createdDocument) await this.repository.deleteDocument(document.id);
      const winningDocument = await this.repository.getDocument(job.documentId);
      if (!winningDocument) {
        throw new ReviewServiceError("STORAGE_FAILED", "活动任务缺少对应的总结文档。");
      }
      return { job, document: winningDocument, reused: true };
    }

    const execution = {} as Execution;
    execution.controller = new AbortController();
    execution.messages = resolved.messages.map(cloneMessage);
    execution.resolved = {
      ...resolved,
      messages: execution.messages,
      nodes: resolved.nodes.map((node) => ({ ...node })),
      ancestorContext: limitReviewAncestorContext(resolved.ancestorContext),
      issues: resolved.issues.map((issue) => ({ ...issue })),
    };
    execution.document = document;
    execution.job = job;
    execution.title = normalizeTitle(
      input.title ?? capture.conversationTitle ?? input.mergeBaseVersion?.title ?? "对话总结",
    );
    execution.liveModules = new Map(selectedModuleIds.map((moduleId) => [
      moduleId,
      pendingModule(moduleId),
    ]));
    execution.liveEvidences = new Map();
    execution.generatedAt = Date.now();
    if (input.mergeBaseVersion) execution.mergeBaseVersion = cloneVersion(input.mergeBaseVersion);
    execution.promise = Promise.resolve(job);

    clearMessages(capture.messages);
    this.executions.set(job.id, execution);
    execution.promise = Promise.resolve()
      .then(() => this.execute(execution, input.allowPartial))
      .catch(async (error: unknown) => {
        if (isCancellation(error) || execution.controller.signal.aborted) {
          return (await this.cancelReview(job.id)) ?? job;
        }
        return this.failJob(job.id, error);
      })
      .finally(() => {
        clearMessages(execution.messages);
        if (execution.mergeBaseVersion) clearVersionClone(execution.mergeBaseVersion);
        if (this.executions.get(job.id) === execution) this.executions.delete(job.id);
      });

    return { job, document, reused: false };
  }

  private async execute(execution: Execution, allowPartial: boolean): Promise<ReviewJob> {
    const { job, resolved, messages } = execution;
    if (!job.selectedModuleIds.length) {
      throw new ReviewServiceError("EMPTY_SCOPE", "请至少选择一个总结模块。");
    }
    if (!messages.length) {
      throw new ReviewServiceError("EMPTY_SCOPE", "当前范围没有可用于总结的完整消息。");
    }
    const relationshipMissing = resolved.issues.some((issue) =>
      issue.code === "TARGET_NOT_FOUND"
      || issue.code === "MISSING_PARENT"
      || issue.code === "RELATIONSHIP_CYCLE"
    );
    if (relationshipMissing && !allowPartial) {
      throw new ReviewServiceError(
        "MISSING_RELATIONSHIP",
        "节点关系不完整；确认生成部分结果后才能继续。",
      );
    }
    if (resolved.scope.completeness === "partial" && !allowPartial) {
      throw new ReviewServiceError(
        "SOURCE_UNAVAILABLE",
        "总结来源不完整；确认生成部分结果后才能继续。",
      );
    }

    const plan = planReviewProcessing({
      messages,
      selectedModuleIds: job.selectedModuleIds,
      additionalInputTokens: estimateReviewAncestorContextTokens(resolved.ancestorContext),
    });
    if (plan.strategy === "blocked") {
      throw new ReviewServiceError(
        "SOURCE_TOO_LARGE",
        plan.blockedReason === "OVERSIZED_MESSAGE"
          ? "单条消息过长，请缩小范围后重试。"
          : "对话超过 20 个处理分段，请缩小范围后重试。",
      );
    }

    const total = plan.strategy === "direct"
      ? 1
      : plan.chunks.length + plan.moduleBatches.length;
    await this.transition(job.id, execution, {
      status: "organizing",
      startedAt: Date.now(),
      progress: { current: 0, total, message: "正在整理总结范围" },
    });
    await this.transition(job.id, execution, {
      status: "generating",
      progress: { current: 0, total, message: "正在生成总结" },
    });

    const generated = plan.strategy === "direct"
      ? await this.generateDirect(execution, total)
      : await this.generateChunked(execution, plan.chunks, plan.moduleBatches, total);
    const merged = execution.mergeBaseVersion
      ? mergeRetriedVersion(execution.mergeBaseVersion, generated, job.selectedModuleIds)
      : generated;
    const hasFailedModules = merged.modules.some(({ state }) => state === "failed");
    const isPartial = resolved.scope.completeness === "partial"
      || merged.missingRanges.length > 0
      || hasFailedModules;
    return this.commitVersion(execution, merged, isPartial ? "partial" : "completed", total);
  }

  private async generateDirect(execution: Execution, total: number): Promise<GeneratedReview> {
    const prompt = buildReviewPrompt({
      selectedModuleIds: execution.job.selectedModuleIds,
      messages: execution.messages,
      scope: execution.resolved.scope,
      ancestorContext: execution.resolved.ancestorContext,
    });
    await this.markModules(execution, execution.job.selectedModuleIds, "generating", 0, total);
    const response = await this.callAI(prompt, execution.controller.signal);
    await this.assertActive(execution);
    const parsed = parseReviewResponse(
      response.content,
      execution.job.selectedModuleIds,
      execution.messages,
    );
    if (parsed.modules.every(({ state }) => state === "failed")) {
      throw new ReviewServiceError("INVALID_RESPONSE", "模型未返回任何有效总结模块。");
    }
    parsed.modules.forEach((module) => execution.liveModules.set(module.moduleId, cloneModule(module)));
    parsed.evidences.forEach((evidence) => execution.liveEvidences.set(evidence.id, structuredClone(evidence)));
    await this.markModuleResults(execution, parsed.modules, 1, total, "总结生成完成");
    return {
      modules: parsed.modules,
      evidences: parsed.evidences,
      segmented: false,
      segmentCount: 1,
      missingRanges: [],
      providerId: response.providerId,
      model: response.model,
    };
  }

  private async generateChunked(
    execution: Execution,
    chunks: ReturnType<typeof planReviewProcessing>["chunks"],
    moduleBatches: ReviewModuleId[][],
    total: number,
  ): Promise<GeneratedReview> {
    const facts: ReviewPromptFact[] = [];
    const missingRanges: string[] = [];
    let completedSteps = 0;
    let successfulChunks = 0;
    let firstError: unknown;
    let providerId: StructuredAIResponse["providerId"] | undefined;
    let model: string | undefined;

    for (const chunk of chunks) {
      await this.assertActive(execution);
      const prompt = buildReviewFactExtractionPrompt(
        chunk.messages,
        chunk.index,
        chunks.length,
      );
      try {
        const response = await this.callAI(prompt, execution.controller.signal);
        providerId ??= response.providerId;
        model ??= response.model;
        const parsed = parseReviewFactsResponse(response.content, chunk.messages);
        const invalid = parsed.issues.some((issue) =>
          issue.code === "INVALID_JSON" || issue.code === "INVALID_ROOT"
        );
        if (invalid) throw new ReviewServiceError("INVALID_RESPONSE", "事实分段返回了非法结构。");
        facts.push(...parsed.facts);
        successfulChunks += 1;
      } catch (error) {
        if (isCancellation(error) || execution.controller.signal.aborted) throw error;
        firstError ??= error;
        missingRanges.push(formatMissingRange(chunk));
      }
      completedSteps += 1;
      await this.transition(execution.job.id, execution, {
        progress: {
          current: completedSteps,
          total,
          message: `已整理 ${completedSteps}/${chunks.length} 个消息分段`,
        },
      });
    }
    if (!successfulChunks) throw firstError ?? new ReviewServiceError(
      "INVALID_RESPONSE",
      "所有消息分段均整理失败。",
    );

    const dedupedFacts = limitReviewPromptFacts(dedupeFacts(facts));
    const resultsByModule = new Map<ReviewModuleId, ReviewModuleResult>();
    const evidenceById = new Map<string, ReviewVersion["evidences"][number]>();
    let successfulModules = 0;
    for (const batch of moduleBatches) {
      await this.markModules(execution, batch, "generating", completedSteps, total);
      const prompt = buildReviewPrompt({
        selectedModuleIds: batch,
        facts: dedupedFacts,
        scope: execution.resolved.scope,
        ancestorContext: execution.resolved.ancestorContext,
      });
      let batchResults: ReviewModuleResult[];
      try {
        const response = await this.callAI(prompt, execution.controller.signal);
        providerId ??= response.providerId;
        model ??= response.model;
        const parsed = parseReviewResponse(response.content, batch, execution.messages);
        batchResults = parsed.modules;
        parsed.evidences.forEach((evidence) => {
          evidenceById.set(evidence.id, evidence);
          execution.liveEvidences.set(evidence.id, structuredClone(evidence));
        });
      } catch (error) {
        if (isCancellation(error) || execution.controller.signal.aborted) throw error;
        firstError ??= error;
        batchResults = batch.map((moduleId) => failedModule(moduleId, safeErrorMessage(error)));
      }
      for (const result of batchResults) {
        resultsByModule.set(result.moduleId, result);
        execution.liveModules.set(result.moduleId, cloneModule(result));
        if (result.state !== "failed") successfulModules += 1;
      }
      completedSteps += 1;
      await this.markModuleResults(
        execution,
        batchResults,
        completedSteps,
        total,
        `已生成 ${Math.min(completedSteps - chunks.length, moduleBatches.length)}/${moduleBatches.length} 组模块`,
      );
    }
    if (!successfulModules) {
      throw firstError ?? new ReviewServiceError("INVALID_RESPONSE", "所有总结模块均生成失败。");
    }

    const modules = execution.job.selectedModuleIds.map((moduleId) =>
      resultsByModule.get(moduleId) ?? failedModule(moduleId, "模型响应缺少此模块。")
    );
    return {
      modules,
      evidences: [...evidenceById.values()].sort(compareEvidence),
      segmented: true,
      segmentCount: chunks.length,
      missingRanges,
      ...(providerId ? { providerId } : {}),
      ...(model ? { model } : {}),
    };
  }

  private async callAI(
    prompt: { systemPrompt: string; userPrompt: string },
    signal: AbortSignal,
  ): Promise<StructuredAIResponse> {
    if (signal.aborted) throw new ReviewServiceError("CANCELLED", "总结任务已取消。");
    return this.requestAI(
      { system: prompt.systemPrompt, user: prompt.userPrompt, maxOutputTokens: 8_192 },
      signal,
    );
  }

  private async markModules(
    execution: Execution,
    moduleIds: readonly ReviewModuleId[],
    state: ReviewModuleResult["state"],
    current: number,
    total: number,
  ): Promise<void> {
    moduleIds.forEach((moduleId) => {
      const currentResult = execution.liveModules.get(moduleId) ?? pendingModule(moduleId);
      execution.liveModules.set(moduleId, { ...currentResult, state });
    });
    const existing = await this.repository.getJob(execution.job.id);
    const moduleStates = { ...(existing?.moduleStates ?? execution.job.moduleStates) };
    moduleIds.forEach((moduleId) => { moduleStates[moduleId] = state; });
    await this.transition(execution.job.id, execution, {
      moduleStates,
      progress: { current, total, message: "正在生成所选模块" },
    });
  }

  private async markModuleResults(
    execution: Execution,
    results: readonly ReviewModuleResult[],
    current: number,
    total: number,
    message: string,
  ): Promise<void> {
    const existing = await this.repository.getJob(execution.job.id);
    const moduleStates = { ...(existing?.moduleStates ?? execution.job.moduleStates) };
    results.forEach(({ moduleId, state }) => { moduleStates[moduleId] = state; });
    await this.transition(execution.job.id, execution, {
      moduleStates,
      progress: { current, total, message },
    });
  }

  private async transition(
    jobId: string,
    execution: Execution,
    changes: Partial<ReviewJob>,
  ): Promise<ReviewJob> {
    if (execution.controller.signal.aborted) throw cancellationError();
    let next: ReviewJob | undefined;
    await this.database.transaction("rw", this.database.reviewJobs, async () => {
      const current = await this.database.reviewJobs.get(jobId);
      if (!current || !ACTIVE_JOB_STATUSES.has(current.status)) return;
      next = {
        ...current,
        ...changes,
        id: current.id,
        projectId: current.projectId,
        documentId: current.documentId,
        createdAt: current.createdAt,
        updatedAt: Date.now(),
      };
      await this.database.reviewJobs.put(next);
    });
    if (!next) throw cancellationError();
    execution.job = next;
    await this.notify(next);
    return next;
  }

  private async assertActive(execution: Execution): Promise<void> {
    if (execution.controller.signal.aborted) throw cancellationError();
    const current = await this.repository.getJob(execution.job.id);
    if (!current || !ACTIVE_JOB_STATUSES.has(current.status)) throw cancellationError();
  }

  /** Atomically checks cancellation, appends the version, and completes the job. */
  private async commitVersion(
    execution: Execution,
    generated: GeneratedReview,
    status: "completed" | "partial",
    total: number,
  ): Promise<ReviewJob> {
    if (execution.controller.signal.aborted) throw cancellationError();
    let completedJob: ReviewJob | undefined;
    let abortTransaction: (() => void) | undefined;
    try {
      await this.database.transaction(
        "rw",
        this.database.reviewJobs,
        this.database.reviewVersions,
        this.database.reviewDocuments,
        async (transaction) => {
          abortTransaction = () => {
            if (transaction.active) transaction.abort();
          };
          execution.controller.signal.addEventListener("abort", abortTransaction, { once: true });
          assertNotAborted(execution);
          const currentJob = await this.database.reviewJobs.get(execution.job.id);
          if (!currentJob || !ACTIVE_JOB_STATUSES.has(currentJob.status)) return;
          assertNotAborted(execution);
          const document = await this.database.reviewDocuments.get(currentJob.documentId);
          if (!document) throw new ReviewServiceError("STORAGE_FAILED", "总结文档已不存在。");
          assertNotAborted(execution);
          const versions = await this.database.reviewVersions
            .where("documentId")
            .equals(document.id)
            .toArray();
          assertNotAborted(execution);
          const now = Date.now();
          const version: ReviewVersion = {
            id: createId("review-version"),
            documentId: document.id,
            projectId: currentJob.projectId,
            version: versions.reduce((max, item) => Math.max(max, item.version), 0) + 1,
            title: execution.title,
            scope: execution.resolved.scope,
            moduleOrder: generated.modules.map(({ moduleId }) => moduleId),
            modules: generated.modules,
            evidences: generated.evidences,
            segmented: generated.segmented,
            segmentCount: generated.segmentCount,
            missingRanges: generated.missingRanges,
            ...(generated.providerId ? { providerId: generated.providerId } : {}),
            ...(generated.model ? { model: generated.model } : {}),
            generatedAt: now,
            updatedAt: now,
          };
          const moduleStates = { ...currentJob.moduleStates };
          generated.modules.forEach(({ moduleId, state: moduleState }) => {
            moduleStates[moduleId] = moduleState;
          });
          completedJob = {
            ...currentJob,
            status,
            progress: { current: total, total, message: status === "completed" ? "总结完成" : "部分总结完成" },
            moduleStates,
            completedAt: now,
            updatedAt: now,
          };
          assertNotAborted(execution);
          await this.database.reviewVersions.add(version);
          assertNotAborted(execution);
          await this.database.reviewDocuments.put({
            ...document,
            activeVersionId: version.id,
            updatedAt: now,
          });
          assertNotAborted(execution);
          await this.database.reviewJobs.put(completedJob);
          assertNotAborted(execution);
        },
      );
    } finally {
      if (abortTransaction) {
        execution.controller.signal.removeEventListener("abort", abortTransaction);
      }
    }
    if (!completedJob) throw cancellationError();
    await this.notify(completedJob);
    return completedJob;
  }

  private async failJob(jobId: string, error: unknown): Promise<ReviewJob> {
    const mapped = mapError(error);
    let failed: ReviewJob | undefined;
    await this.database.transaction("rw", this.database.reviewJobs, async () => {
      const current = await this.database.reviewJobs.get(jobId);
      if (!current) throw mapped;
      if (!ACTIVE_JOB_STATUSES.has(current.status)) {
        failed = current;
        return;
      }
      const now = Date.now();
      failed = {
        ...current,
        status: mapped.code === "CANCELLED" ? "cancelled" : "failed",
        errorCode: mapped.code,
        error: mapped.message,
        completedAt: now,
        updatedAt: now,
      };
      await this.database.reviewJobs.put(failed);
    });
    if (!failed) throw mapped;
    await this.notify(failed);
    return failed;
  }

  private async notify(job: ReviewJob): Promise<void> {
    if (!this.onProgress) return;
    try {
      const execution = this.executions.get(job.id);
      await this.onProgress(
        job,
        execution && ACTIVE_JOB_STATUSES.has(job.status)
          ? buildLiveVersion(execution)
          : undefined,
      );
    } catch {
      // UI broadcasts must never change task outcome.
    }
  }
}

export class ReviewServiceError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewServiceError";
  }
}

function cloneCapture(capture: ReviewCaptureReport): ReviewCaptureReport {
  return {
    chatId: capture.chatId,
    ...(capture.conversationTitle ? { conversationTitle: capture.conversationTitle } : {}),
    messages: capture.messages.map(cloneMessage),
    complete: capture.complete,
    missingSourceIds: [...capture.missingSourceIds],
    ...(capture.stoppedReason ? { stoppedReason: capture.stoppedReason } : {}),
  };
}

function cloneMessage(message: ConversationReviewMessage): ConversationReviewMessage {
  return {
    ...message,
    locator: { ...message.locator },
    ...(message.branchPath ? { branchPath: [...message.branchPath] } : {}),
  };
}

function cloneVersion(version: ReviewVersion): ReviewVersion {
  return {
    ...version,
    scope: {
      ...version.scope,
      nodeIds: [...version.scope.nodeIds],
      messageSourceIds: [...version.scope.messageSourceIds],
      missingSourceIds: [...version.scope.missingSourceIds],
    },
    moduleOrder: [...version.moduleOrder],
    modules: version.modules.map(cloneModule),
    evidences: version.evidences.map((evidence) => ({
      ...evidence,
      locator: { ...evidence.locator },
      ...(evidence.branchPath ? { branchPath: [...evidence.branchPath] } : {}),
    })),
    missingRanges: [...version.missingRanges],
    ...(version.moduleFeedback ? { moduleFeedback: { ...version.moduleFeedback } } : {}),
  };
}

function cloneModule(module: ReviewModuleResult): ReviewModuleResult {
  return {
    ...module,
    generated: cloneSnapshot(module.generated),
    current: cloneSnapshot(module.current),
    editHistory: module.editHistory.map(cloneSnapshot),
  };
}

function cloneSnapshot(snapshot: ReviewModuleSnapshot): ReviewModuleSnapshot {
  return {
    overview: snapshot.overview,
    items: snapshot.items.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds] })),
    ...(snapshot.branchCandidates
      ? { branchCandidates: snapshot.branchCandidates.map((candidate) => ({ ...candidate })) }
      : {}),
  };
}

function clearMessages(messages: ConversationReviewMessage[]): void {
  for (const message of messages) {
    message.content = "";
    message.branchPath?.splice(0);
  }
  messages.splice(0);
}

function clearReviewSource(
  capture: ReviewCaptureReport,
  resolved: ResolvedReviewScope,
): void {
  clearMessages(resolved.messages);
  clearMessages(capture.messages);
}

function documentMatchesResolvedSource(
  document: ReviewDocument,
  input: Pick<InternalStartInput, "projectId" | "capture">,
  resolved: ResolvedReviewScope,
): boolean {
  return document.projectId === input.projectId
    && document.chatId === input.capture.chatId
    && document.chatId === resolved.scope.chatId
    && document.scopeFamilyKey === resolved.scopeFamilyKey;
}

function assertNotAborted(execution: Execution): void {
  if (execution.controller.signal.aborted) throw cancellationError();
}

function clearVersionClone(version: ReviewVersion): void {
  version.modules.splice(0);
  version.evidences.splice(0);
  version.moduleOrder.splice(0);
  version.missingRanges.splice(0);
}

function mergeRetriedVersion(
  base: ReviewVersion,
  generated: GeneratedReview,
  retriedModuleIds: readonly ReviewModuleId[],
): GeneratedReview {
  const replacements = new Map(generated.modules.map((module) => [module.moduleId, module]));
  const retried = new Set(retriedModuleIds);
  const moduleOrder = orderReviewModuleIds([
    ...base.moduleOrder,
    ...retriedModuleIds,
  ]);
  const modules = moduleOrder.map((moduleId) => {
    const replacement = replacements.get(moduleId);
    if (replacement) return replacement;
    const existing = base.modules.find((module) => module.moduleId === moduleId);
    return existing ? cloneModule(existing) : failedModule(moduleId, "历史版本缺少此模块。");
  });
  const evidenceById = new Map(base.evidences.map((evidence) => [evidence.id, { ...evidence }]));
  for (const evidence of generated.evidences) evidenceById.set(evidence.id, evidence);
  // Keep historical evidence only when an untouched module can still reference it.
  const usedIds = new Set<string>();
  for (const module of modules) {
    if (retried.has(module.moduleId)) {
      module.current.items.forEach((item) => item.evidenceIds.forEach((id) => usedIds.add(id)));
      continue;
    }
    module.current.items.forEach((item) => item.evidenceIds.forEach((id) => usedIds.add(id)));
  }
  return {
    ...generated,
    modules,
    evidences: [...evidenceById.values()].filter(({ id }) => usedIds.has(id)).sort(compareEvidence),
  };
}

function failedModule(moduleId: ReviewModuleId, error: string): ReviewModuleResult {
  const generated: ReviewModuleSnapshot = { overview: "", items: [] };
  return {
    moduleId,
    state: "failed",
    generated,
    current: { overview: "", items: [] },
    editHistory: [],
    error: error.slice(0, 500),
  };
}

function pendingModule(moduleId: ReviewModuleId): ReviewModuleResult {
  return {
    moduleId,
    state: "queued",
    generated: { overview: "", items: [] },
    current: { overview: "", items: [] },
    editHistory: [],
  };
}

function buildLiveVersion(execution: Execution): ReviewVersion {
  const moduleOrder = [...execution.job.selectedModuleIds];
  return {
    id: `review-live:${execution.job.id}:${execution.job.progress.current}:${moduleOrder
      .map((moduleId) => execution.liveModules.get(moduleId)?.state ?? "queued")
      .join(".")}`,
    documentId: execution.document.id,
    projectId: execution.job.projectId,
    version: 0,
    title: execution.title,
    scope: structuredClone(execution.resolved.scope),
    moduleOrder,
    modules: moduleOrder.map((moduleId) => cloneModule(
      execution.liveModules.get(moduleId) ?? pendingModule(moduleId),
    )),
    evidences: [...execution.liveEvidences.values()].map((evidence) => structuredClone(evidence)),
    segmented: execution.job.progress.total > 1,
    segmentCount: 0,
    missingRanges: [],
    generatedAt: execution.generatedAt,
    updatedAt: Date.now(),
  };
}

function formatMissingRange(
  chunk: ReturnType<typeof planReviewProcessing>["chunks"][number],
): string {
  const primaryOffset = Math.max(0, chunk.primaryStartMessageIndex - chunk.startMessageIndex);
  const primaryLength = chunk.primaryEndMessageIndex - chunk.primaryStartMessageIndex + 1;
  const first = chunk.messages[primaryOffset]?.ordinal;
  const last = chunk.messages[primaryOffset + Math.max(0, primaryLength - 1)]?.ordinal;
  if (first !== undefined && last !== undefined) return `${first}-${last}`;
  return `${chunk.primaryStartMessageIndex}-${chunk.primaryEndMessageIndex}`;
}

function dedupeFacts(facts: readonly ReviewPromptFact[]): ReviewPromptFact[] {
  const seen = new Set<string>();
  const deduped: ReviewPromptFact[] = [];
  for (const fact of facts) {
    const sourceIds = [...new Set(fact.sourceIds)].sort();
    const key = `${fact.text.trim().toLocaleLowerCase()}\u0000${sourceIds.join("\u0001")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...fact,
      sourceIds,
      ...(fact.branchPath ? { branchPath: [...fact.branchPath] } : {}),
    });
  }
  return deduped;
}

function compareEvidence(
  left: ReviewVersion["evidences"][number],
  right: ReviewVersion["evidences"][number],
): number {
  return left.ordinal - right.ordinal || left.id.localeCompare(right.id);
}

function normalizeTitle(value: string): string {
  return [...value.replace(/\s+/g, " ").trim()].slice(0, 160).join("") || "对话总结";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "总结模块生成失败。";
}

function mapError(error: unknown): ReviewServiceError {
  if (error instanceof ReviewServiceError) return error;
  if (error instanceof StructuredAIError) return new ReviewServiceError(error.code, error.message);
  if (isCancellation(error)) return cancellationError();
  return new ReviewServiceError("STORAGE_FAILED", safeErrorMessage(error));
}

function isCancellation(error: unknown): boolean {
  return error instanceof ReviewServiceError && error.code === "CANCELLED"
    || error instanceof StructuredAIError && error.code === "CANCELLED"
    || Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function cancellationError(): ReviewServiceError {
  return new ReviewServiceError("CANCELLED", "总结任务已取消。");
}
