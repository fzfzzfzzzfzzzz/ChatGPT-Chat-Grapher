import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { recommendParentWithBailian } from "../ai/bailianClient";
import {
  conversationUrlForChat,
  getConversationId,
} from "../adapters/chatgpt/getConversation";
import { db } from "../db/database";
import { fallbackSummary, DiscussionService } from "../graph/discussionService";
import {
  buildFloatingPanelState,
  emptyFloatingPanelState,
} from "../graph/floatingPanelState";
import { getCurrentPath } from "../graph/questionTree";
import { canBeParentNode } from "../graph/parentEligibility";
import { initializeSidebarBehavior, openDiscussionDetail } from "../platform/sidebar";
import { selectExistingConversationTab } from "../platform/conversationNavigation";
import { getAISettings } from "../settings/storage";
import type {
  FloatingPanelState,
  CaptureQuestionResponse,
  ExtensionMessage,
  LocateQuestionResponse,
  NavigateToNodeResponse,
  PanelActionResponse,
} from "../shared/messages";
import { isExtensionMessage } from "../shared/messages";
import {
  CAPTURE_SERVICE_ENABLED_KEY,
  canCaptureQuestion,
  captureServiceEnabledFromStorage,
} from "../shared/captureService";
import type { CapturedQuestion, QuestionCandidate, QuestionNode } from "../types/domain";

const SELECTED_PROJECT_KEY = "selectedProjectId";
const service = new DiscussionService(db);

async function selectedProject() {
  const stored = await browser.storage.local.get(SELECTED_PROJECT_KEY);
  const selectedId = stored[SELECTED_PROJECT_KEY];
  const selected = typeof selectedId === "string" ? await service.projects.get(selectedId) : undefined;
  return selected ?? (await service.projects.list())[0];
}

async function captureServiceEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(CAPTURE_SERVICE_ENABLED_KEY);
  return captureServiceEnabledFromStorage(stored[CAPTURE_SERVICE_ENABLED_KEY]);
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

async function captureQuestion(
  captured: CapturedQuestion,
  manual = false,
): Promise<CaptureQuestionResponse> {
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
  await broadcastFloatingPanelState();

  try {
    const nodes = await service.nodes.listForProject(project.id);
    const focus = nodes.find((node) => node.id === project.focusNodeId);
    const currentPath = focus
      ? getCurrentPath(nodes, focus.id).filter(canBeParentNode)
      : [];
    const recommendation = await recommendParentWithBailian({
      question: candidate.question,
      fallbackSummary: candidate.summary,
      currentPath: currentPath.map(({ id, question, summary }) => ({ id, question, summary })),
      candidateNodes: nodes
        .filter(canBeParentNode)
        .slice(-30)
        .map(({ id, question, summary, status }) => ({ id, question, summary, status })),
    });
    const stillPending = await service.candidates.get(candidate.id);
    if (!stillPending) {
      const existingNode = await service.nodes.findByMessage(candidate.chatId, candidate.messageId);
      return {
        ok: true,
        destination: "duplicate",
        ...(existingNode ? { nodeId: existingNode.id } : {}),
      };
    }
    const latestNodes = await service.nodes.listForProject(project.id);
    const eligibleNodeIds = new Set(
      latestNodes.filter(canBeParentNode).map((node) => node.id),
    );
    recommendation.candidates = recommendation.candidates.filter((item) =>
      eligibleNodeIds.has(item.nodeId)
    );
    const reviewed = await service.recordRecommendation(candidate.id, recommendation);
    const settings = await getAISettings();
    const best = reviewed.recommendations[0];
    if (best && best.confidence >= settings.highConfidence) {
      const node = await service.promoteCandidate(candidate.id, best.nodeId, "ai", best.confidence);
      await broadcastFloatingPanelState();
      return { ok: true, destination: "graph", nodeId: node.id };
    }
    if (reviewed.noParentConfidence >= settings.highConfidence) {
      const node = await service.promoteCandidate(
        candidate.id,
        null,
        "ai",
        reviewed.noParentConfidence,
      );
      await broadcastFloatingPanelState();
      return { ok: true, destination: "graph", nodeId: node.id };
    }
    await broadcastFloatingPanelState();
    return { ok: true, destination: "inbox" };
  } catch {
    if (await service.candidates.get(candidate.id)) {
      await service.markCandidateFailed(candidate.id);
    }
    await broadcastFloatingPanelState();
    return { ok: true, destination: "inbox" };
  }
}

async function focusPanelParent(currentNodeId: string): Promise<void> {
  const node = await service.nodes.get(currentNodeId);
  if (!node?.parentId) throw new Error("当前问题没有 Parent。");
  await service.focusNode(node.parentId);
  await broadcastFloatingPanelState();
}

async function setPanelParent(message: Extract<ExtensionMessage, { type: "SET_PANEL_PARENT" }>) {
  if (message.currentNodeId) {
    await service.changeParent(message.currentNodeId, message.parentId, "user");
  } else if (message.currentCandidateId) {
    await service.promoteCandidate(message.currentCandidateId, message.parentId, "user");
  } else {
    throw new Error("当前问题尚不可修改 Parent。");
  }
  await broadcastFloatingPanelState();
}

async function selectPanelProject(projectId: string): Promise<void> {
  const project = await service.projects.get(projectId);
  if (!project) throw new Error("项目不存在或已被删除。");
  await browser.storage.local.set({ [SELECTED_PROJECT_KEY]: project.id });
  await broadcastFloatingPanelState();
}

async function createPanelProject(title: string, goal: string): Promise<void> {
  const cleanedTitle = title.trim();
  const project = await service.createProject(
    cleanedTitle,
    goal.trim() || `推进“${cleanedTitle}”相关讨论并保持问题主线清晰。`,
  );
  await browser.storage.local.set({ [SELECTED_PROJECT_KEY]: project.id });
  await broadcastFloatingPanelState();
}

async function deletePanelProject(projectId: string): Promise<void> {
  const [project, currentProject] = await Promise.all([
    service.projects.get(projectId),
    selectedProject(),
  ]);
  if (!project) throw new Error("项目不存在或已被删除。");

  await service.deleteProject(project.id);
  if (currentProject?.id === project.id) {
    const nextProject = (await service.projects.list())[0];
    if (nextProject) {
      await browser.storage.local.set({ [SELECTED_PROJECT_KEY]: nextProject.id });
    } else {
      await browser.storage.local.remove(SELECTED_PROJECT_KEY);
    }
  }
  await broadcastFloatingPanelState();
}

async function deletePanelNode(nodeId: string): Promise<void> {
  const [node, project] = await Promise.all([
    service.nodes.get(nodeId),
    selectedProject(),
  ]);
  if (!node || node.projectId !== project?.id) {
    throw new Error("该节点不属于当前项目，请刷新后重试。");
  }
  await service.deleteNode(node.id);
  await broadcastFloatingPanelState();
}

async function setPanelNodeStatus(
  message: Extract<ExtensionMessage, { type: "SET_PANEL_NODE_STATUS" }>,
): Promise<void> {
  const [node, project] = await Promise.all([
    service.nodes.get(message.nodeId),
    selectedProject(),
  ]);
  if (!node || node.projectId !== project?.id) {
    throw new Error("该节点不属于当前项目，请刷新后重试。");
  }
  await service.setStatus(node.id, message.status);
  await broadcastFloatingPanelState();
}

async function setCaptureServiceEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [CAPTURE_SERVICE_ENABLED_KEY]: enabled });
  await broadcastFloatingPanelState();
}

async function ignorePanelCurrent(
  message: Extract<ExtensionMessage, { type: "IGNORE_PANEL_CURRENT" }>,
): Promise<void> {
  const project = await selectedProject();
  if (!project) throw new Error("当前没有可用项目。");

  if (message.currentCandidateId) {
    const candidate = await service.candidates.get(message.currentCandidateId);
    if (!candidate || candidate.projectId !== project.id) {
      throw new Error("当前问题已发生变化，请刷新后重试。");
    }
    await service.candidates.delete(candidate.id);
  } else if (message.currentNodeId) {
    const node = await service.nodes.get(message.currentNodeId);
    if (!node || node.projectId !== project.id) {
      throw new Error("当前问题已发生变化，请刷新后重试。");
    }
    await service.deleteNode(node.id);
  } else {
    throw new Error("当前没有可忽略的问题。");
  }

  await broadcastFloatingPanelState();
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

  const sourceTabId = message.sourceTabId ?? senderTabId;
  const sourceTab = sourceTabId === undefined
    ? undefined
    : await browser.tabs.get(sourceTabId).catch(() => undefined);
  const chatTabs = await browser.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  let targetTab = selectExistingConversationTab(
    chatTabs,
    node.chatId,
    sourceTab?.windowId,
  );

  if (!targetTab && !message.openMode) {
    return {
      ok: false,
      status: "open_choice_required",
      error: "目标会话尚未在浏览器中打开。",
    };
  }

  let navigated = false;
  if (!targetTab && message.openMode === "new_tab") {
    targetTab = await browser.tabs.create({
      url: conversationUrlForChat(node.chatId),
      active: true,
      ...(sourceTab?.windowId !== undefined ? { windowId: sourceTab.windowId } : {}),
    });
    navigated = true;
  } else if (!targetTab && message.openMode === "current_tab") {
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
      url: conversationUrlForChat(node.chatId),
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

  if (navigated && !(await waitForConversationTab(targetTab.id, node.chatId))) {
    return {
      ok: false,
      status: "conversation_unavailable",
      error: "原会话不存在、已被删除，或当前账号无权访问。",
    };
  }

  return locateNodeInTab(targetTab.id, node);
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

async function locateNodeInTab(
  tabId: number,
  node: QuestionNode,
): Promise<NavigateToNodeResponse> {
  const delays = [0, 180, 360, 700, 1_100, 1_600];
  let lastResponse: LocateQuestionResponse | undefined;
  let receiverReached = false;

  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: "LOCATE_QUESTION",
        chatId: node.chatId,
        messageId: node.messageId,
        ...(node.messageAnchor ? { messageAnchor: node.messageAnchor } : {}),
        ...(node.messageLocator ? { messageLocator: node.messageLocator } : {}),
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
    if (rawMessage.type === "GET_FLOATING_PANEL_STATE") {
      void getFloatingPanelState(rawMessage.chatId, rawMessage.selectedNodeId)
        .then(sendResponse)
        .catch(() => sendResponse(emptyFloatingPanelState()));
      return true;
    }
    if (rawMessage.type === "CAPTURE_QUESTION") {
      void captureQuestion({
        ...rawMessage.captured,
        question: rawMessage.captured.question.trim(),
        messageId:
          rawMessage.captured.messageId ||
          `${rawMessage.captured.chatId}:${fallbackSummary(rawMessage.captured.question)}`,
      }, rawMessage.manual === true)
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "问题捕获失败。",
          } satisfies CaptureQuestionResponse),
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
    if (rawMessage.type === "FOCUS_PANEL_PARENT") {
      respondWithAction(focusPanelParent(rawMessage.currentNodeId), sendResponse);
      return true;
    }
    if (rawMessage.type === "SELECT_PANEL_PROJECT") {
      respondWithAction(selectPanelProject(rawMessage.projectId), sendResponse);
      return true;
    }
    if (rawMessage.type === "CREATE_PANEL_PROJECT") {
      respondWithAction(
        createPanelProject(rawMessage.title, rawMessage.goal),
        sendResponse,
      );
      return true;
    }
    if (rawMessage.type === "DELETE_PANEL_PROJECT") {
      respondWithAction(deletePanelProject(rawMessage.projectId), sendResponse);
      return true;
    }
    if (rawMessage.type === "DELETE_PANEL_NODE") {
      respondWithAction(deletePanelNode(rawMessage.nodeId), sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_PANEL_PARENT") {
      respondWithAction(setPanelParent(rawMessage), sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_PANEL_NODE_STATUS") {
      respondWithAction(setPanelNodeStatus(rawMessage), sendResponse);
      return true;
    }
    if (rawMessage.type === "SET_CAPTURE_SERVICE_ENABLED") {
      respondWithAction(setCaptureServiceEnabled(rawMessage.enabled), sendResponse);
      return true;
    }
    if (rawMessage.type === "IGNORE_PANEL_CURRENT") {
      respondWithAction(ignorePanelCurrent(rawMessage), sendResponse);
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

      // Chrome sidePanel.open must be invoked synchronously from the message
      // triggered by the user's click. Awaiting storage first loses its gesture.
      const opening = openDiscussionDetail(sender.tab.id);
      if (rawMessage.projectId) {
        void browser.storage.local
          .set({ [SELECTED_PROJECT_KEY]: rawMessage.projectId })
          .catch(() => undefined);
      }
      respondWithAction(opening, sendResponse);
      return true;
    }
    return undefined;
  });
});
