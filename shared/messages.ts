import type { CapturedQuestion, MessageLocator, NodeStatus } from "../types/domain";

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

export type PanelActionResponse =
  | { ok: true }
  | { ok: false; error: string };

export type BuildCurrentPageGraphResponse =
  | {
      ok: true;
      createdCount: number;
      skippedCount: number;
      activeNodeId: string;
    }
  | { ok: false; error: string };

export type ConversationOpenMode = "new_tab" | "current_tab";

export type NavigateToNodeStatus =
  | "located"
  | "open_choice_required"
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
  | { type: "OPEN_SIDE_PANEL"; projectId?: string }
  | { type: "DISCUSSION_MAP_CHANGED" }
  | { type: "FLOATING_PANEL_STATE_UPDATED"; state: FloatingPanelState }
  | { type: "CHATGPT_LOCATION_CHANGED"; chatId?: string }
  | { type: "CAPTURE_QUESTION"; captured: CapturedQuestion; manual?: boolean }
  | { type: "BUILD_CURRENT_PAGE_GRAPH"; capturedQuestions: CapturedQuestion[] }
  | {
      type: "REFINE_MESSAGE_LOCATOR";
      chatId: string;
      messageAnchor: string;
      messageLocator: MessageLocator;
    }
  | {
      type: "NAVIGATE_TO_NODE";
      nodeId: string;
      openMode?: ConversationOpenMode;
      sourceTabId?: number;
    }
  | { type: "FOCUS_PANEL_PARENT"; currentNodeId: string }
  | { type: "SELECT_PANEL_PROJECT"; projectId: string }
  | { type: "CREATE_PANEL_PROJECT"; title: string; goal: string }
  | { type: "DELETE_PANEL_PROJECT"; projectId: string }
  | { type: "DELETE_PANEL_NODE"; nodeId: string }
  | { type: "SET_CAPTURE_SERVICE_ENABLED"; enabled: boolean }
  | {
      type: "IGNORE_PANEL_CURRENT";
      currentNodeId?: string;
      currentCandidateId?: string;
    }
  | {
      type: "SET_PANEL_NODE_STATUS";
      nodeId: string;
      status: NodeStatus;
    }
  | {
      type: "SET_PANEL_PARENT";
      parentId: string | null;
      currentNodeId?: string;
      currentCandidateId?: string;
    }
  | {
      type: "LOCATE_QUESTION";
      chatId: string;
      messageId: string;
      messageAnchor?: string;
      messageLocator?: MessageLocator;
    };

export type CaptureQuestionResponse =
  | { ok: true; destination: "graph" | "inbox" | "duplicate" | "disabled"; nodeId?: string }
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
