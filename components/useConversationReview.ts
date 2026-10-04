import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  buildContinuationContextText,
  buildReviewCopyText,
  buildReviewModuleCopyText,
  createReviewMarkdownExport,
  identifyReviewPreset,
  modulesForReviewPreset,
  resolveReviewScope,
} from "../review";
import {
  cancelReviewJob,
  listenForReviewJob,
  requestReviewProviderPermission,
  uploadReviewSourceAndStart,
} from "../review/runtime";
import type {
  ExtensionMessage,
  NavigateToNodeResponse,
  OpenReviewSourceResponse,
  ReviewMutationResponse,
  ReviewStateResponse,
} from "../shared/messages";
import type {
  QuestionNode,
  ReviewBranchCandidate,
  ReviewCaptureReport,
  ReviewDocument,
  ReviewEntrySource,
  ReviewEvidence,
  ReviewJob,
  ReviewModuleId,
  ReviewModuleResult,
  ReviewModuleSnapshot,
  ReviewPresetId,
  ReviewScope,
  ReviewScopeType,
  ReviewVersion,
} from "../types/domain";
import type {
  ConversationReviewDialogProps,
  ConversationReviewView,
  ReviewGenerateRequest,
  ReviewGraphSaveStrategy,
} from "./ConversationReviewDialog";

const REVIEW_PREFERENCES_KEY = "conversationReviewPreferencesV1";
const ACTIVE_JOB_STATUSES = new Set(["waiting", "collecting", "organizing", "generating"]);

type StoredPreferences = {
  scopeType: ReviewScopeType;
  moduleIds: ReviewModuleId[];
  presetId: ReviewPresetId;
};

type ReviewScopeMetadata = {
  scope: ReviewScope;
  scopeFamilyKey: string;
};

type OpenReviewOptions = {
  anchorNodeId?: string;
  entrySource?: ReviewEntrySource;
  scopeType?: ReviewScopeType;
  documentId?: string;
};

export type UseConversationReviewOptions = {
  projectId?: string;
  nodes: readonly QuestionNode[];
  entrySource: ReviewEntrySource;
  defaultAnchorNodeId?: string;
  collectSource: (expectedChatId?: string) => Promise<ReviewCaptureReport>;
  onError?: (message: string) => void;
  onChanged?: () => void | Promise<void>;
  onOpenSettings?: () => void;
};

export type ConversationReviewController = {
  open: boolean;
  loading: boolean;
  openReview: (options?: OpenReviewOptions) => void;
  closeReview: () => void;
  dialogProps?: ConversationReviewDialogProps;
};

export function useConversationReview({
  projectId,
  nodes,
  entrySource,
  defaultAnchorNodeId,
  collectSource,
  onError,
  onChanged,
  onOpenSettings,
}: UseConversationReviewOptions): ConversationReviewController {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ConversationReviewView>("config");
  const [activeEntrySource, setActiveEntrySource] = useState(entrySource);
  const [anchorNodeId, setAnchorNodeId] = useState(defaultAnchorNodeId);
  const [scopeType, setScopeType] = useState<ReviewScopeType>("current_branch");
  const [moduleIds, setModuleIds] = useState<ReviewModuleId[]>(
    () => [...modulesForReviewPreset("general")],
  );
  const [presetId, setPresetId] = useState<ReviewPresetId>("general");
  const [allowPartial, setAllowPartial] = useState(false);
  const [graphAnchorNodeId, setGraphAnchorNodeId] = useState<string>();
  const [capture, setCapture] = useState<ReviewCaptureReport>();
  const [scopeMetadata, setScopeMetadata] = useState<ReviewScopeMetadata>();
  const [job, setJob] = useState<ReviewJob>();
  const [version, setVersion] = useState<ReviewVersion>();
  const [document, setDocument] = useState<ReviewDocument>();
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [failedEvidenceIds, setFailedEvidenceIds] = useState<Set<string>>(() => new Set());
  const [dirty, setDirty] = useState(false);
  const collectionRequestRef = useRef(0);
  const reviewSessionRef = useRef(0);
  const sourceTransferIdRef = useRef(0);
  const sourceTransferRef = useRef<{ id: number; sessionId: number } | undefined>(undefined);
  const editBaselineRef = useRef<ReviewVersion | undefined>(undefined);
  const keepDraftOnCloseRef = useRef(false);

  const resolved = useMemo(() => {
    const target = anchorNodeId ?? defaultAnchorNodeId;
    if (!projectId) return undefined;
    return resolveReviewScope({
      projectId,
      scopeType,
      nodes,
      capture: capture ?? unavailableCapture(nodes, target),
      ...(target ? { targetNodeId: target } : {}),
      ...(capture?.chatId ? { chatId: capture.chatId } : {}),
    });
  }, [anchorNodeId, capture, defaultAnchorNodeId, nodes, projectId, scopeType]);

  const currentScopeFamilyKey = capture
    ? resolved?.scopeFamilyKey
    : scopeMetadata?.scopeFamilyKey ?? resolved?.scopeFamilyKey;

  const releaseCapture = useCallback(() => {
    collectionRequestRef.current += 1;
    setCapture(undefined);
  }, []);

  useEffect(() => {
    if (!capture || !resolved) return;
    setScopeMetadata({
      scope: resolved.scope,
      scopeFamilyKey: resolved.scopeFamilyKey,
    });
  }, [capture, resolved]);

  const collect = useCallback(async (expectedChatId?: string) => {
    const requestId = ++collectionRequestRef.current;
    setCapture(undefined);
    setLoading(true);
    try {
      const report = await collectSource(expectedChatId);
      if (requestId !== collectionRequestRef.current) return undefined;
      if (expectedChatId && report.chatId !== expectedChatId) {
        throw new Error("当前标签不是目标节点的来源会话，请打开对应的 ChatGPT 会话后重试。");
      }
      setCapture(report);
      return report;
    } catch (error) {
      if (requestId === collectionRequestRef.current) {
        setCapture(undefined);
        onError?.(messageFromError(error));
      }
      return undefined;
    } finally {
      if (requestId === collectionRequestRef.current) setLoading(false);
    }
  }, [collectSource, onError]);

  const refreshStoredState = useCallback(async (selectedDocumentId?: string) => {
    if (!projectId) return;
    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_PROJECT_REVIEWS",
        projectId,
      } satisfies ExtensionMessage) as ReviewStateResponse;
      if (!response.ok) throw new Error(response.error);
      setDocuments(response.documents);
      const selectedDocument = selectedDocumentId
        ? response.documents.find((item) => item.id === selectedDocumentId)
        : undefined;
      const matchingJob = response.jobs.find((item) => (
        ACTIVE_JOB_STATUSES.has(item.status)
        && (selectedDocument
          ? item.documentId === selectedDocument.id
          : item.scopeFamilyKey === currentScopeFamilyKey)
      ));
      const matchingDocument = selectedDocument
        ?? (matchingJob
          ? response.documents.find((item) => item.id === matchingJob.documentId)
          : response.documents.find((item) => item.scopeFamilyKey === currentScopeFamilyKey));
      const matchingVersion = matchingDocument?.activeVersionId
        ? response.versions.find((item) => item.id === matchingDocument.activeVersionId)
        : undefined;
      if (matchingDocument) setDocument(matchingDocument);
      if (matchingVersion || matchingJob) releaseCapture();
      if (matchingVersion) {
        setVersion(matchingVersion);
        setScopeMetadata({
          scope: matchingJob?.scope ?? matchingVersion.scope,
          scopeFamilyKey: matchingJob?.scopeFamilyKey ?? matchingDocument!.scopeFamilyKey,
        });
        editBaselineRef.current = matchingVersion;
        setView("result");
      }
      if (matchingJob) {
        setJob(matchingJob);
        if (!matchingVersion) {
          setScopeMetadata({
            scope: matchingJob.scope,
            scopeFamilyKey: matchingJob.scopeFamilyKey,
          });
        }
        setView("result");
      }
    } catch (error) {
      onError?.(messageFromError(error));
    }
  }, [currentScopeFamilyKey, onError, projectId, releaseCapture]);

  useEffect(() => {
    if (!open || !job || !ACTIVE_JOB_STATUSES.has(job.status)) return;
    return listenForReviewJob(job.id, (nextJob, nextVersion) => {
      setJob(nextJob);
      setScopeMetadata((current) => current ?? {
        scope: nextVersion?.scope ?? nextJob.scope,
        scopeFamilyKey: nextJob.scopeFamilyKey,
      });
      if (nextVersion) {
        setVersion(nextVersion);
        if (!dirty) editBaselineRef.current = nextVersion;
        setView("result");
      }
    });
  }, [job, open]);

  useEffect(() => {
    if (!job || ACTIVE_JOB_STATUSES.has(job.status)) return;
    if (sourceTransferRef.current?.sessionId === reviewSessionRef.current) return;
    // Full source messages are needed only while a task is active. Keep the
    // persisted scope/version metadata for display, but release raw text as
    // soon as any terminal state is observed.
    releaseCapture();
  }, [job?.status, releaseCapture]);

  useEffect(() => {
    if (!open || !projectId || !currentScopeFamilyKey) return;
    void refreshStoredState();
  }, [currentScopeFamilyKey, open, projectId, refreshStoredState]);

  useEffect(() => {
    if (!open || !job || !ACTIVE_JOB_STATUSES.has(job.status)) return;
    const timer = window.setInterval(() => {
      void browser.runtime.sendMessage({
        type: "GET_REVIEW_JOB",
        jobId: job.id,
      } satisfies ExtensionMessage).then((response: unknown) => {
        const result = response as { ok?: boolean; job?: ReviewJob; version?: ReviewVersion };
        if (!result.ok || !result.job) return;
        setJob(result.job);
        setScopeMetadata((current) => current ?? {
          scope: result.version?.scope ?? result.job!.scope,
          scopeFamilyKey: result.job!.scopeFamilyKey,
        });
        if (result.version) setVersion(result.version);
      }).catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [job, open]);

  function openReview(options: OpenReviewOptions = {}) {
    if (!projectId) {
      onError?.("请先选择项目。");
      return;
    }
    const nextEntry = options.entrySource ?? entrySource;
    const target = options.anchorNodeId ?? defaultAnchorNodeId;
    const nodeMenu = nextEntry === "node_menu";
    reviewSessionRef.current += 1;
    sourceTransferRef.current = undefined;
    setActiveEntrySource(nextEntry);
    setAnchorNodeId(target);
    setScopeType(options.scopeType ?? (nodeMenu ? "node_context" : "current_branch"));
    setAllowPartial(false);
    setGraphAnchorNodeId(undefined);
    // Never let source text from a previously opened scope survive while a
    // different node/conversation is being collected.
    releaseCapture();
    setScopeMetadata(undefined);
    setDirty(false);
    setFailedEvidenceIds(new Set());
    keepDraftOnCloseRef.current = false;
    editBaselineRef.current = undefined;
    setDocument(undefined);
    setVersion(undefined);
    setJob(undefined);
    setView(options.documentId ? "result" : "config");
    setOpen(true);
    void loadPreferences(nodeMenu).then((preferences) => {
      if (!preferences) return;
      if (!nodeMenu && !options.scopeType) setScopeType(preferences.scopeType);
      setModuleIds(preferences.moduleIds);
      setPresetId(preferences.presetId);
    });
    if (options.documentId) void refreshStoredState(options.documentId);
    else void collect(chatIdForNode(nodes, target));
  }

  function closeReview() {
    const baseline = editBaselineRef.current;
    if (!keepDraftOnCloseRef.current && dirty && baseline && version?.id === baseline.id) {
      setVersion(baseline);
      void browser.runtime.sendMessage({
        type: "UPDATE_REVIEW_VERSION",
        versionId: baseline.id,
        changes: {
          title: baseline.title,
          modules: baseline.modules,
        },
      } satisfies ExtensionMessage).catch(() => undefined);
    }
    reviewSessionRef.current += 1;
    sourceTransferRef.current = undefined;
    setOpen(false);
    releaseCapture();
    setDirty(false);
    keepDraftOnCloseRef.current = false;
  }

  async function generate(request: ReviewGenerateRequest) {
    if (!projectId) return;
    const sessionId = reviewSessionRef.current;
    const transfer = { id: ++sourceTransferIdRef.current, sessionId };
    sourceTransferRef.current = transfer;
    try {
      let source = capture;
      if (!source) source = await collect(chatIdForNode(nodes, anchorNodeId));
      if (sessionId !== reviewSessionRef.current || !source) return;
      const nextResolved = resolveReviewScope({
        projectId,
        scopeType: request.scopeType,
        nodes,
        capture: source,
        ...(anchorNodeId ? { targetNodeId: anchorNodeId } : {}),
        chatId: source.chatId,
      });
      setScopeMetadata({
        scope: nextResolved.scope,
        scopeFamilyKey: nextResolved.scopeFamilyKey,
      });
      if (!nextResolved.messages.length) {
        onError?.("所选范围没有可用于总结的完整消息。");
        return;
      }
      if (nextResolved.scope.completeness === "partial" && !request.allowPartial) {
        onError?.("来源存在缺失。请先补全来源，或确认生成带缺失标记的部分结果。");
        return;
      }
      setLoading(true);
      setView("result");
      await requestReviewProviderPermission();
      if (sessionId !== reviewSessionRef.current) return;
      const response = await uploadReviewSourceAndStart(source, {
        projectId,
        entrySource: activeEntrySource,
        scopeType: request.scopeType,
        ...(anchorNodeId ? { anchorNodeId } : {}),
        moduleIds: request.moduleIds,
        presetId: request.presetId,
        allowPartial: request.allowPartial,
      });
      if (sessionId === reviewSessionRef.current) releaseCapture();
      if (!response.ok) throw new Error(response.error);
      if (sessionId !== reviewSessionRef.current) return;
      setJob(response.job);
      if (response.document) setDocument(response.document);
      if (response.version) setVersion(response.version);
      if (response.version) editBaselineRef.current = response.version;
      setDirty(false);
      await savePreferences({
        scopeType: request.scopeType,
        moduleIds: request.moduleIds,
        presetId: request.presetId,
      }).catch(() => undefined);
    } catch (error) {
      if (sessionId === reviewSessionRef.current) {
        setView("config");
        onError?.(messageFromError(error));
      }
    } finally {
      if (sourceTransferRef.current?.id === transfer.id) {
        sourceTransferRef.current = undefined;
        releaseCapture();
        if (sessionId === reviewSessionRef.current) setLoading(false);
      }
    }
  }

  async function persistVersion(changes: Extract<ExtensionMessage, { type: "UPDATE_REVIEW_VERSION" }>["changes"]) {
    if (!version) return;
    if (version.id.startsWith("review-live:")) return;
    const response = await browser.runtime.sendMessage({
      type: "UPDATE_REVIEW_VERSION",
      versionId: version.id,
      changes,
    } satisfies ExtensionMessage) as ReviewMutationResponse;
    if (!response.ok) throw new Error(response.error);
    if (response.version) setVersion(response.version);
  }

  function updateModules(nextModules: ReviewModuleResult[]) {
    if (!version) return;
    editBaselineRef.current ??= version;
    setVersion({ ...version, modules: nextModules, updatedAt: Date.now() });
    setDirty(true);
    void persistVersion({ modules: nextModules }).catch((error) => onError?.(messageFromError(error)));
  }

  function updateModule(
    moduleId: ReviewModuleId,
    nextSnapshot: ReviewModuleSnapshot,
    markUserEdits = true,
  ) {
    if (!version) return;
    const previous = version.modules.find((module) => module.moduleId === moduleId)?.current;
    const next = markUserEdits && previous
      ? {
          ...nextSnapshot,
          items: nextSnapshot.items.map((item) => {
            const before = previous.items.find((candidate) => candidate.id === item.id);
            return before && before.text !== item.text
              ? { ...item, isUserEdited: true }
              : item;
          }),
        }
      : nextSnapshot;
    updateModules(version.modules.map((module) => module.moduleId === moduleId
      ? {
          ...module,
          current: next,
          editHistory: [...module.editHistory, module.current].slice(-20),
          editedAt: Date.now(),
        }
      : module));
  }

  async function retry(moduleId?: ReviewModuleId) {
    if (!projectId || !job) return;
    const sessionId = reviewSessionRef.current;
    const transfer = { id: ++sourceTransferIdRef.current, sessionId };
    sourceTransferRef.current = transfer;
    try {
      const source = await collect(job.scope.chatId);
      if (sessionId !== reviewSessionRef.current || !source) return;
      const nextResolved = resolveReviewScope({
        projectId,
        scopeType: job.scope.type,
        nodes,
        capture: source,
        ...(job.scope.anchorNodeId ? { targetNodeId: job.scope.anchorNodeId } : {}),
        chatId: source.chatId,
      });
      setScopeMetadata({
        scope: nextResolved.scope,
        scopeFamilyKey: nextResolved.scopeFamilyKey,
      });
      setLoading(true);
      await requestReviewProviderPermission();
      if (sessionId !== reviewSessionRef.current) return;
      const response = await uploadReviewSourceAndStart(source, {
        projectId,
        entrySource: activeEntrySource,
        scopeType: job.scope.type,
        ...(job.scope.anchorNodeId ? { anchorNodeId: job.scope.anchorNodeId } : {}),
        moduleIds: moduleId ? [moduleId] : job.selectedModuleIds,
        presetId: job.presetId,
        allowPartial: job.scope.completeness === "partial",
        retryJobId: job.id,
        ...(moduleId ? { retryModuleId: moduleId } : {}),
      });
      if (sessionId === reviewSessionRef.current) releaseCapture();
      if (!response.ok) throw new Error(response.error);
      if (sessionId !== reviewSessionRef.current) return;
      setJob(response.job);
      if (response.version) setVersion(response.version);
    } catch (error) {
      if (sessionId === reviewSessionRef.current) onError?.(messageFromError(error));
    } finally {
      if (sourceTransferRef.current?.id === transfer.id) {
        sourceTransferRef.current = undefined;
        releaseCapture();
        if (sessionId === reviewSessionRef.current) setLoading(false);
      }
    }
  }

  async function saveToGraph(strategy: ReviewGraphSaveStrategy) {
    if (!document) return false;
    try {
      const selectedGraphAnchorNodeId = graphAnchorNodeId
        ?? chooseGraphAnchor(scopeMetadata?.scope ?? version?.scope ?? resolved?.scope, nodes, anchorNodeId);
      const response = await browser.runtime.sendMessage({
        type: "SAVE_REVIEW_TO_GRAPH",
        documentId: document.id,
        strategy,
        ...(selectedGraphAnchorNodeId ? { graphAnchorNodeId: selectedGraphAnchorNodeId } : {}),
      } satisfies ExtensionMessage) as ReviewMutationResponse;
      if (!response.ok) throw new Error(response.error);
      if (response.document) setDocument(response.document);
      if (response.version) setVersion(response.version);
      setDirty(false);
      await onChanged?.();
      return true;
    } catch (error) {
      onError?.(messageFromError(error));
      return false;
    }
  }

  const scope = capture
    ? resolved?.scope ?? emptyScope(scopeType, capture.chatId, anchorNodeId)
    : scopeMetadata?.scope
      ?? version?.scope
      ?? job?.scope
      ?? resolved?.scope
      ?? emptyScope(scopeType, "", anchorNodeId);
  const matchingSaved = documents.some((item) => (
    item.scopeFamilyKey === currentScopeFamilyKey && item.savedAt !== undefined
  ));
  const unavailableEvidenceIds = [...new Set([
    ...failedEvidenceIds,
    ...(version?.evidences
    .filter((evidence) => !evidence.locator.messageId && !evidence.locator.turnId && !evidence.locator.fingerprint)
    .map((evidence) => evidence.id) ?? []),
  ])];
  const selectedGraphAnchorNodeId = graphAnchorNodeId
    ?? chooseGraphAnchor(scope, nodes, anchorNodeId);

  const dialogProps: ConversationReviewDialogProps | undefined = open ? {
    view,
    scope,
    selectedModuleIds: moduleIds,
    presetId,
    allowPartial,
    ...(version ? { version } : {}),
    ...(job ? { job } : {}),
    dirty,
    stale: Boolean(
      version
      && scopeMetadata?.scope.sourceSnapshotHash
      && version.scope.sourceSnapshotHash !== scopeMetadata.scope.sourceSnapshotHash
    ),
    hasExistingGraphDocument: matchingSaved,
    disabledScopeTypes: {
      ...(!anchorNodeId ? {
        current_branch: "当前没有可用的图节点。",
        node_context: "请先选择一个图节点。",
      } : {}),
    },
    ...(loading ? { processingHint: "正在读取来源会话…" } : {}),
    unavailableEvidenceIds,
    onClose: closeReview,
    onViewChange: (next) => {
      setView(next);
      if (next === "result" && (version || job)) releaseCapture();
    },
    onScopeChange: (next) => {
      releaseCapture();
      setScopeMetadata(undefined);
      setScopeType(next);
      setAllowPartial(false);
      setDirty(true);
    },
    onModulesChange: (next, nextPreset) => {
      setModuleIds(next);
      setPresetId(nextPreset);
      setDirty(true);
    },
    onAllowPartialChange: (next) => {
      setAllowPartial(next);
      setDirty(true);
    },
    onGenerate: generate,
    ...(onOpenSettings ? { onOpenSettings } : {}),
    ...(scope.chatId ? {
      onOpenSource: async () => {
        try {
          const response = await browser.runtime.sendMessage({
            type: "OPEN_REVIEW_SOURCE",
            chatId: scope.chatId,
            collect: true,
          } satisfies ExtensionMessage) as OpenReviewSourceResponse;
          if (!response.ok) throw new Error(response.error);
          if (response.capture) {
            if (response.capture.chatId !== scope.chatId) {
              throw new Error("打开的标签不是这份总结的来源会话。");
            }
            const openedScope = resolveReviewScope({
              projectId: projectId!,
              scopeType: scope.type,
              nodes,
              capture: response.capture,
              ...(scope.anchorNodeId ? { targetNodeId: scope.anchorNodeId } : {}),
              chatId: scope.chatId,
            });
            setScopeMetadata({
              scope: openedScope.scope,
              scopeFamilyKey: openedScope.scopeFamilyKey,
            });
            if (view === "result" || version || job) releaseCapture();
            else setCapture(response.capture);
          }
          else await collect(scope.chatId);
        } catch (error) {
          onError?.(messageFromError(error));
        }
      },
    } : {}),
    ...(job && ACTIVE_JOB_STATUSES.has(job.status) ? {
      onCancelJob: async () => {
        const response = await cancelReviewJob(job.id);
        if (!response.ok) throw new Error(response.error);
        setJob(response.job);
      },
    } : {}),
    ...(job ? { onRetryAll: () => retry() } : {}),
    onRetryModule: (moduleId) => retry(moduleId),
    onTitleChange: (title) => {
      if (!version) return;
      editBaselineRef.current ??= version;
      setVersion({ ...version, title, updatedAt: Date.now() });
      setDirty(true);
      void persistVersion({ title }).catch((error) => onError?.(messageFromError(error)));
    },
    onUpdateModule: updateModule,
    onDeleteItem: (moduleId, itemId) => {
      const module = version?.modules.find((item) => item.moduleId === moduleId);
      if (!module) return;
      updateModule(moduleId, {
        ...module.current,
        items: module.current.items.filter((item) => item.id !== itemId),
      });
    },
    onUndoModuleEdit: (moduleId) => {
      if (!version) return;
      updateModules(version.modules.map((module) => {
        if (module.moduleId !== moduleId || !module.editHistory.length) return module;
        const previous = module.editHistory.at(-1)!;
        return { ...module, current: previous, editHistory: module.editHistory.slice(0, -1), editedAt: Date.now() };
      }));
    },
    onRestoreModule: (moduleId) => {
      const module = version?.modules.find((item) => item.moduleId === moduleId);
      if (module) updateModule(moduleId, structuredClone(module.generated), false);
    },
    onLocateEvidence: locateEvidence,
    onCopyAll: async () => version && copyText(buildReviewCopyText(version)),
    onCopyModule: async (moduleId) => {
      const module = version?.modules.find((item) => item.moduleId === moduleId);
      if (module && version) await copyText(buildReviewModuleCopyText(module, version.evidences));
    },
    onCopyContextPackage: async () => version && copyText(buildContinuationContextText(version.modules)),
    onExportMarkdown: async ({ includeEvidence }) => {
      if (!version) return;
      const exported = createReviewMarkdownExport(version, { includeEvidence });
      downloadText(exported.filename, exported.content, exported.mimeType);
    },
    onSaveToGraph: saveToGraph,
    ...(selectedGraphAnchorNodeId ? { graphAnchorNodeId: selectedGraphAnchorNodeId } : {}),
    graphAnchorNodeOptions: [...nodes]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((node) => ({ id: node.id, label: node.question })),
    onGraphAnchorChange: setGraphAnchorNodeId,
    onFeedback: (helpful) => {
      if (!version) return;
      setVersion({ ...version, helpful, updatedAt: Date.now() });
      void persistVersion({ helpful }).catch((error) => onError?.(messageFromError(error)));
    },
    onModuleFeedback: (moduleId, feedback) => {
      if (!version) return;
      const moduleFeedback = { ...version.moduleFeedback, [moduleId]: feedback };
      setVersion({ ...version, moduleFeedback, updatedAt: Date.now() });
      void persistVersion({ moduleFeedback }).catch((error) => onError?.(messageFromError(error)));
    },
    onCreateBranch: createBranch,
    onSaveDraft: async () => {
      await savePreferences({ scopeType, moduleIds, presetId }).catch(() => undefined);
      keepDraftOnCloseRef.current = true;
      setDirty(false);
      editBaselineRef.current = version;
    },
  } : undefined;

  async function locateEvidence(evidence: ReviewEvidence) {
    try {
      let response = await browser.runtime.sendMessage({
        type: "NAVIGATE_TO_REFERENCE",
        reference: {
          id: evidence.id,
          type: "assistant_quote",
          excerpt: evidence.excerpt,
          sourceLocator: evidence.locator,
        },
      } satisfies ExtensionMessage) as NavigateToNodeResponse;
      if (!response.ok && ["conversation_unavailable", "content_script_unavailable"].includes(response.status)) {
        const opened = await browser.runtime.sendMessage({
          type: "OPEN_REVIEW_SOURCE",
          chatId: evidence.chatId,
          collect: false,
        } satisfies ExtensionMessage) as OpenReviewSourceResponse;
        if (!opened.ok) throw new Error(opened.error);
        response = await browser.runtime.sendMessage({
          type: "NAVIGATE_TO_REFERENCE",
          sourceTabId: opened.tabId,
          reference: {
            id: evidence.id,
            type: "assistant_quote",
            excerpt: evidence.excerpt,
            sourceLocator: evidence.locator,
          },
        } satisfies ExtensionMessage) as NavigateToNodeResponse;
      }
      if (!response.ok) {
        setFailedEvidenceIds((current) => new Set(current).add(evidence.id));
        throw new Error(response.error);
      }
    } catch (error) {
      onError?.(messageFromError(error));
    }
  }

  async function createBranch(candidate: ReviewBranchCandidate) {
    if (!projectId || !version || !document) return;
    try {
      const response = await browser.runtime.sendMessage({
        type: "CREATE_REVIEW_BRANCH",
        projectId,
        chatId: version.scope.chatId,
        reviewDocumentId: document.id,
        candidate,
        ...(candidate.sourceNodeId || anchorNodeId
          ? { parentId: candidate.sourceNodeId ?? anchorNodeId }
          : {}),
      } satisfies ExtensionMessage) as ReviewMutationResponse;
      if (!response.ok) throw new Error(response.error);
      await onChanged?.();
    } catch (error) {
      onError?.(messageFromError(error));
    }
  }

  return { open, loading, openReview, closeReview, ...(dialogProps ? { dialogProps } : {}) };
}

function unavailableCapture(nodes: readonly QuestionNode[], anchorNodeId?: string): ReviewCaptureReport {
  const node = anchorNodeId ? nodes.find((item) => item.id === anchorNodeId) : nodes.at(-1);
  return {
    chatId: node?.chatId ?? "",
    messages: [],
    complete: false,
    missingSourceIds: [],
    stoppedReason: "source_unavailable",
  };
}

function chatIdForNode(
  nodes: readonly QuestionNode[],
  nodeId?: string,
): string | undefined {
  return nodeId ? nodes.find((node) => node.id === nodeId)?.chatId : undefined;
}

function emptyScope(type: ReviewScopeType, chatId: string, anchorNodeId?: string): ReviewScope {
  return {
    type,
    chatId,
    ...(anchorNodeId ? { anchorNodeId } : {}),
    nodeIds: [],
    messageSourceIds: [],
    messageCount: 0,
    nodeCount: 0,
    includesOtherBranches: false,
    completeness: "partial",
    missingSourceIds: [],
    estimatedTokens: 0,
    sourceSnapshotHash: "",
  };
}

function chooseGraphAnchor(
  scope: ReviewScope | undefined,
  nodes: readonly QuestionNode[],
  fallback?: string,
): string | undefined {
  if (!scope) return fallback;
  if (scope.type === "conversation") {
    return scope.rootNodeId
      ?? [...nodes]
        .filter((node) => node.chatId === scope.chatId && !node.parentId)
        .sort((a, b) => a.createdAt - b.createdAt)[0]?.id
      ?? fallback;
  }
  return scope.anchorNodeId ?? fallback;
}

async function loadPreferences(nodeMenu: boolean): Promise<StoredPreferences | undefined> {
  try {
    const stored = await browser.storage.local.get(REVIEW_PREFERENCES_KEY);
    const value = stored[REVIEW_PREFERENCES_KEY] as Partial<StoredPreferences> | undefined;
    if (!value || !Array.isArray(value.moduleIds)) return undefined;
    return {
      scopeType: nodeMenu ? "node_context" : value.scopeType ?? "current_branch",
      moduleIds: value.moduleIds,
      presetId: value.presetId ?? identifyReviewPreset(value.moduleIds),
    };
  } catch {
    return undefined;
  }
}

function savePreferences(value: StoredPreferences): Promise<void> {
  return browser.storage.local.set({ [REVIEW_PREFERENCES_KEY]: value });
}

function copyText(value: string): Promise<void> {
  return navigator.clipboard.writeText(value);
}

function downloadText(filename: string, contents: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "总结操作失败，请重试。";
}
