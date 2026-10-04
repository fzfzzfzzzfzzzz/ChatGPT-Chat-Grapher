import type {
  AIProviderId,
  AIProviderProfile,
  CapturedQuestion,
  ConversationReviewMessage,
  MessageLocator,
  NodeStatus,
  QuestionCandidate,
  QuestionNode,
  QuestionReference,
  ReferenceLocator,
  ReviewBranchCandidate,
  ReviewCaptureReport,
  ReviewDocument,
  ReviewEntrySource,
  ReviewJob,
  ReviewModuleId,
  ReviewModuleEdit,
  ReviewModuleResult,
  ReviewPresetId,
  ReviewScopeType,
  ReviewVersion,
} from "../types/domain";
import type { QuestionReferenceCounts } from "./questionReferences";

export type FloatingPanelMode = "collapsed" | "working";

export type FloatingPanelParentState =
  | "empty"
  | "processing"
  | "selecting"
  | "ready"
  | "root"
  | "unresolved";

export type FloatingPanelNodeOption = {
  id: string;
  question: string;
  confidence?: number;
  isPrevious?: boolean;
};

export type FloatingPanelProjectOption = {
  id: string;
  title: string;
};

export type FloatingPanelGraphNode = {
  id: string;
  parentId: string | null;
  question: string;
  status: NodeStatus;
  kind?: "captured" | "planned";
  referenceCounts?: QuestionReferenceCounts;
};

/** A saved conversation-review artifact projected for the compact graph.
 * It deliberately contains no review body or source transcript. */
export type FloatingPanelReviewArtifact = {
  id: string;
  title: string;
  anchorNodeId: string;
  documentId: string;
  versionId: string;
  savedAt: number;
  stale?: boolean;
};

export type FloatingPanelState = {
  captureEnabled: boolean;
  projectId?: string;
  projectTitle: string;
  projects: FloatingPanelProjectOption[];
  graphNodes: FloatingPanelGraphNode[];
  reviewArtifacts?: FloatingPanelReviewArtifact[];
  /** Local structural records used to resolve review scopes. Never contains assistant text. */
  reviewNodes?: QuestionNode[];
  latestQuestionKey?: string;
  viewingNodeId?: string;
  currentNodeId?: string;
  currentCandidateId?: string;
  currentQuestion?: string;
  currentSummary?: string;
  currentReferenceCounts?: QuestionReferenceCounts;
  focusedNodeId?: string;
  parentId?: string;
  parentQuestion?: string;
  parentSummary?: string;
  parentState: FloatingPanelParentState;
  recommendedParents: FloatingPanelNodeOption[];
  rootConfidence?: number;
  parentOptions: FloatingPanelNodeOption[];
};

export type PanelActionContext = {
  chatId?: string;
  viewingNodeId?: string;
};

export type PanelActionErrorCode =
  | "NOT_FOUND"
  | "STALE_STATE"
  | "INVALID_OPERATION"
  | "INTERNAL_ERROR";

export type PanelMutationResponse<T = Record<string, never>> =
  | { ok: true; state: FloatingPanelState; result: T }
  | { ok: false; code: PanelActionErrorCode; error: string };

export type PanelQuestionSource =
  | { kind: "node"; id: string }
  | { kind: "candidate"; id: string };

export type PanelDeleteResult = {
  deletedNodeId: string;
  deletedNodeCount: number;
  nextViewingNodeId?: string;
};

export type PanelParentResult = {
  nodeId: string;
  parentId: string | null;
};

export type PanelActionResponse =
  | { ok: true }
  | { ok: false; error: string };

export type ContentScriptReadyResponse = {
  ready: boolean;
};

export type TestAIProviderResponse =
  | { ok: true; providerId: AIProviderId; model: string }
  | { ok: false; error: string };

export type BuildCurrentPageGraphResponse =
  | {
      ok: true;
      createdCount: number;
      skippedCount: number;
      activeNodeId: string;
      state: FloatingPanelState;
    }
  | { ok: false; error: string };

/** Metadata may be persisted on a job. Source messages are uploaded in
 * bounded, memory-only chunks and discarded as soon as the job settles. */
export type ReviewSourceUploadMetadata = Omit<ReviewCaptureReport, "messages">;

export type StartReviewJobRequest = {
  projectId: string;
  entrySource: ReviewEntrySource;
  scopeType: ReviewScopeType;
  anchorNodeId?: string;
  moduleIds: ReviewModuleId[];
  presetId: ReviewPresetId;
  allowPartial: boolean;
  retryJobId?: string;
  retryModuleId?: ReviewModuleId;
};

export type ReviewJobResponse =
  | { ok: true; job: ReviewJob; document?: ReviewDocument; version?: ReviewVersion }
  | { ok: false; code?: string; error: string };

export type ReviewStateResponse =
  | {
      ok: true;
      documents: ReviewDocument[];
      versions: ReviewVersion[];
      jobs: ReviewJob[];
    }
  | { ok: false; error: string };

export type ReviewMutationResponse =
  | { ok: true; document?: ReviewDocument; version?: ReviewVersion; job?: ReviewJob }
  | { ok: false; code?: string; error: string };

export type ReviewSourceUploadResponse =
  | { ok: true; uploadId: string; receivedChunks?: number }
  | { ok: false; code?: string; error: string };

export type OpenReviewSourceResponse =
  | { ok: true; tabId: number; capture?: ReviewCaptureReport }
  | { ok: false; code: "SOURCE_UNAVAILABLE"; error: string };

export type NavigateToNodeStatus =
  | "located"
  | "conversation_unavailable"
  | "message_not_found"
  | "content_script_unavailable";

export type NavigateToNodeResponse =
  | { ok: true; status: "located"; tabId: number }
  | {
      ok: false;
      status: Exclude<NavigateToNodeStatus, "located">;
      error: string;
    };

export type ExtensionMessage =
  | { type: "GET_FLOATING_PANEL_STATE"; chatId?: string; selectedNodeId?: string }
  | { type: "GET_TAB_CAPTURE_STATE" }
  | { type: "TAB_CAPTURE_STATE_UPDATED"; enabled: boolean }
  | { type: "TAB_PROJECT_STATE_UPDATED"; selected: boolean }
  | { type: "PING_CHAT_GRAPH_CONTENT_SCRIPT" }
  | { type: "OPEN_FLOATING_PANEL" }
  | { type: "OPEN_SIDE_PANEL"; projectId?: string; view?: "graph" }
  | { type: "DISCUSSION_MAP_CHANGED" }
  | { type: "FLOATING_PANEL_STATE_UPDATED"; state: FloatingPanelState }
  | { type: "CHATGPT_LOCATION_CHANGED"; chatId?: string }
  | {
      type: "CAPTURE_QUESTION";
      captured: CapturedQuestion;
      manual?: boolean;
      context?: PanelActionContext;
    }
  | {
      type: "TEST_AI_PROVIDER";
      providerId: AIProviderId;
      profile: AIProviderProfile;
      timeoutMs: number;
    }
  | {
      type: "BUILD_CURRENT_PAGE_GRAPH";
      capturedQuestions: CapturedQuestion[];
      context: PanelActionContext;
    }
  | {
      type: "REFINE_MESSAGE_LOCATOR";
      chatId: string;
      messageAnchor: string;
      messageLocator: MessageLocator;
    }
  | {
      type: "NAVIGATE_TO_NODE";
      nodeId: string;
      sourceTabId?: number;
    }
  | {
      type: "NAVIGATE_TO_QUESTION";
      source: PanelQuestionSource;
      sourceTabId?: number;
    }
  | {
      type: "NAVIGATE_TO_REFERENCE";
      reference: QuestionReference;
      sourceTabId?: number;
    }
  | { type: "FOCUS_PANEL_PARENT"; currentNodeId: string }
  | { type: "SELECT_PANEL_PROJECT"; projectId: string; context: PanelActionContext }
  | { type: "CREATE_PANEL_PROJECT"; title: string; goal: string; context: PanelActionContext }
  | { type: "RENAME_PANEL_PROJECT"; projectId: string; title: string; context: PanelActionContext }
  | { type: "DELETE_PANEL_PROJECT"; projectId: string; context: PanelActionContext }
  | {
      type: "DELETE_PANEL_NODE";
      nodeId: string;
      deleteDescendants?: boolean;
      context: PanelActionContext;
    }
  | { type: "SET_CAPTURE_SERVICE_ENABLED"; enabled: boolean; context: PanelActionContext }
  | {
      type: "IGNORE_PANEL_CURRENT";
      currentNodeId?: string;
      currentCandidateId?: string;
      context: PanelActionContext;
    }
  | {
      type: "SET_PANEL_NODE_STATUS";
      nodeId: string;
      status: NodeStatus;
      context: PanelActionContext;
    }
  | {
      type: "SET_PANEL_PARENT";
      parentId: string | null;
      currentNodeId?: string;
      currentCandidateId?: string;
      context: PanelActionContext;
    }
  | {
      type: "LOCATE_QUESTION";
      chatId: string;
      messageId: string;
      messageAnchor?: string;
      messageLocator?: MessageLocator;
    }
  | {
      type: "LOCATE_REFERENCE";
      reference: QuestionReference & { sourceLocator: ReferenceLocator };
    }
  | { type: "COLLECT_REVIEW_SOURCE" }
  | { type: "OPEN_REVIEW_SOURCE"; chatId: string; collect?: boolean }
  | { type: "REQUEST_REVIEW_PROVIDER_PERMISSION" }
  | {
      type: "BEGIN_REVIEW_SOURCE_UPLOAD";
      uploadId: string;
      metadata: ReviewSourceUploadMetadata;
      totalChunks: number;
    }
  | {
      type: "APPEND_REVIEW_SOURCE_CHUNK";
      uploadId: string;
      index: number;
      messages: ConversationReviewMessage[];
    }
  | {
      type: "COMMIT_REVIEW_SOURCE_UPLOAD";
      uploadId: string;
      request: StartReviewJobRequest;
    }
  | { type: "DISCARD_REVIEW_SOURCE_UPLOAD"; uploadId: string }
  | { type: "GET_REVIEW_JOB"; jobId: string }
  | { type: "GET_PROJECT_REVIEWS"; projectId: string }
  | { type: "CANCEL_REVIEW_JOB"; jobId: string }
  | {
      type: "UPDATE_REVIEW_VERSION";
      versionId: string;
      changes: {
        title?: string;
        modules?: ReviewModuleEdit[];
        helpful?: boolean;
        moduleFeedback?: Partial<Record<ReviewModuleId, string>>;
      };
    }
  | {
      type: "SAVE_REVIEW_TO_GRAPH";
      documentId: string;
      strategy: "update" | "new";
      graphAnchorNodeId?: string;
    }
  | { type: "DELETE_REVIEW_DOCUMENT"; documentId: string }
  | { type: "CANCEL_PROJECT_REVIEWS"; projectId: string }
  | {
      type: "CREATE_REVIEW_BRANCH";
      projectId: string;
      chatId: string;
      reviewDocumentId: string;
      candidate: ReviewBranchCandidate;
      parentId?: string;
    }
  | { type: "REVIEW_JOB_UPDATED"; job: ReviewJob; version?: ReviewVersion }
  | { type: "REVIEW_DOCUMENTS_UPDATED"; projectId: string };

export type CaptureQuestionResponse =
  | {
      ok: true;
      destination: "graph" | "existing_node";
      nodeId: string;
      state: FloatingPanelState;
    }
  | {
      ok: true;
      destination: "inbox" | "existing_candidate";
      candidateId: string;
      candidateStatus: QuestionCandidate["status"];
      state: FloatingPanelState;
    }
  | {
      ok: true;
      destination: "disabled" | "unassigned";
      state: FloatingPanelState;
    }
  | { ok: false; error: string };

export type LocateQuestionMethod = "messageId" | "turnId" | "legacyMessageId" | "anchor";

export type LocateQuestionResponse =
  | { ok: true; method: LocateQuestionMethod }
  | {
      ok: false;
      code: "WRONG_CONVERSATION" | "CONVERSATION_UNAVAILABLE" | "MESSAGE_NOT_FOUND";
      error: string;
    };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof (value as { type?: unknown }).type === "string",
  );
}

/** Runtime guard for untrusted, ephemeral review-source metadata. */
export function isReviewSourceUploadMetadata(
  value: unknown,
): value is ReviewSourceUploadMetadata {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    "chatId",
    "conversationTitle",
    "complete",
    "missingSourceIds",
    "stoppedReason",
  ])) return false;
  if (!isBoundedNonEmptyString(value.chatId, 2_048)) return false;
  if (typeof value.complete !== "boolean") return false;
  if (
    !Array.isArray(value.missingSourceIds)
    || value.missingSourceIds.length > 10_000
    || !value.missingSourceIds.every((id) => isBoundedNonEmptyString(id, 2_048))
  ) return false;
  if (
    value.conversationTitle !== undefined
    && (typeof value.conversationTitle !== "string" || value.conversationTitle.length > 10_000)
  ) return false;
  if (
    value.stoppedReason !== undefined
    && value.stoppedReason !== "scan_limit"
    && value.stoppedReason !== "virtualization_stalled"
    && value.stoppedReason !== "source_unavailable"
  ) return false;
  return true;
}

/** Runtime guard for source text received across the extension message boundary. */
export function isConversationReviewMessage(
  value: unknown,
): value is ConversationReviewMessage {
  if (!isRecord(value) || !isRecord(value.locator)) return false;
  if (!hasOnlyKeys(value, [
    "sourceId",
    "chatId",
    "role",
    "content",
    "ordinal",
    "locator",
    "nodeId",
    "branchPath",
  ])) return false;
  if (!isBoundedNonEmptyString(value.sourceId, 2_048)) return false;
  if (!isBoundedNonEmptyString(value.chatId, 2_048)) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  if (typeof value.content !== "string") return false;
  if (!isNonNegativeInteger(value.ordinal)) return false;
  if (value.nodeId !== undefined && !isBoundedNonEmptyString(value.nodeId, 2_048)) return false;
  if (
    value.branchPath !== undefined
    && (
      !Array.isArray(value.branchPath)
      || value.branchPath.length > 10_000
      || !value.branchPath.every((id) => isBoundedNonEmptyString(id, 2_048))
    )
  ) return false;

  const locator = value.locator;
  if (!hasOnlyKeys(locator, [
    "version",
    "chatId",
    "role",
    "messageId",
    "turnId",
    "ordinal",
    "fingerprint",
  ])) return false;
  if (locator.version !== 1) return false;
  if (locator.chatId !== value.chatId || locator.role !== value.role) return false;
  if (
    locator.messageId !== undefined
    && !isBoundedNonEmptyString(locator.messageId, 2_048)
  ) return false;
  if (
    locator.turnId !== undefined
    && !isBoundedNonEmptyString(locator.turnId, 2_048)
  ) return false;
  if (locator.ordinal !== undefined && !isNonNegativeInteger(locator.ordinal)) return false;
  if (
    locator.fingerprint !== undefined
    && !isBoundedNonEmptyString(locator.fingerprint, 2_048)
  ) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function isTestAIProviderMessage(
  message: ExtensionMessage,
): message is Extract<ExtensionMessage, { type: "TEST_AI_PROVIDER" }> {
  if (message.type !== "TEST_AI_PROVIDER") return false;
  const profile = message.profile as unknown;
  return Boolean(
    typeof message.providerId === "string" &&
      Number.isFinite(message.timeoutMs) &&
      profile &&
      typeof profile === "object" &&
      "apiKey" in profile &&
      typeof profile.apiKey === "string" &&
      "baseUrl" in profile &&
      typeof profile.baseUrl === "string" &&
      "model" in profile &&
      typeof profile.model === "string",
  );
}
