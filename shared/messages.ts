import type {
  AIProviderId,
  AIProviderProfile,
  CapturedQuestion,
  MessageLocator,
  NodeStatus,
} from "../types/domain";

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
};

export type FloatingPanelState = {
  captureEnabled: boolean;
  projectId?: string;
  projectTitle: string;
  projects: FloatingPanelProjectOption[];
  graphNodes: FloatingPanelGraphNode[];
  latestQuestionKey?: string;
  viewingNodeId?: string;
  currentNodeId?: string;
  currentCandidateId?: string;
  currentQuestion?: string;
  currentSummary?: string;
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
    };

export type CaptureQuestionResponse =
  | {
      ok: true;
      destination: "graph" | "inbox" | "duplicate" | "disabled";
      nodeId?: string;
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
