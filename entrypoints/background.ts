import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { recommendParent, testAIProvider } from "../ai/client";
import { isAIProviderId } from "../ai/providers";
import {
  conversationUrlForChat,
  getConversationId,
} from "../adapters/chatgpt/getConversation";
import { db } from "../db/database";
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
import { selectExistingConversationTab } from "../platform/conversationNavigation";
import { getAISettings } from "../settings/storage";
import type {
  BuildCurrentPageGraphResponse,
  CaptureQuestionResponse,
  ConversationOpenMode,
  ExtensionMessage,
  FloatingPanelState,
  LocateQuestionResponse,
  NavigateToNodeResponse,
  PanelActionContext,
  PanelActionResponse,
  PanelQuestionSource,
  TestAIProviderResponse,
} from "../shared/messages";
import { isExtensionMessage, isTestAIProviderMessage } from "../shared/messages";
import {
  CAPTURE_SERVICE_ENABLED_KEY,
  canCaptureQuestion,
  captureServiceEnabledFromStorage,
} from "../shared/captureService";
import type { CapturedQuestion, QuestionCandidate, QuestionNode } from "../types/domain";

const SELECTED_PROJECT_KEY = "selectedProjectId";
const REQUESTED_SIDE_PANEL_VIEW_KEY = "requestedSidePanelView";
const service = new DiscussionService(db);

type CaptureQuestionResult =
  | {
      ok: true;
      destination: "graph" | "inbox" | "duplicate" | "disabled";
      nodeId?: string;
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

async function selectedProject() {
  const stored = await browser.storage.local.get(SELECTED_PROJECT_KEY);
  const selectedId = stored[SELECTED_PROJECT_KEY];
  const selected = typeof selectedId === "string" ? await service.projects.get(selectedId) : undefined;
  return selected ?? (await service.projects.list())[0];
}

async function setSelectedProjectId(projectId: string | undefined): Promise<void> {
  if (projectId) {
    await browser.storage.local.set({ [SELECTED_PROJECT_KEY]: projectId });
  } else {
    await browser.storage.local.remove(SELECTED_PROJECT_KEY);
  }
}

async function captureServiceEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(CAPTURE_SERVICE_ENABLED_KEY);
  return captureServiceEnabledFromStorage(stored[CAPTURE_SERVICE_ENABLED_KEY]);
}

async function setCaptureEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [CAPTURE_SERVICE_ENABLED_KEY]: enabled });
}

async function ensureSelectedProject(captured: CapturedQuestion) {
  const existing = await selectedProject();
  if (existing) {
    await browser.storage.local.set({ [SELECTED_PROJECT_KEY]: existing.id });
    return existing;
  }
  const project = await service.createProject(
    captured.conversationTitle || "ChatGPT 讨论",
    "找回主线、管理问题分支并定位原始聊天。",
  );
  await browser.storage.local.set({ [SELECTED_PROJECT_KEY]: project.id });
  return project;
}

async function getFloatingPanelState(
  chatId?: string,
  selectedNodeId?: string,
): Promise<FloatingPanelState> {
  const [project, projects, settings, captureEnabled] = await Promise.all([
    selectedProject(),
    service.projects.list(),
    getAISettings(),
    captureServiceEnabled(),
  ]);
  if (!project) return emptyFloatingPanelState("Chat Graph", projects, captureEnabled);
  const [nodes, candidates] = await Promise.all([
    service.nodes.listForProject(project.id),
    service.candidates.listForProject(project.id),
  ]);
  return buildFloatingPanelState({
    project,
    projects,
    captureEnabled,
    nodes,
    candidates,
    ...(chatId ? { chatId } : {}),
    ...(selectedNodeId ? { selectedNodeId } : {}),
    mediumConfidence: settings.mediumConfidence,
  });
}

function getFloatingPanelStateForContext(
  context: PanelActionContext,
): Promise<FloatingPanelState> {
  return getFloatingPanelState(context.chatId, context.viewingNodeId);
}

async function sendFloatingPanelState(tabId: number, chatId?: string): Promise<void> {
  const state = await getFloatingPanelState(chatId);
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
  manual = false,
): Promise<CaptureQuestionResult> {
  if (!canCaptureQuestion(await captureServiceEnabled(), manual)) {
    return { ok: true, destination: "disabled" };
  }
  const project = await ensureSelectedProject(captured);
  const created = await service.createCandidate(project.id, captured);
  if (!("recommendations" in created)) {
    return { ok: true, destination: "duplicate", nodeId: created.id };
  }
  if (created.status !== "processing") return { ok: true, destination: "duplicate" };

  const candidate = created as QuestionCandidate;
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
      const existingNode = await service.nodes.findByMessage(
        project.id,
        candidate.chatId,
        candidate.messageId,
      );
      return {
        ok: true,
        destination: "duplicate",
        ...(existingNode ? { nodeId: existingNode.id } : {}),
      };
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
    return { ok: true, destination: "inbox" };
  } catch {
    if (await service.candidates.get(candidate.id)) {
      await service.markCandidateFailed(candidate.id);
    }
    notifyFloatingPanelStateChanged();
    return { ok: true, destination: "inbox" };
  }
}

async function buildCurrentPageGraph(
  capturedQuestions: CapturedQuestion[],
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
  const project = await ensureSelectedProject(normalized[0]!);
  const result = await service.importLinearQuestions(project.id, normalized);
  notifyFloatingPanelStateChanged();
  return { ok: true, ...result };
}

async function captureQuestionWithState(
  captured: CapturedQuestion,
  manual: boolean,
  context?: PanelActionContext,
): Promise<CaptureQuestionResponse> {
  const response = await captureQuestion(captured, manual);
  if (!response.ok) return response;
  const stateContext: PanelActionContext = {
    ...(context ?? {}),
    chatId: context?.chatId ?? captured.chatId,
  };
  return {
    ...response,
    state: await getFloatingPanelStateForContext(stateContext),
  };
}

async function buildCurrentPageGraphWithState(
  capturedQuestions: CapturedQuestion[],
  context: PanelActionContext,
): Promise<BuildCurrentPageGraphResponse> {
  const response = await buildCurrentPageGraph(capturedQuestions);
  if (!response.ok) return response;
  return {
    ...response,
    state: await getFloatingPanelStateForContext({
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
) {
  const response = await executeFloatingPanelCommand(message, {
    service,
    getSelectedProject: selectedProject,
    setSelectedProjectId,
    setCaptureEnabled,
    getState: getFloatingPanelStateForContext,
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
  options: { openMode?: ConversationOpenMode; sourceTabId?: number },
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

async function navigateLocatableQuestion(
  question: LocatableQuestion,
  options: { openMode?: ConversationOpenMode; sourceTabId?: number },
  senderTabId?: number,
): Promise<NavigateToNodeResponse> {

  const sourceTabId = options.sourceTabId ?? senderTabId;
  const sourceTab = sourceTabId === undefined
    ? undefined
    : await browser.tabs.get(sourceTabId).catch(() => undefined);
  const chatTabs = await browser.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  let targetTab = selectExistingConversationTab(
    chatTabs,
    question.chatId,
    sourceTab?.windowId,
  );

  if (!targetTab && !options.openMode) {
    return {
      ok: false,
      status: "open_choice_required",
      error: "目标会话尚未在浏览器中打开。",
    };
  }

  let navigated = false;
  if (!targetTab && options.openMode === "new_tab") {
    targetTab = await browser.tabs.create({
      url: conversationUrlForChat(question.chatId),
      active: true,
      ...(sourceTab?.windowId !== undefined ? { windowId: sourceTab.windowId } : {}),
    });
    navigated = true;
  } else if (!targetTab && options.openMode === "current_tab") {
    const fallbackTab = sourceTab ?? (await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    }))[0];
    if (fallbackTab?.id === undefined) {
      return {
        ok: false,
        status: "conversation_unavailable",
        error: "没有可用于打开原会话的标签页。",
      };
    }
    targetTab = await browser.tabs.update(fallbackTab.id, {
      url: conversationUrlForChat(question.chatId),
      active: true,
    });
    navigated = true;
  }

  if (targetTab?.id === undefined) {
    return {
      ok: false,
      status: "conversation_unavailable",
      error: "无法打开原会话。",
    };
  }

  if (targetTab.windowId !== undefined) {
    await browser.windows.update(targetTab.windowId, { focused: true }).catch(() => undefined);
  }
  await browser.tabs.update(targetTab.id, { active: true }).catch(() => undefined);

  if (navigated && !(await waitForConversationTab(targetTab.id, question.chatId))) {
    return {
      ok: false,
      status: "conversation_unavailable",
      error: "原会话不存在、已被删除，或当前账号无权访问。",
    };
  }

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
      error: "原会话不存在、已被删除，或当前账号无权访问。",
    };
  }
  return {
    ok: false,
    status: "message_not_found",
    error: "已打开原会话，但没有找到对应问题。",
  };
}

async function waitForConversationTab(
  tabId: number,
  chatId: string,
  timeoutMs = 12_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(listener);
      resolve(result);
    };
    const inspect = async () => {
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      if (!tab) return finish(false);
      if (tab.status !== "complete") return;
      finish(Boolean(tab.url && getConversationId(tab.url) === chatId));
    };
    const listener = (updatedId: number) => {
      if (updatedId === tabId) void inspect();
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    browser.tabs.onUpdated.addListener(listener);
    void inspect();
  });
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

export default defineBackground(() => {
  initializeSidebarBehavior();

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
    if (rawMessage.type === "GET_FLOATING_PANEL_STATE") {
      void getFloatingPanelState(rawMessage.chatId, rawMessage.selectedNodeId)
        .then(sendResponse)
        .catch(() => sendResponse(emptyFloatingPanelState()));
      return true;
    }
    if (rawMessage.type === "CAPTURE_QUESTION") {
      const captured = {
        ...rawMessage.captured,
        question: rawMessage.captured.question.trim(),
        messageId:
          rawMessage.captured.messageId ||
          `${rawMessage.captured.chatId}:${fallbackSummary(rawMessage.captured.question)}`,
      };
      void captureQuestionWithState(
        captured,
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
      void buildCurrentPageGraphWithState(
        rawMessage.capturedQuestions,
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
    if (rawMessage.type === "FOCUS_PANEL_PARENT") {
      respondWithAction(focusPanelParent(rawMessage.currentNodeId), sendResponse);
      return true;
    }
    if (rawMessage.type === "SELECT_PANEL_PROJECT") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "CREATE_PANEL_PROJECT") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "RENAME_PANEL_PROJECT") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "DELETE_PANEL_PROJECT") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "DELETE_PANEL_NODE") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_PANEL_PARENT") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_PANEL_NODE_STATUS") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_CAPTURE_SERVICE_ENABLED") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
      return true;
    }
    if (rawMessage.type === "IGNORE_PANEL_CURRENT") {
      void handleFloatingPanelCommand(rawMessage).then(sendResponse);
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
