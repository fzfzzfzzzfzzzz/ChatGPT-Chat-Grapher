// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionMessage, FloatingPanelState } from "../shared/messages";

const browserMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addMessageListener: vi.fn(),
  removeMessageListener: vi.fn(),
  storageGet: vi.fn(async () => ({})),
  storageSet: vi.fn(async () => undefined),
}));

const captureMocks = vi.hoisted(() => ({
  getAllCapturedQuestions: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: browserMocks.sendMessage,
      onMessage: {
        addListener: browserMocks.addMessageListener,
        removeListener: browserMocks.removeMessageListener,
      },
    },
    storage: {
      local: {
        get: browserMocks.storageGet,
        set: browserMocks.storageSet,
      },
    },
  },
}));

vi.mock("../adapters/chatgpt/questionCapture", () => captureMocks);

import { FloatingNavigationPanel } from "../entrypoints/chatgpt.content/FloatingNavigationPanel";

const baseState: FloatingPanelState = {
  captureEnabled: true,
  projectId: "project-1",
  projectTitle: "Project",
  projects: [{ id: "project-1", title: "Project" }],
  graphNodes: [
    { id: "root", parentId: null, question: "Root question", status: "pending" },
    { id: "child", parentId: "root", question: "Child question", status: "pending" },
  ],
  currentNodeId: "child",
  currentQuestion: "Child question",
  currentSummary: "Child summary",
  focusedNodeId: "child",
  parentId: "root",
  parentQuestion: "Root question",
  parentSummary: "Root summary",
  parentState: "ready",
  recommendedParents: [],
  parentOptions: [{ id: "root", question: "Root question" }],
};

function rootViewedState(): FloatingPanelState {
  return {
    captureEnabled: true,
    projectId: "project-1",
    projectTitle: "Project",
    projects: baseState.projects,
    graphNodes: baseState.graphNodes,
    viewingNodeId: "root",
    currentNodeId: "root",
    currentQuestion: "Root question",
    currentSummary: "Root summary",
    focusedNodeId: "child",
    parentState: "root",
    recommendedParents: [],
    parentOptions: [{ id: "child", question: "Child question" }],
  };
}

describe("FloatingNavigationPanel interactions", () => {
  beforeEach(() => {
    browserMocks.sendMessage.mockReset();
    browserMocks.addMessageListener.mockReset();
    browserMocks.removeMessageListener.mockReset();
    browserMocks.storageGet.mockClear();
    browserMocks.storageSet.mockClear();
    captureMocks.getAllCapturedQuestions.mockReset();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    window.history.replaceState({}, "", "/c/chat-1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("navigates to the original message for an Inbox candidate", async () => {
    const candidateState: FloatingPanelState = {
      captureEnabled: true,
      projectId: "project-1",
      projectTitle: "Project",
      projects: baseState.projects,
      graphNodes: [],
      currentCandidateId: "candidate-1",
      currentQuestion: "Candidate question",
      currentSummary: "Candidate summary",
      focusedNodeId: "child",
      parentState: "unresolved",
      recommendedParents: [],
      parentOptions: [],
    };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return candidateState;
      if (message.type === "NAVIGATE_TO_QUESTION") {
        return { ok: true, status: "located", tabId: 1 };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    expect(await screen.findByText("Candidate question")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "当前节点操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "定位原文" }));
    await userEvent.click(screen.getByRole("button", { name: "定位到原问题" }));

    await waitFor(() => expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "NAVIGATE_TO_QUESTION",
      source: { kind: "candidate", id: "candidate-1" },
    }));
  });

  it("expands the current summary from the action menu before closing it", async () => {
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    expect(screen.queryByText("Child summary")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "当前节点操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "查看摘要" }));

    expect(await screen.findByText("Child summary")).toBeDefined();
    expect(screen.queryByRole("menu", { name: "当前节点操作" })).toBeNull();
  });

  it("applies the returned state immediately after ignoring the current node", async () => {
    const emptyState: FloatingPanelState = {
      captureEnabled: true,
      projectId: "project-1",
      projectTitle: "Project",
      projects: baseState.projects,
      graphNodes: [],
      parentState: "empty",
      recommendedParents: [],
      parentOptions: [],
    };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      if (message.type === "IGNORE_PANEL_CURRENT") {
        return {
          ok: true,
          state: emptyState,
          result: { ignoredId: "child", kind: "node" },
        };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    expect(await screen.findByText("Child question")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "当前节点操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "忽略此节点" }));

    expect(await screen.findByText("已忽略当前问题。")).toBeDefined();
    expect(browserMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "IGNORE_PANEL_CURRENT",
      currentNodeId: "child",
      context: {},
    }));
  });

  it("keeps the previous state and shows the backend error when a mutation fails", async () => {
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      if (message.type === "IGNORE_PANEL_CURRENT") {
        return { ok: false, code: "STALE_STATE", error: "节点已经发生变化。" };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: "当前节点操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "忽略此节点" }));

    expect(await screen.findByText("节点已经发生变化。")).toBeDefined();
    expect(screen.getByText("Child question")).toBeDefined();
  });

  it("keeps only summary and source location in the parent menu", async () => {
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    expect(await screen.findByText("Child question")).toBeDefined();
    expect(screen.queryByText("Root summary")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "父节点操作" }));
    expect(screen.getByRole("menuitem", { name: "查看摘要" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "定位原文" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "查看父节点" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "更换父节点" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "查看摘要" }));

    expect(await screen.findByText("Root summary")).toBeDefined();
    expect(screen.queryByRole("menu", { name: "父节点操作" })).toBeNull();
  });

  it("opens node deletion confirmation from the current menu", async () => {
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") {
        return message.selectedNodeId === "root" ? rootViewedState() : baseState;
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    expect(await screen.findByText("Child question")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "图视角" }));
    await userEvent.click(await screen.findByRole("button", { name: "Root question" }));
    await waitFor(() => expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "GET_FLOATING_PANEL_STATE",
      selectedNodeId: "root",
    }));
    await userEvent.click(screen.getByRole("button", { name: "当前" }));
    expect(await screen.findByText("图中选中")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "当前节点操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除节点" }));

    expect(await screen.findByRole("button", { name: "确认删除" })).toBeDefined();
  });

  it("requests deletion of a graph node and all descendants", async () => {
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      if (message.type === "DELETE_PANEL_NODE") {
        return {
          ok: true,
          state: baseState,
          result: { deletedNodeId: "root", deletedNodeCount: 2 },
        };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: "图视角" }));
    const rootNode = await screen.findByRole("button", { name: "Root question" });
    fireEvent.contextMenu(rootNode);
    await userEvent.click(screen.getByRole("menuitem", { name: "删除节点及其子节点" }));
    expect(await screen.findByText(/全部 1 个子孙节点/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "DELETE_PANEL_NODE",
      nodeId: "root",
      deleteDescendants: true,
      context: {},
    }));
  });

  it("updates graph status from the context menu using the direct response", async () => {
    const updatedState: FloatingPanelState = {
      ...baseState,
      graphNodes: baseState.graphNodes.map((node) => node.id === "root"
        ? { ...node, status: "resolved" }
        : node),
    };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      if (message.type === "SET_PANEL_NODE_STATUS") {
        return {
          ok: true,
          state: updatedState,
          result: { nodeId: "root", status: "resolved" },
        };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: "图视角" }));
    const rootNode = await screen.findByRole("button", { name: "Root question" });
    fireEvent.contextMenu(rootNode);
    await userEvent.click(screen.getByRole("menuitem", { name: /标记状态/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "已完结" }));

    await waitFor(() => expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "SET_PANEL_NODE_STATUS",
      nodeId: "root",
      status: "resolved",
      context: {},
    }));
  });

  it("shows every project node in the graph view and supports zooming and panning", async () => {
    const graphNodes = Array.from({ length: 18 }, (_, index) => ({
      id: `node-${index}`,
      parentId: index === 0 ? null : `node-${index - 1}`,
      question: `Graph question ${index}`,
      status: index === 17 ? "pending" as const : "resolved" as const,
    }));
    const graphState: FloatingPanelState = {
      ...baseState,
      graphNodes,
      currentNodeId: "node-17",
      currentQuestion: "Graph question 17",
      focusedNodeId: "node-17",
      parentId: "node-16",
      parentQuestion: "Graph question 16",
    };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return graphState;
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Graph question 17");
    await userEvent.click(screen.getByRole("button", { name: "图视角" }));

    const graph = screen.getByRole("img", {
      name: "图视角显示项目的全部 18 个问题节点",
    });
    expect(screen.getByRole("button", { name: "Graph question 0" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Graph question 17" })).toBeDefined();
    expect(screen.getByLabelText("当前缩放比例").textContent).toBe("100%");

    await userEvent.click(screen.getByRole("button", { name: "放大图视角" }));
    expect(screen.getByLabelText("当前缩放比例").textContent).toBe("125%");
    await userEvent.click(screen.getByRole("button", { name: "适应全部节点" }));
    expect(screen.getByLabelText("当前缩放比例").textContent).toBe("100%");

    const canvas = graph.parentElement!;
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 286,
      width: 320,
      height: 286,
      toJSON: () => ({}),
    });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 160, clientY: 143 });
    expect(screen.getByLabelText("当前缩放比例").textContent).toBe("125%");
    await userEvent.click(screen.getByRole("button", { name: "适应全部节点" }));

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 60, clientY: 40 });

    expect(graph.querySelector(".chat-graph-map__viewport")?.getAttribute("transform"))
      .not.toBe("translate(0 0) scale(1)");
  });

  it("changes the parent and applies the returned node state", async () => {
    const {
      parentId: _parentId,
      parentQuestion: _parentQuestion,
      parentSummary: _parentSummary,
      ...stateWithoutParent
    } = baseState;
    const rootState: FloatingPanelState = { ...stateWithoutParent, parentState: "root" };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      if (message.type === "SET_PANEL_PARENT") {
        return {
          ok: true,
          state: rootState,
          result: { nodeId: "child", parentId: null },
        };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: "当前节点操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "更换父节点" }));
    await userEvent.click(screen.getByRole("radio", { name: /无父节点/ }));
    await userEvent.click(screen.getByRole("button", { name: /确认/ }));

    expect(await screen.findByText("已设为新的根节点。")).toBeDefined();
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "SET_PANEL_PARENT",
      parentId: null,
      currentNodeId: "child",
      context: {},
    });
  });

  it("updates capture state from the mutation response", async () => {
    const pausedState = { ...baseState, captureEnabled: false };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      if (message.type === "SET_CAPTURE_SERVICE_ENABLED") {
        return {
          ok: true,
          state: pausedState,
          result: { captureEnabled: false },
        };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: "暂停 Chat Graph 问题捕获" }));

    expect(await screen.findByText("捕获已暂停")).toBeDefined();
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "SET_CAPTURE_SERVICE_ENABLED",
      enabled: false,
      context: {},
    });
    expect(screen.queryByRole("button", { name: "补录当前对话的最近一个问题" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "选择问题" }));
    expect(await screen.findByText("滚动页面并点击任意用户问题")).toBeDefined();
  });

  it("reopens a dismissed floating panel when the side panel requests it", async () => {
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: "关闭 Chat Graph 浮窗" }));

    expect(screen.queryByLabelText("Chat Graph 当前讨论导航")).toBeNull();
    const listener = browserMocks.addMessageListener.mock.calls[0]?.[0] as
      | ((message: ExtensionMessage) => void)
      | undefined;
    expect(listener).toBeDefined();
    act(() => listener?.({ type: "OPEN_FLOATING_PANEL" }));

    expect(await screen.findByLabelText("Chat Graph 当前讨论导航")).toBeDefined();
    expect(screen.getByText("Child question")).toBeDefined();
  });

  it("expands a collapsed floating panel when the side panel requests it", async () => {
    browserMocks.storageGet.mockResolvedValueOnce({
      floatingPanelPreferencesV06: { schemaVersion: 2, mode: "collapsed" },
    });
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByRole("button", { name: "展开 Chat Graph 工作面板" });
    const listener = browserMocks.addMessageListener.mock.calls[0]?.[0] as
      | ((message: ExtensionMessage) => void)
      | undefined;
    expect(listener).toBeDefined();
    act(() => listener?.({ type: "OPEN_FLOATING_PANEL" }));

    expect(await screen.findByText("Child question")).toBeDefined();
    expect(screen.queryByRole("button", { name: "展开 Chat Graph 工作面板" })).toBeNull();
  });

  it("applies one-click graph results without issuing a follow-up state request", async () => {
    const captured = {
      question: "Imported question",
      chatId: "chat-1",
      messageId: "message-imported",
    };
    captureMocks.getAllCapturedQuestions.mockResolvedValue([captured]);
    const importedState = { ...baseState, viewingNodeId: "child" };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return baseState;
      if (message.type === "BUILD_CURRENT_PAGE_GRAPH") {
        return {
          ok: true,
          createdCount: 1,
          skippedCount: 0,
          activeNodeId: "child",
          state: importedState,
        };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    const getCallsBefore = browserMocks.sendMessage.mock.calls.filter(
      ([message]) => message.type === "GET_FLOATING_PANEL_STATE",
    ).length;
    await userEvent.click(screen.getByRole("button", { name: "将当前页面的所有问题一键建图" }));

    expect(await screen.findByText("已新增 1 个节点，忽略 0 个已有节点。")).toBeDefined();
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "BUILD_CURRENT_PAGE_GRAPH",
      capturedQuestions: [captured],
      context: {},
    });
    const getCallsAfter = browserMocks.sendMessage.mock.calls.filter(
      ([message]) => message.type === "GET_FLOATING_PANEL_STATE",
    ).length;
    expect(getCallsAfter).toBe(getCallsBefore);
  });

  it("switches projects from the state returned by the command", async () => {
    const projectState: FloatingPanelState = {
      ...baseState,
      projects: [
        { id: "project-1", title: "Project" },
        { id: "project-2", title: "Second project" },
      ],
    };
    const secondState: FloatingPanelState = {
      ...projectState,
      projectId: "project-2",
      projectTitle: "Second project",
      graphNodes: [],
      parentState: "empty",
      recommendedParents: [],
      parentOptions: [],
    };
    delete secondState.currentNodeId;
    delete secondState.currentQuestion;
    delete secondState.currentSummary;
    delete secondState.parentId;
    delete secondState.parentQuestion;
    delete secondState.parentSummary;
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return projectState;
      if (message.type === "SELECT_PANEL_PROJECT") {
        return { ok: true, state: secondState, result: { projectId: "project-2" } };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: /当前项目：Project/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Second project" }));

    expect(await screen.findByRole("button", { name: /当前项目：Second project/ })).toBeDefined();
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "SELECT_PANEL_PROJECT",
      projectId: "project-2",
      context: {},
    });
  });

  it("renames an existing project from the project menu", async () => {
    const projectState: FloatingPanelState = {
      ...baseState,
      projects: [
        { id: "project-1", title: "Project" },
        { id: "project-2", title: "Second project" },
      ],
    };
    const renamedState: FloatingPanelState = {
      ...projectState,
      projects: [
        { id: "project-1", title: "Project" },
        { id: "project-2", title: "Research project" },
      ],
    };
    browserMocks.sendMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === "GET_FLOATING_PANEL_STATE") return projectState;
      if (message.type === "RENAME_PANEL_PROJECT") {
        return { ok: true, state: renamedState, result: { projectId: "project-2" } };
      }
      return { ok: true };
    });

    render(<FloatingNavigationPanel />);
    await screen.findByText("Child question");
    await userEvent.click(screen.getByRole("button", { name: /当前项目：Project/ }));
    await userEvent.click(screen.getByRole("button", { name: "重命名项目：Second project" }));
    const input = screen.getByRole("textbox", { name: "重命名项目：Second project" });
    await userEvent.clear(input);
    await userEvent.type(input, "Research project");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("menuitemradio", { name: "Research project" })).toBeDefined();
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: "RENAME_PANEL_PROJECT",
      projectId: "project-2",
      title: "Research project",
      context: {},
    });
  });

});
