import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { recommendParent, testAIProvider } from "../ai/client";
import { isAIProviderId } from "../ai/providers";
import {
  conversationUrlForChat,
  getConversationId,
} from "../adapters/chatgpt/getConversation";
import { db } from "../db/database";
import {
  ConversationReviewService,
  ReviewServiceError,
} from "../graph/conversationReviewService";
import { TabDiscussionSession } from "../graph/tabDiscussionSession";
import { fallbackSummary, DiscussionService } from "../graph/discussionService";
import {
  executeFloatingPanelCommand,
  type FloatingPanelCommandMessage,
} from "../graph/floatingPanelCommands";
import {
  buildFloatingPanelState,
  emptyFloatingPanelState,
} from "../graph/floatingPanelState";
import { getCurrentPath } from "../graph/questionTree";
import { initializeSidebarBehavior, openDiscussionDetail } from "../platform/sidebar";
import { requestActiveProviderPermission } from "../platform/providerPermissions";
import { isReviewModuleId, isReviewPresetId } from "../review/catalog";
import { getAISettings } from "../settings/storage";
import type {
  BuildCurrentPageGraphResponse,
  CaptureQuestionResponse,
  ExtensionMessage,
  FloatingPanelState,
  LocateQuestionResponse,
  NavigateToNodeResponse,
  OpenReviewSourceResponse,
  PanelActionContext,
  PanelActionResponse,
  PanelQuestionSource,
  ReviewJobResponse,
  ReviewMutationResponse,
  ReviewSourceUploadMetadata,
  ReviewSourceUploadResponse,
  ReviewStateResponse,
  StartReviewJobRequest,
  TestAIProviderResponse,
} from "../shared/messages";
import {
  isConversationReviewMessage,
  isExtensionMessage,
  isReviewSourceUploadMetadata,
  isTestAIProviderMessage,
} from "../shared/messages";
import {
  canCaptureQuestion,
} from "../shared/captureService";
import { sanitizeQuestionReferences } from "../shared/questionReferences";
import type {
  CapturedQuestion,
  ConversationReviewMessage,
  QuestionCandidate,
  QuestionNode,
  ReviewCaptureReport,
  ReviewJob,
  ReviewVersion,
} from "../types/domain";

const SELECTED_PROJECT_KEY = "selectedProjectId";
const REQUESTED_SIDE_PANEL_VIEW_KEY = "requestedSidePanelView";
const service = new DiscussionService(db);
const reviewService = new ConversationReviewService(db, {
  onProgress: (job, liveVersion) => broadcastReviewJobUpdate(job, liveVersion),
});
const tabDiscussionSession = new TabDiscussionSession(
  service.projects,
  browser.storage.session,
);

type ReviewSourceUpload = {
  metadata: ReviewSourceUploadMetadata;
  totalChunks: number;
  chunks: Map<number, ConversationReviewMessage[]>;
  serializedChunkChars: Map<number, number>;
  createdAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
};

const REVIEW_UPLOAD_TTL_MS = 5 * 60_000;
const REVIEW_UPLOAD_MAX_ACTIVE = 8;
const REVIEW_UPLOAD_MAX_CHUNKS = 400;
const REVIEW_UPLOAD_MAX_MESSAGES_PER_CHUNK = 40;
const REVIEW_UPLOAD_MAX_BEGIN_CHARS = 96_000;
const REVIEW_UPLOAD_MAX_CHUNK_CHARS = 96_000;
const REVIEW_UPLOAD_MAX_COMMIT_CHARS = 32_000;
const REVIEW_UPLOAD_MAX_CHARS = 4_000_000;
const REVIEW_UPLOAD_MAX_ID_CHARS = 256;
const reviewSourceUploads = new Map<string, ReviewSourceUpload>();

async function broadcastReviewJobUpdate(job: ReviewJob, liveVersion?: ReviewVersion): Promise<void> {
  const document = await service.reviews.getDocument(job.documentId);
  const version = liveVersion ?? (document?.activeVersionId
    ? await service.reviews.getVersion(document.activeVersionId)
    : undefined);
  await browser.runtime.sendMessage({
    type: "REVIEW_JOB_UPDATED",
    job,
    ...(version ? { version } : {}),
  } satisfies ExtensionMessage).catch(() => undefined);
  if (job.status === "completed" || job.status === "partial") {
    await browser.runtime.sendMessage({
      type: "REVIEW_DOCUMENTS_UPDATED",
      projectId: job.projectId,
    } satisfies ExtensionMessage).catch(() => undefined);
  }
}

function discardExpiredReviewUploads(now = Date.now()): void {
  for (const [uploadId, upload] of reviewSourceUploads) {
    if (now - upload.createdAt <= REVIEW_UPLOAD_TTL_MS) continue;
    clearUploadedSource(upload);
    reviewSourceUploads.delete(uploadId);
  }
}

function clearUploadedSource(upload: ReviewSourceUpload): void {
  cancelReviewUploadExpiry(upload);
  for (const messages of upload.chunks.values()) {
    for (const message of messages) message.content = "";
    messages.splice(0);
  }
  upload.chunks.clear();
  upload.serializedChunkChars.clear();
}

function cancelReviewUploadExpiry(upload: ReviewSourceUpload): void {
  const expiryTimer = upload.expiryTimer;
  delete upload.expiryTimer;
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
}

function scheduleReviewUploadExpiry(uploadId: string, upload: ReviewSourceUpload): void {
  upload.expiryTimer = setTimeout(() => {
    if (reviewSourceUploads.get(uploadId) !== upload) return;
    reviewSourceUploads.delete(uploadId);
    clearUploadedSource(upload);
  }, REVIEW_UPLOAD_TTL_MS);
}

function discardReviewSourceUpload(uploadId: string): void {
  const upload = reviewSourceUploads.get(uploadId);
  if (!upload) return;
  reviewSourceUploads.delete(uploadId);
  clearUploadedSource(upload);
}

function serializedCharLength(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized.length : undefined;
  } catch {
    return undefined;
  }
}

function isBoundedUploadId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= REVIEW_UPLOAD_MAX_ID_CHARS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2_048;
}

function isStartReviewJobRequest(value: unknown): value is StartReviewJobRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "projectId",
    "entrySource",
    "scopeType",
    "anchorNodeId",
    "moduleIds",
    "presetId",
    "allowPartial",
    "retryJobId",
    "retryModuleId",
  ])) return false;
  if (!isBoundedId(value.projectId)) return false;
  if (
    value.entrySource !== "floating_panel"
    && value.entrySource !== "side_panel"
    && value.entrySource !== "node_menu"
  ) return false;
  if (
    value.scopeType !== "current_branch"
    && value.scopeType !== "conversation"
    && value.scopeType !== "node_context"
  ) return false;
  if (value.anchorNodeId !== undefined && !isBoundedId(value.anchorNodeId)) return false;
  if (
    !Array.isArray(value.moduleIds)
    || value.moduleIds.length < 1
    || value.moduleIds.length > 33
    || !value.moduleIds.every(isReviewModuleId)
    || new Set(value.moduleIds).size !== value.moduleIds.length
  ) return false;
  if (!isReviewPresetId(value.presetId) || typeof value.allowPartial !== "boolean") return false;
  if (value.retryJobId !== undefined && !isBoundedId(value.retryJobId)) return false;
  if (value.retryModuleId !== undefined && !isReviewModuleId(value.retryModuleId)) return false;
  if (value.retryModuleId !== undefined && value.retryJobId === undefined) return false;
  return true;
}

function reviewErrorResponse(error: unknown): { ok: false; code?: string; error: string } {
  if (error instanceof ReviewServiceError) {
    return { ok: false, code: error.code, error: error.message };
  }
  return {
    ok: false,
    code: "STORAGE_FAILED",
    error: error instanceof Error ? error.message : "总结操作失败，请重试。",
  };
}

async function getProjectReviewState(projectId: string): Promise<ReviewStateResponse> {
  const [documents, versions, jobs] = await Promise.all([
    service.reviews.listDocumentsForProject(projectId),
    db.reviewVersions.where("projectId").equals(projectId).toArray(),
    service.reviews.listJobsForProject(projectId),
  ]);
  return { ok: true, documents, versions, jobs };
}

async function getReviewJobResponse(jobId: string): Promise<ReviewJobResponse> {
  const job = await reviewService.getJob(jobId);
  if (!job) return { ok: false, error: "找不到总结任务。" };
  const document = await service.reviews.getDocument(job.documentId);
  const version = document?.activeVersionId
    ? await service.reviews.getVersion(document.activeVersionId)
    : undefined;
  return {
    ok: true,
    job,
    ...(document ? { document } : {}),
    ...(version ? { version } : {}),
  };
}

async function openReviewSourceConversation(
  chatId: string,
  collect: boolean,
): Promise<OpenReviewSourceResponse> {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) {
    return { ok: false, code: "SOURCE_UNAVAILABLE", error: "总结来源缺少会话标识。" };
  }
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  let targetTab = activeTab?.url && getConversationId(activeTab.url) === normalizedChatId
    ? activeTab
    : await browser.tabs.create({
        url: conversationUrlForChat(normalizedChatId),
        active: true,
      });
  if (targetTab.id === undefined) {
    return { ok: false, code: "SOURCE_UNAVAILABLE", error: "无法打开总结来源会话。" };
  }
  if (targetTab.windowId !== undefined) {
    await browser.windows.update(targetTab.windowId, { focused: true }).catch(() => undefined);
  }
  await browser.tabs.update(targetTab.id, { active: true }).catch(() => undefined);

  for (const delay of [0, 250, 500, 900, 1_400, 2_000, 2_800]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      if (!collect) {
        const ready = await browser.tabs.sendMessage(targetTab.id, {
          type: "PING_CHAT_GRAPH_CONTENT_SCRIPT",
        } satisfies ExtensionMessage) as { ready?: boolean };
        if (ready?.ready) return { ok: true, tabId: targetTab.id };
        continue;
      }
      const capture = await browser.tabs.sendMessage(targetTab.id, {
        type: "COLLECT_REVIEW_SOURCE",
      } satisfies ExtensionMessage) as ReviewCaptureReport;
      if (capture?.chatId === normalizedChatId && Array.isArray(capture.messages)) {
        return { ok: true, tabId: targetTab.id, capture };
      }
    } catch {
      // The new ChatGPT document or its content script may still be loading.
    }
  }
  return {
    ok: false,
    code: "SOURCE_UNAVAILABLE",
    error: "来源会话已打开，但暂时无法读取；请等待页面加载后重试。",
  };
}

async function commitReviewUpload(
  uploadId: string,
  request: Extract<ExtensionMessage, { type: "COMMIT_REVIEW_SOURCE_UPLOAD" }>["request"],
): Promise<ReviewJobResponse> {
  discardExpiredReviewUploads();
  const upload = reviewSourceUploads.get(uploadId);
  if (!upload) return { ok: false, code: "SOURCE_UNAVAILABLE", error: "来源上传已过期，请重新采集。" };
  reviewSourceUploads.delete(uploadId);
  // The upload-phase TTL no longer applies after ownership moves to the review
  // service. The service releases this capture when the job settles/cancels.
  cancelReviewUploadExpiry(upload);
  const orderedChunks = Array.from({ length: upload.totalChunks }, (_, index) => upload.chunks.get(index));
  if (orderedChunks.some((chunk) => !chunk)) {
    clearUploadedSource(upload);
    return { ok: false, code: "SOURCE_UNAVAILABLE", error: "来源消息块不完整，请重新采集。" };
  }
  const messages = orderedChunks.flatMap((chunk) => chunk ?? []);
  const capture: ReviewCaptureReport = {
    ...upload.metadata,
    messages,
  };
  try {
    const result = request.retryModuleId
      ? await retryUploadedReviewModule(request, capture)
      : request.retryJobId
        ? await reviewService.retryReview({
            jobId: request.retryJobId,
            capture,
            allowPartial: request.allowPartial,
          })
        : await reviewService.startReview({
            projectId: request.projectId,
            entrySource: request.entrySource,
            scopeType: request.scopeType,
            ...(request.anchorNodeId ? { anchorNodeId: request.anchorNodeId } : {}),
            selectedModuleIds: request.moduleIds,
            presetId: request.presetId,
            capture,
            allowPartial: request.allowPartial,
          });
    return { ok: true, job: result.job, document: result.document };
  } catch (error) {
    return reviewErrorResponse(error);
  } finally {
    clearUploadedSource(upload);
  }
}

async function retryUploadedReviewModule(
  request: Extract<ExtensionMessage, { type: "COMMIT_REVIEW_SOURCE_UPLOAD" }>["request"],
  capture: ReviewCaptureReport,
) {
  if (!request.retryJobId || !request.retryModuleId) {
    throw new ReviewServiceError("SOURCE_UNAVAILABLE", "单模块重试缺少原任务信息。");
  }
  const job = await reviewService.getJob(request.retryJobId);
  const document = job ? await service.reviews.getDocument(job.documentId) : undefined;
  if (!document?.activeVersionId) {
    throw new ReviewServiceError("SOURCE_UNAVAILABLE", "找不到要重试的总结版本。");
  }
  return reviewService.retryModule({
    versionId: document.activeVersionId,
    moduleId: request.retryModuleId,
    capture,
    allowPartial: request.allowPartial,
  });
}

type CaptureQuestionResult =
  | {
      ok: true;
      destination: "graph" | "existing_node";
      nodeId: string;
    }
  | {
      ok: true;
      destination: "inbox" | "existing_candidate";
      candidateId: string;
      candidateStatus: QuestionCandidate["status"];
    }
  | {
      ok: true;
      destination: "disabled" | "unassigned";
    }
  | { ok: false; error: string };

type BuildCurrentPageGraphResult =
  | {
      ok: true;
      createdCount: number;
      skippedCount: number;
      activeNodeId: string;
    }
  | { ok: false; error: string };

type LocatableQuestion = Pick<
  QuestionNode | QuestionCandidate,
  "chatId" | "messageId" | "messageAnchor" | "messageLocator"
>;

async function getFloatingPanelState(
  tabId: number,
  chatId?: string,
  selectedNodeId?: string,
  selectedCandidateId?: string,
): Promise<FloatingPanelState> {
  const [project, projects, settings, captureEnabled] = await Promise.all([
    tabDiscussionSession.getProject(tabId),
    service.projects.list(),
    getAISettings(),
    tabDiscussionSession.isCaptureEnabled(tabId),
  ]);
  if (!project) return emptyFloatingPanelState("Chat Graph", projects, captureEnabled);
  const [nodes, candidates, reviewDocuments] = await Promise.all([
    service.nodes.listForProject(project.id),
    service.candidates.listForProject(project.id),
    db.reviewDocuments
      .where("projectId")
      .equals(project.id)
      .filter((document) => (
        document.savedAt !== undefined
        && Boolean(document.graphAnchorNodeId)
        && Boolean(document.activeVersionId)
      ))
      .toArray(),
  ]);
  const reviewVersions = (await db.reviewVersions.bulkGet(
    reviewDocuments.flatMap((document) => document.activeVersionId ? [document.activeVersionId] : []),
  )).filter((version): version is ReviewVersion => Boolean(version));
  return buildFloatingPanelState({
    project,
    projects,
    captureEnabled,
    nodes,
    candidates,
    reviewDocuments,
    reviewVersions,
    ...(chatId ? { chatId } : {}),
    ...(selectedNodeId ? { selectedNodeId } : {}),
    ...(selectedCandidateId ? { selectedCandidateId } : {}),
    mediumConfidence: settings.mediumConfidence,
  });
}

function getFloatingPanelStateForContext(
  tabId: number,
  context: PanelActionContext,
): Promise<FloatingPanelState> {
  return getFloatingPanelState(tabId, context.chatId, context.viewingNodeId);
}

async function sendFloatingPanelState(tabId: number, chatId?: string): Promise<void> {
  const state = await getFloatingPanelState(tabId, chatId);
  await browser.tabs.sendMessage(tabId, {
    type: "FLOATING_PANEL_STATE_UPDATED",
    state,
  } satisfies ExtensionMessage);
}

async function broadcastFloatingPanelState(): Promise<void> {
  const tabs = await browser.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) =>
        sendFloatingPanelState(
          tab.id!,
          tab.url ? getConversationId(tab.url) : undefined,
        ),
      ),
  );
}

function notifyFloatingPanelStateChanged(): void {
  void broadcastFloatingPanelState().catch(() => undefined);
}

async function captureQuestion(
  captured: CapturedQuestion,
  tabId: number,
  manual = false,
): Promise<CaptureQuestionResult> {
  if (!canCaptureQuestion(await tabDiscussionSession.isCaptureEnabled(tabId), manual)) {
    return { ok: true, destination: "disabled" };
  }
  const project = await tabDiscussionSession.getProject(tabId);
  if (!project) return { ok: true, destination: "unassigned" };
  const captureResult = await service.findOrCreateCandidate(project.id, captured);
  if (captureResult.kind === "existing_node") {
    return { ok: true, destination: "existing_node", nodeId: captureResult.node.id };
  }
  if (captureResult.kind === "existing_candidate") {
    return {
      ok: true,
      destination: "existing_candidate",
      candidateId: captureResult.candidate.id,
      candidateStatus: captureResult.candidate.status,
    };
  }

  const candidate = captureResult.candidate;
  notifyFloatingPanelStateChanged();

  try {
    const nodes = await service.nodes.listForProject(project.id);
    const focus = nodes.find((node) => node.id === project.focusNodeId);
    const currentPath = focus ? getCurrentPath(nodes, focus.id) : [];
    const recommendation = await recommendParent({
      question: candidate.question,
      fallbackSummary: candidate.summary,
      ...(captured.assistantContext
        ? { assistantContext: captured.assistantContext }
        : {}),
      currentPath: currentPath.map(({ id, question, summary }) => ({ id, question, summary })),
      candidateNodes: nodes
        .slice(-30)
        .map(({ id, question, summary, status }) => ({ id, question, summary, status })),
    });
    const stillPending = await service.candidates.get(candidate.id);
    if (!stillPending) {
      const existingNode = await findCapturedNode(project.id, candidate);
      if (existingNode) {
        return { ok: true, destination: "existing_node", nodeId: existingNode.id };
      }
      return { ok: false, error: "该待讨论问题已被处理或忽略，请重新选择。" };
    }
    const latestNodes = await service.nodes.listForProject(project.id);
    const eligibleNodeIds = new Set(latestNodes.map((node) => node.id));
    recommendation.candidates = recommendation.candidates.filter((item) =>
      eligibleNodeIds.has(item.nodeId)
    );
    const reviewed = await service.recordRecommendation(candidate.id, recommendation);
    const settings = await getAISettings();
    const best = reviewed.recommendations[0];
    if (best && best.confidence >= settings.highConfidence) {
      const node = await service.promoteCandidate(candidate.id, best.nodeId, "ai", best.confidence);
      notifyFloatingPanelStateChanged();
      return { ok: true, destination: "graph", nodeId: node.id };
    }
    if (reviewed.noParentConfidence >= settings.highConfidence) {
      const node = await service.promoteCandidate(
        candidate.id,
        null,
        "ai",
        reviewed.noParentConfidence,
      );
      notifyFloatingPanelStateChanged();
      return { ok: true, destination: "graph", nodeId: node.id };
    }
    notifyFloatingPanelStateChanged();
    return {
      ok: true,
      destination: "inbox",
      candidateId: reviewed.id,
      candidateStatus: reviewed.status,
    };
  } catch {
    const pending = await service.candidates.get(candidate.id);
    if (pending) {
      const failed = await service.markCandidateFailed(candidate.id);
      notifyFloatingPanelStateChanged();
      return {
        ok: true,
        destination: "inbox",
        candidateId: failed.id,
        candidateStatus: failed.status,
      };
    }
    const existingNode = await findCapturedNode(project.id, candidate);
    if (existingNode) {
      return { ok: true, destination: "existing_node", nodeId: existingNode.id };
    }
    return { ok: false, error: "该待讨论问题已被处理或忽略，请重新选择。" };
  }
}

async function findCapturedNode(
  projectId: string,
  captured: Pick<QuestionCandidate, "chatId" | "messageId" | "messageAnchor">,
): Promise<QuestionNode | undefined> {
  return await service.nodes.findByMessage(projectId, captured.chatId, captured.messageId) ??
    (captured.messageAnchor
      ? await service.nodes.findByAnchor(projectId, captured.chatId, captured.messageAnchor)
      : undefined);
}

async function buildCurrentPageGraph(
  capturedQuestions: CapturedQuestion[],
  tabId: number,
): Promise<BuildCurrentPageGraphResult> {
  if (!capturedQuestions.length) {
    return { ok: false, error: "当前页面没有可建图的用户问题。" };
  }
  const normalized = capturedQuestions.map((captured) => ({
    ...captured,
    question: captured.question.trim(),
    messageId:
      captured.messageId || `${captured.chatId}:${fallbackSummary(captured.question)}`,
  }));
  const project = await tabDiscussionSession.getProject(tabId);
  if (!project) {
    return { ok: false, error: "请先为当前标签页选择项目。" };
  }
  const result = await service.importLinearQuestions(project.id, normalized);
  notifyFloatingPanelStateChanged();
  return { ok: true, ...result };
}

async function captureQuestionWithState(
  captured: CapturedQuestion,
  tabId: number,
  manual: boolean,
  context?: PanelActionContext,
): Promise<CaptureQuestionResponse> {
  const response = await captureQuestion(captured, tabId, manual);
  if (!response.ok) return response;
  const stateContext: PanelActionContext = {
    ...(context ?? {}),
    chatId: context?.chatId ?? captured.chatId,
  };
  const state = response.destination === "graph" || response.destination === "existing_node"
    ? await getFloatingPanelState(tabId, stateContext.chatId, response.nodeId)
    : response.destination === "inbox" || response.destination === "existing_candidate"
      ? await getFloatingPanelState(tabId, stateContext.chatId, undefined, response.candidateId)
      : await getFloatingPanelStateForContext(tabId, stateContext);
  return {
    ...response,
    state,
  };
}

async function buildCurrentPageGraphWithState(
  capturedQuestions: CapturedQuestion[],
  tabId: number,
  context: PanelActionContext,
): Promise<BuildCurrentPageGraphResponse> {
  const response = await buildCurrentPageGraph(capturedQuestions, tabId);
  if (!response.ok) return response;
  return {
    ...response,
    state: await getFloatingPanelStateForContext(tabId, {
      ...context,
      viewingNodeId: response.activeNodeId,
    }),
  };
}

async function focusPanelParent(currentNodeId: string): Promise<void> {
  const node = await service.nodes.get(currentNodeId);
  if (!node?.parentId) throw new Error("当前问题没有 Parent。");
  await service.focusNode(node.parentId);
  notifyFloatingPanelStateChanged();
}

async function handleFloatingPanelCommand(
  message: FloatingPanelCommandMessage,
  tabId: number,
) {
  const response = await executeFloatingPanelCommand(message, {
    service,
    getSelectedProject: () => tabDiscussionSession.getProject(tabId),
    setSelectedProjectId: async (projectId) => {
      await tabDiscussionSession.setProjectId(tabId, projectId);
      await browser.tabs.sendMessage(tabId, {
        type: "TAB_PROJECT_STATE_UPDATED",
        selected: Boolean(projectId),
      } satisfies ExtensionMessage).catch(() => undefined);
      if (projectId) {
        await browser.storage.local.set({ [SELECTED_PROJECT_KEY]: projectId });
      }
    },
    setCaptureEnabled: async (enabled) => {
      await tabDiscussionSession.setCaptureEnabled(tabId, enabled);
      await browser.tabs.sendMessage(tabId, {
        type: "TAB_CAPTURE_STATE_UPDATED",
        enabled,
      } satisfies ExtensionMessage).catch(() => undefined);
    },
    getState: (context) => getFloatingPanelStateForContext(tabId, context),
  });
  if (response.ok) notifyFloatingPanelStateChanged();
  return response;
}

async function navigateToNode(
  message: Extract<ExtensionMessage, { type: "NAVIGATE_TO_NODE" }>,
  senderTabId?: number,
): Promise<NavigateToNodeResponse> {
  const node = await service.nodes.get(message.nodeId);
  if (!node) {
    return {
      ok: false,
      status: "message_not_found",
      error: "问题节点不存在或已被删除。",
    };
  }

  return navigateLocatableQuestion(node, message, senderTabId);
}

async function navigateToQuestion(
  source: PanelQuestionSource,
  options: { sourceTabId?: number },
  senderTabId?: number,
): Promise<NavigateToNodeResponse> {
  const question = source.kind === "node"
    ? await service.nodes.get(source.id)
    : await service.candidates.get(source.id);
  if (!question) {
    return {
      ok: false,
      status: "message_not_found",
      error: source.kind === "node"
        ? "问题节点不存在或已被删除。"
        : "待讨论问题不存在或已被处理。",
    };
  }
  return navigateLocatableQuestion(question, options, senderTabId);
}

async function navigateToReference(
  message: Extract<ExtensionMessage, { type: "NAVIGATE_TO_REFERENCE" }>,
  senderTabId?: number,
): Promise<NavigateToNodeResponse> {
  const reference = sanitizeQuestionReferences([message.reference])[0];
  if (!reference?.sourceLocator) {
    return {
      ok: false,
      status: "message_not_found",
      error: "这条引用没有可用的原消息定位信息。",
    };
  }
  const sourceTabId = message.sourceTabId ?? senderTabId;
  const targetTab = sourceTabId === undefined
    ? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
    : await browser.tabs.get(sourceTabId).catch(() => undefined);
  if (targetTab?.id === undefined) {
    return {
      ok: false,
      status: "conversation_unavailable",
      error: "请先打开包含引用来源的 ChatGPT 页面。",
    };
  }
  if (targetTab.windowId !== undefined) {
    await browser.windows.update(targetTab.windowId, { focused: true }).catch(() => undefined);
  }
  await browser.tabs.update(targetTab.id, { active: true }).catch(() => undefined);
  return locateReferenceInTab(targetTab.id, { ...reference, sourceLocator: reference.sourceLocator });
}

async function navigateLocatableQuestion(
  question: LocatableQuestion,
  options: { sourceTabId?: number },
  senderTabId?: number,
): Promise<NavigateToNodeResponse> {
  const sourceTabId = options.sourceTabId ?? senderTabId;
  const targetTab = sourceTabId === undefined
    ? (await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    }))[0]
    : await browser.tabs.get(sourceTabId).catch(() => undefined);

  if (targetTab?.id === undefined) {
    return {
      ok: false,
      status: "conversation_unavailable",
      error: "请先打开包含原问题的 ChatGPT 页面。",
    };
  }

  if (targetTab.windowId !== undefined) {
    await browser.windows.update(targetTab.windowId, { focused: true }).catch(() => undefined);
  }
  await browser.tabs.update(targetTab.id, { active: true }).catch(() => undefined);

  return locateQuestionInTab(targetTab.id, question);
}

async function refineMessageLocator(
  message: Extract<ExtensionMessage, { type: "REFINE_MESSAGE_LOCATOR" }>,
): Promise<boolean> {
  for (const delay of [0, 250, 750]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (await service.refineMessageLocator(
      message.chatId,
      message.messageAnchor,
      message.messageLocator,
    )) return true;
  }
  return false;
}

async function locateQuestionInTab(
  tabId: number,
  question: LocatableQuestion,
): Promise<NavigateToNodeResponse> {
  const delays = [0, 180, 360, 700, 1_100, 1_600];
  let lastResponse: LocateQuestionResponse | undefined;
  let receiverReached = false;

  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: "LOCATE_QUESTION",
        chatId: question.chatId,
        messageId: question.messageId,
        ...(question.messageAnchor ? { messageAnchor: question.messageAnchor } : {}),
        ...(question.messageLocator ? { messageLocator: question.messageLocator } : {}),
      } satisfies ExtensionMessage) as LocateQuestionResponse;
      receiverReached = true;
      lastResponse = response;
      if (response.ok) return { ok: true, status: "located", tabId };
    } catch {
      // The content script may still be starting after a tab navigation.
    }
  }

  if (!receiverReached) {
    return {
      ok: false,
      status: "content_script_unavailable",
      error: "扩展未能连接该 ChatGPT 页面，请刷新页面后重试。",
    };
  }
  if (lastResponse && !lastResponse.ok &&
      (lastResponse.code === "WRONG_CONVERSATION" ||
       lastResponse.code === "CONVERSATION_UNAVAILABLE")) {
    return {
      ok: false,
      status: "conversation_unavailable",
      error: "当前 ChatGPT 页面没有找到对应问题。请先打开包含该问题的会话。",
    };
  }
  return {
    ok: false,
    status: "message_not_found",
    error: "当前 ChatGPT 页面没有找到对应问题。",
  };
}

async function locateReferenceInTab(
  tabId: number,
  reference: Extract<ExtensionMessage, { type: "LOCATE_REFERENCE" }>["reference"],
): Promise<NavigateToNodeResponse> {
  const delays = [0, 180, 360, 700, 1_100, 1_600];
  let lastResponse: LocateQuestionResponse | undefined;
  let receiverReached = false;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: "LOCATE_REFERENCE",
        reference,
      } satisfies ExtensionMessage) as LocateQuestionResponse;
      receiverReached = true;
      lastResponse = response;
      if (response.ok) return { ok: true, status: "located", tabId };
    } catch {
      // The content script may still be starting after a tab navigation.
    }
  }
  if (!receiverReached) {
    return {
      ok: false,
      status: "content_script_unavailable",
      error: "扩展未能连接该 ChatGPT 页面，请刷新页面后重试。",
    };
  }
  if (lastResponse && !lastResponse.ok && (
    lastResponse.code === "WRONG_CONVERSATION" ||
    lastResponse.code === "CONVERSATION_UNAVAILABLE"
  )) {
    return {
      ok: false,
      status: "conversation_unavailable",
      error: "当前 ChatGPT 页面没有找到引用来源。请先打开对应会话。",
    };
  }
  return {
    ok: false,
    status: "message_not_found",
    error: "当前 ChatGPT 页面没有找到引用来源。",
  };
}

function respondWithAction(
  promise: Promise<unknown>,
  sendResponse: (response: PanelActionResponse) => void,
): void {
  void promise
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "操作失败，请重试。",
      }),
    );
}

async function saveReviewToGraph(
  message: Extract<ExtensionMessage, { type: "SAVE_REVIEW_TO_GRAPH" }>,
): Promise<ReviewMutationResponse> {
  const sourceDocument = await service.reviews.getDocument(message.documentId);
  if (!sourceDocument?.activeVersionId) {
    return { ok: false, code: "STORAGE_FAILED", error: "找不到可保存的总结版本。" };
  }
  const sourceVersion = await service.reviews.getVersion(sourceDocument.activeVersionId);
  if (!sourceVersion) return { ok: false, code: "STORAGE_FAILED", error: "总结版本不可用。" };
  const anchor = message.graphAnchorNodeId ?? sourceDocument.graphAnchorNodeId;
  if (!anchor) return { ok: false, code: "MISSING_RELATIONSHIP", error: "请先选择总结在图中的连接节点。" };
  const anchorNode = await service.nodes.get(anchor);
  if (!anchorNode || anchorNode.projectId !== sourceDocument.projectId) {
    return { ok: false, code: "MISSING_RELATIONSHIP", error: "总结连接节点已不可用。" };
  }

  const scopedDocuments = await service.reviews.findDocumentsByScope(
    sourceDocument.projectId,
    sourceDocument.scopeFamilyKey,
  );
  const latestSaved = scopedDocuments
    .filter((item) => item.savedAt !== undefined)
    .sort((left, right) => (right.savedAt ?? 0) - (left.savedAt ?? 0))[0];
  const now = Date.now();

  if (message.strategy === "update" && latestSaved) {
    const version = await cloneReviewVersionIntoDocument(sourceVersion, latestSaved.id);
    const document = await service.reviews.updateDocument(latestSaved.id, {
      graphAnchorNodeId: anchor,
      savedAt: now,
    });
    await notifyReviewDocumentsChanged(document.projectId);
    return { ok: true, document, version };
  }

  if (message.strategy === "new" && sourceDocument.savedAt !== undefined) {
    const document = await service.reviews.createDocument({
      projectId: sourceDocument.projectId,
      chatId: sourceDocument.chatId,
      scopeFamilyKey: sourceDocument.scopeFamilyKey,
      entrySource: sourceDocument.entrySource,
      supersedesDocumentId: sourceDocument.id,
    });
    const version = await cloneReviewVersionIntoDocument(sourceVersion, document.id);
    const saved = await service.reviews.updateDocument(document.id, {
      graphAnchorNodeId: anchor,
      savedAt: now,
    });
    await notifyReviewDocumentsChanged(saved.projectId);
    return { ok: true, document: saved, version };
  }

  const document = await service.reviews.updateDocument(sourceDocument.id, {
    graphAnchorNodeId: anchor,
    savedAt: now,
    ...(latestSaved && latestSaved.id !== sourceDocument.id
      ? { supersedesDocumentId: latestSaved.id }
      : {}),
  });
  await notifyReviewDocumentsChanged(document.projectId);
  return { ok: true, document, version: sourceVersion };
}

async function cloneReviewVersionIntoDocument(
  source: ReviewVersion,
  documentId: string,
): Promise<ReviewVersion> {
  return service.reviews.createVersion({
    documentId,
    projectId: source.projectId,
    title: source.title,
    scope: structuredClone(source.scope),
    moduleOrder: [...source.moduleOrder],
    modules: structuredClone(source.modules),
    evidences: structuredClone(source.evidences),
    ...(source.providerId ? { providerId: source.providerId } : {}),
    ...(source.model ? { model: source.model } : {}),
    segmented: source.segmented,
    segmentCount: source.segmentCount,
    missingRanges: [...source.missingRanges],
    ...(source.helpful !== undefined ? { helpful: source.helpful } : {}),
    ...(source.moduleFeedback ? { moduleFeedback: { ...source.moduleFeedback } } : {}),
    generatedAt: Date.now(),
  });
}

async function notifyReviewDocumentsChanged(projectId: string): Promise<void> {
  await browser.runtime.sendMessage({
    type: "REVIEW_DOCUMENTS_UPDATED",
    projectId,
  } satisfies ExtensionMessage).catch(() => undefined);
  notifyFloatingPanelStateChanged();
}

export default defineBackground(() => {
  initializeSidebarBehavior();
  void service.reviews.markUnfinishedInterrupted().then((count) => {
    if (count > 0) notifyFloatingPanelStateChanged();
  }).catch(() => undefined);
  browser.tabs.onRemoved.addListener((tabId) => {
    void tabDiscussionSession.clear(tabId).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
    if (!isExtensionMessage(rawMessage)) return undefined;
    if (rawMessage.type === "TEST_AI_PROVIDER") {
      if (
        sender.tab !== undefined ||
        sender.id !== browser.runtime.id ||
        !isTestAIProviderMessage(rawMessage) ||
        !isAIProviderId(rawMessage.providerId)
      ) {
        sendResponse({ ok: false, error: "无效的 AI 连接测试请求。" } satisfies TestAIProviderResponse);
        return undefined;
      }
      void testAIProvider({
        providerId: rawMessage.providerId,
        profile: rawMessage.profile,
        timeoutMs: rawMessage.timeoutMs,
      })
        .then((recommendation) => sendResponse({
          ok: true,
          providerId: rawMessage.providerId,
          model: recommendation.model ?? rawMessage.profile.model,
        } satisfies TestAIProviderResponse))
        .catch((error: unknown) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "AI 连接测试失败。",
        } satisfies TestAIProviderResponse));
      return true;
    }
    if (rawMessage.type === "REQUEST_REVIEW_PROVIDER_PERMISSION") {
      void getAISettings()
        .then(requestActiveProviderPermission)
        .then((ok) => sendResponse(ok
          ? { ok: true }
          : {
              ok: false,
              code: "NOT_AUTHORIZED",
              error: "未授予当前 AI 厂商的域名访问权限。",
            }))
        .catch(() => sendResponse({
          ok: false,
          code: "NOT_AUTHORIZED",
          error: "无法请求当前 AI 厂商的域名访问权限。",
        }));
      return true;
    }
    if (rawMessage.type === "OPEN_REVIEW_SOURCE") {
      void openReviewSourceConversation(rawMessage.chatId, rawMessage.collect !== false)
        .then(sendResponse)
        .catch(() => sendResponse({
          ok: false,
          code: "SOURCE_UNAVAILABLE",
          error: "无法打开总结来源会话。",
        } satisfies OpenReviewSourceResponse));
      return true;
    }
    if (rawMessage.type === "BEGIN_REVIEW_SOURCE_UPLOAD") {
      discardExpiredReviewUploads();
      const serializedChars = serializedCharLength(rawMessage);
      if (serializedChars === undefined || serializedChars > REVIEW_UPLOAD_MAX_BEGIN_CHARS) {
        sendResponse({ ok: false, code: "SOURCE_TOO_LARGE", error: "来源上传信息过长。" } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      if (
        !isRecord(rawMessage)
        || !hasOnlyKeys(rawMessage, ["type", "uploadId", "metadata", "totalChunks"])
        || !isBoundedUploadId(rawMessage.uploadId)
        || !isReviewSourceUploadMetadata(rawMessage.metadata)
        || !Number.isInteger(rawMessage.totalChunks)
        || rawMessage.totalChunks < 1
        || rawMessage.totalChunks > REVIEW_UPLOAD_MAX_CHUNKS
      ) {
        sendResponse({ ok: false, code: "SOURCE_UNAVAILABLE", error: "来源上传信息无效。" } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      const previous = reviewSourceUploads.get(rawMessage.uploadId);
      if (!previous && reviewSourceUploads.size >= REVIEW_UPLOAD_MAX_ACTIVE) {
        sendResponse({ ok: false, code: "SOURCE_TOO_LARGE", error: "同时上传的来源过多，请稍后重试。" } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      if (previous) discardReviewSourceUpload(rawMessage.uploadId);
      const upload: ReviewSourceUpload = {
        metadata: {
          ...rawMessage.metadata,
          missingSourceIds: [...rawMessage.metadata.missingSourceIds],
        },
        totalChunks: rawMessage.totalChunks,
        chunks: new Map(),
        serializedChunkChars: new Map(),
        createdAt: Date.now(),
      };
      reviewSourceUploads.set(rawMessage.uploadId, upload);
      scheduleReviewUploadExpiry(rawMessage.uploadId, upload);
      sendResponse({ ok: true, uploadId: rawMessage.uploadId, receivedChunks: 0 } satisfies ReviewSourceUploadResponse);
      return undefined;
    }
    if (rawMessage.type === "APPEND_REVIEW_SOURCE_CHUNK") {
      discardExpiredReviewUploads();
      const serializedChars = serializedCharLength(rawMessage);
      const upload = isBoundedUploadId(rawMessage.uploadId)
        ? reviewSourceUploads.get(rawMessage.uploadId)
        : undefined;
      if (!upload) {
        sendResponse({ ok: false, code: "SOURCE_UNAVAILABLE", error: "来源上传已过期，请重新采集。" } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      if (
        serializedChars === undefined
        || serializedChars > REVIEW_UPLOAD_MAX_CHUNK_CHARS
        || !isRecord(rawMessage)
        || !hasOnlyKeys(rawMessage, ["type", "uploadId", "index", "messages"])
        || !Number.isInteger(rawMessage.index)
        || rawMessage.index < 0
        || rawMessage.index >= upload.totalChunks
        || !Array.isArray(rawMessage.messages)
        || rawMessage.messages.length > REVIEW_UPLOAD_MAX_MESSAGES_PER_CHUNK
        || !rawMessage.messages.every(isConversationReviewMessage)
        || rawMessage.messages.some((message) => message.chatId !== upload.metadata.chatId)
      ) {
        discardReviewSourceUpload(rawMessage.uploadId);
        sendResponse({
          ok: false,
          ...(serializedChars === undefined || serializedChars > REVIEW_UPLOAD_MAX_CHUNK_CHARS
            ? { code: "SOURCE_TOO_LARGE" }
            : { code: "SOURCE_UNAVAILABLE" }),
          error: serializedChars === undefined || serializedChars > REVIEW_UPLOAD_MAX_CHUNK_CHARS
            ? "来源消息块过长，请缩小总结范围。"
            : "来源消息块无效，请重新采集。",
        } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      const previousSerializedChars = upload.serializedChunkChars.get(rawMessage.index) ?? 0;
      const currentChars = [...upload.serializedChunkChars.values()]
        .reduce((total, chars) => total + chars, 0) - previousSerializedChars;
      if (currentChars + serializedChars > REVIEW_UPLOAD_MAX_CHARS) {
        discardReviewSourceUpload(rawMessage.uploadId);
        sendResponse({ ok: false, code: "SOURCE_TOO_LARGE", error: "来源内容过长，请缩小总结范围。" } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      const previous = upload.chunks.get(rawMessage.index);
      if (previous) {
        previous.forEach((message) => { message.content = ""; });
        previous.splice(0);
      }
      upload.chunks.set(rawMessage.index, rawMessage.messages);
      upload.serializedChunkChars.set(rawMessage.index, serializedChars);
      sendResponse({
        ok: true,
        uploadId: rawMessage.uploadId,
        receivedChunks: upload.chunks.size,
      } satisfies ReviewSourceUploadResponse);
      return undefined;
    }
    if (rawMessage.type === "DISCARD_REVIEW_SOURCE_UPLOAD") {
      if (
        serializedCharLength(rawMessage) === undefined
        || !isRecord(rawMessage)
        || !hasOnlyKeys(rawMessage, ["type", "uploadId"])
        || !isBoundedUploadId(rawMessage.uploadId)
      ) {
        sendResponse({ ok: false, code: "SOURCE_UNAVAILABLE", error: "来源上传标识无效。" } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      discardReviewSourceUpload(rawMessage.uploadId);
      sendResponse({ ok: true, uploadId: rawMessage.uploadId } satisfies ReviewSourceUploadResponse);
      return undefined;
    }
    if (rawMessage.type === "COMMIT_REVIEW_SOURCE_UPLOAD") {
      const serializedChars = serializedCharLength(rawMessage);
      if (
        serializedChars === undefined
        || serializedChars > REVIEW_UPLOAD_MAX_COMMIT_CHARS
        || !isRecord(rawMessage)
        || !hasOnlyKeys(rawMessage, ["type", "uploadId", "request"])
        || !isBoundedUploadId(rawMessage.uploadId)
        || !isStartReviewJobRequest(rawMessage.request)
      ) {
        if (isBoundedUploadId(rawMessage.uploadId)) {
          discardReviewSourceUpload(rawMessage.uploadId);
        }
        sendResponse({
          ok: false,
          ...(serializedChars === undefined || serializedChars > REVIEW_UPLOAD_MAX_COMMIT_CHARS
            ? { code: "SOURCE_TOO_LARGE" }
            : { code: "SOURCE_UNAVAILABLE" }),
          error: "总结任务请求无效，请重新采集。",
        } satisfies ReviewSourceUploadResponse);
        return undefined;
      }
      void commitReviewUpload(rawMessage.uploadId, rawMessage.request).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "GET_PROJECT_REVIEWS") {
      void getProjectReviewState(rawMessage.projectId)
        .then(sendResponse)
        .catch((error) => sendResponse(reviewErrorResponse(error)));
      return true;
    }
    if (rawMessage.type === "GET_REVIEW_JOB") {
      void getReviewJobResponse(rawMessage.jobId).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "CANCEL_REVIEW_JOB") {
      void reviewService.cancelReview(rawMessage.jobId)
        .then(async (job) => job ? getReviewJobResponse(job.id) : ({ ok: false, error: "找不到总结任务。" } as const))
        .then(sendResponse)
        .catch((error) => sendResponse(reviewErrorResponse(error)));
      return true;
    }
    if (rawMessage.type === "UPDATE_REVIEW_VERSION") {
      void service.reviews.updateVersion(rawMessage.versionId, rawMessage.changes)
        .then((version) => sendResponse({ ok: true, version } satisfies ReviewMutationResponse))
        .catch((error) => sendResponse(reviewErrorResponse(error)));
      return true;
    }
    if (rawMessage.type === "SAVE_REVIEW_TO_GRAPH") {
      void saveReviewToGraph(rawMessage)
        .then(sendResponse)
        .catch((error) => sendResponse(reviewErrorResponse(error)));
      return true;
    }
    if (rawMessage.type === "DELETE_REVIEW_DOCUMENT") {
      void service.reviews.getDocument(rawMessage.documentId)
        .then(async (document) => {
          if (!document) throw new Error("找不到总结文档。");
          await reviewService.cancelReviewsForDocument(document.id);
          await service.reviews.deleteDocument(document.id);
          await reviewService.cancelReviewsForDocument(document.id);
          await notifyReviewDocumentsChanged(document.projectId);
          return { ok: true } satisfies ReviewMutationResponse;
        })
        .then(sendResponse)
        .catch((error) => sendResponse(reviewErrorResponse(error)));
      return true;
    }
    if (rawMessage.type === "CANCEL_PROJECT_REVIEWS") {
      void reviewService.cancelReviewsForProject(rawMessage.projectId)
        .then(() => sendResponse({ ok: true } satisfies ReviewMutationResponse))
        .catch((error) => sendResponse(reviewErrorResponse(error)));
      return true;
    }
    if (rawMessage.type === "CREATE_REVIEW_BRANCH") {
      void service.createPlannedNode({
        projectId: rawMessage.projectId,
        chatId: rawMessage.chatId,
        parentId: rawMessage.parentId ?? null,
        reviewId: rawMessage.reviewDocumentId,
        candidate: rawMessage.candidate,
      })
        .then(async () => {
          notifyFloatingPanelStateChanged();
          return { ok: true } satisfies ReviewMutationResponse;
        })
        .then(sendResponse)
        .catch((error) => sendResponse(reviewErrorResponse(error)));
      return true;
    }
    if (rawMessage.type === "GET_FLOATING_PANEL_STATE") {
      if (sender.tab?.id === undefined) {
        sendResponse(emptyFloatingPanelState());
        return undefined;
      }
      void getFloatingPanelState(sender.tab.id, rawMessage.chatId, rawMessage.selectedNodeId)
        .then(sendResponse)
        .catch(() => sendResponse(emptyFloatingPanelState()));
      return true;
    }
    if (rawMessage.type === "GET_TAB_CAPTURE_STATE") {
      if (sender.tab?.id === undefined) {
        sendResponse({ enabled: true, projectSelected: false });
        return undefined;
      }
      void Promise.all([
        tabDiscussionSession.isCaptureEnabled(sender.tab.id),
        tabDiscussionSession.getProject(sender.tab.id),
      ])
        .then(([enabled, project]) => sendResponse({
          enabled,
          projectSelected: Boolean(project),
        }))
        .catch(() => sendResponse({ enabled: true, projectSelected: false }));
      return true;
    }
    if (rawMessage.type === "CAPTURE_QUESTION") {
      if (sender.tab?.id === undefined) {
        sendResponse({ ok: false, error: "无法识别当前 ChatGPT 标签页。" } satisfies CaptureQuestionResponse);
        return undefined;
      }
      const captured = {
        ...rawMessage.captured,
        question: rawMessage.captured.question.trim(),
        messageId:
          rawMessage.captured.messageId ||
          `${rawMessage.captured.chatId}:${fallbackSummary(rawMessage.captured.question)}`,
      };
      void captureQuestionWithState(
        captured,
        sender.tab.id,
        rawMessage.manual === true,
        rawMessage.context,
      )
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "问题捕获失败。",
          } satisfies CaptureQuestionResponse),
        );
      return true;
    }
    if (rawMessage.type === "BUILD_CURRENT_PAGE_GRAPH") {
      if (sender.tab?.id === undefined) {
        sendResponse({ ok: false, error: "无法识别当前 ChatGPT 标签页。" } satisfies BuildCurrentPageGraphResponse);
        return undefined;
      }
      void buildCurrentPageGraphWithState(
        rawMessage.capturedQuestions,
        sender.tab.id,
        rawMessage.context,
      )
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "一键建图失败，请重试。",
          } satisfies BuildCurrentPageGraphResponse),
        );
      return true;
    }
    if (rawMessage.type === "REFINE_MESSAGE_LOCATOR") {
      respondWithAction(
        refineMessageLocator(rawMessage),
        sendResponse,
      );
      return true;
    }
    if (rawMessage.type === "NAVIGATE_TO_NODE") {
      void navigateToNode(rawMessage, sender.tab?.id)
        .then(sendResponse)
        .catch(() => sendResponse({
          ok: false,
          status: "conversation_unavailable",
          error: "暂时无法打开原会话，请重试。",
        } satisfies NavigateToNodeResponse));
      return true;
    }
    if (rawMessage.type === "NAVIGATE_TO_QUESTION") {
      void navigateToQuestion(rawMessage.source, rawMessage, sender.tab?.id)
        .then(sendResponse)
        .catch(() => sendResponse({
          ok: false,
          status: "conversation_unavailable",
          error: "暂时无法打开原会话，请重试。",
        } satisfies NavigateToNodeResponse));
      return true;
    }
    if (rawMessage.type === "NAVIGATE_TO_REFERENCE") {
      void navigateToReference(rawMessage, sender.tab?.id)
        .then(sendResponse)
        .catch(() => sendResponse({
          ok: false,
          status: "conversation_unavailable",
          error: "暂时无法定位引用来源，请重试。",
        } satisfies NavigateToNodeResponse));
      return true;
    }
    if (rawMessage.type === "FOCUS_PANEL_PARENT") {
      respondWithAction(focusPanelParent(rawMessage.currentNodeId), sendResponse);
      return true;
    }
    if (rawMessage.type === "SELECT_PANEL_PROJECT") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "CREATE_PANEL_PROJECT") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "RENAME_PANEL_PROJECT") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "DELETE_PANEL_PROJECT") {
      if (sender.tab?.id === undefined) return undefined;
      const tabId = sender.tab.id;
      void reviewService.cancelReviewsForProject(rawMessage.projectId)
        .then(() => handleFloatingPanelCommand(rawMessage, tabId))
        .then(async (response) => {
          await reviewService.cancelReviewsForProject(rawMessage.projectId);
          return response;
        })
        .then(sendResponse);
      return true;
    }
    if (rawMessage.type === "DELETE_PANEL_NODE") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_PANEL_PARENT") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_PANEL_NODE_STATUS") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_CAPTURE_SERVICE_ENABLED") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "IGNORE_PANEL_CURRENT") {
      if (sender.tab?.id === undefined) return undefined;
      void handleFloatingPanelCommand(rawMessage, sender.tab.id).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "DISCUSSION_MAP_CHANGED") {
      void broadcastFloatingPanelState();
      return undefined;
    }
    if (rawMessage.type === "CHATGPT_LOCATION_CHANGED" && sender.tab?.id !== undefined) {
      void sendFloatingPanelState(sender.tab.id, rawMessage.chatId).catch(() => undefined);
      return undefined;
    }
    if (rawMessage.type === "OPEN_SIDE_PANEL") {
      if (sender.tab?.id === undefined) {
        sendResponse({ ok: false, error: "无法识别当前 ChatGPT 标签页。" } satisfies PanelActionResponse);
        return undefined;
      }

      // Start persisting the requested destination before opening, but do not
      // await: Chrome sidePanel.open must retain the originating user gesture.
      const destination = {
        ...(rawMessage.projectId ? { [SELECTED_PROJECT_KEY]: rawMessage.projectId } : {}),
        ...(rawMessage.view ? { [REQUESTED_SIDE_PANEL_VIEW_KEY]: rawMessage.view } : {}),
      };
      if (Object.keys(destination).length) {
        void browser.storage.local.set(destination).catch(() => undefined);
      }
      const opening = openDiscussionDetail(sender.tab.id);
      respondWithAction(opening, sendResponse);
      return true;
    }
    return undefined;
  });
});
