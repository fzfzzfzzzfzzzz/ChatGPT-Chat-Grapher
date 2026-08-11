import {
  ArrowDown,
  Check,
  ChevronDown,
  ExternalLink,
  GitBranch,
  GripVertical,
  List,
  Minus,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { browser } from "wxt/browser";
import { getConversationId } from "../../adapters/chatgpt/getConversation";
import {
  getAllCapturedQuestions,
  getLatestCapturedQuestion,
} from "../../adapters/chatgpt/questionCapture";
import {
  hasRecognizedNewQuestion,
  shouldResetFloatingPanelSelection,
} from "../../graph/floatingPanelSelection";
import { CompactProjectGraph } from "./CompactProjectGraph";
import {
  type BuildCurrentPageGraphResponse,
  type CaptureQuestionResponse,
  type ConversationOpenMode,
  type ExtensionMessage,
  type FloatingPanelMode,
  type FloatingPanelState,
  type NavigateToNodeResponse,
  type PanelActionResponse,
} from "../../shared/messages";
import { isExtensionMessage } from "../../shared/messages";
import type { NodeStatus } from "../../types/domain";

const PANEL_PREFERENCES_KEY = "floatingPanelPreferencesV06";
const VIEWPORT_GAP = 12;

const EMPTY_STATE: FloatingPanelState = {
  captureEnabled: true,
  projectTitle: "Chat Graph",
  projects: [],
  graphNodes: [],
  parentState: "empty",
  recommendedParents: [],
  parentOptions: [],
};

type PanelPreferences = {
  schemaVersion?: 2;
  mode: FloatingPanelMode;
  view?: FloatingPanelView;
  x?: number;
  y?: number;
};

type FloatingPanelView = "current" | "graph";

type ParentEditorProps = {
  state: FloatingPanelState;
  compact?: boolean;
  onCancel?: () => void;
  onComplete: () => void;
  onError: (message: string) => void;
};

export function FloatingNavigationPanel() {
  const panelRef = useRef<HTMLElement>(null);
  const selectedNodeIdRef = useRef<string | undefined>(undefined);
  const latestQuestionKeyRef = useRef<string | undefined>(undefined);
  const projectIdRef = useRef<string | undefined>(undefined);
  const panelStateRequestRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | undefined>(undefined);
  const [state, setState] = useState<FloatingPanelState>(EMPTY_STATE);
  const [mode, setMode] = useState<FloatingPanelMode>("working");
  const [panelView, setPanelView] = useState<FloatingPanelView>("current");
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [editingParent, setEditingParent] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectGoal, setNewProjectGoal] = useState("");
  const [switchingProject, setSwitchingProject] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [confirmingDeleteProjectId, setConfirmingDeleteProjectId] = useState<string>();
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const [togglingCapture, setTogglingCapture] = useState(false);
  const [manualCapturing, setManualCapturing] = useState(false);
  const [buildingGraph, setBuildingGraph] = useState(false);
  const [ignoringCurrent, setIgnoringCurrent] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [confirmingNodeDelete, setConfirmingNodeDelete] = useState(false);
  const [deletingNode, setDeletingNode] = useState(false);
  const [parentSummaryExpanded, setParentSummaryExpanded] = useState(false);
  const [currentSummaryExpanded, setCurrentSummaryExpanded] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmingNavigationNodeId, setConfirmingNavigationNodeId] = useState<string>();
  const [pendingNavigationNodeId, setPendingNavigationNodeId] = useState<string>();
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(getPageTheme);

  useEffect(() => {
    void browser.storage.local
      .get(PANEL_PREFERENCES_KEY)
      .then((stored) => {
        const preferences = asPreferences(stored[PANEL_PREFERENCES_KEY]);
        if (!preferences) return;
        // Earlier v0.6 preferences inherited the old collapsed-by-default
        // behavior. Migrate once to the new working default while retaining the
        // user's saved position; subsequent explicit collapses are preserved.
        setMode(preferences.schemaVersion === 2 ? preferences.mode : "working");
        setPanelView(preferences.view ?? "current");
        if (preferences.x !== undefined && preferences.y !== undefined) {
          setPosition({ x: preferences.x, y: preferences.y });
        }
      })
      .finally(() => setPreferencesReady(true));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setTheme(getPageTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme"],
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "data-color-scheme"],
      });
    }
    media.addEventListener("change", updateTheme);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateTheme);
    };
  }, []);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeProjectMenu();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [projectMenuOpen]);

  useEffect(() => {
    const refreshForLocationChange = () => {
      clearGraphSelection();
      setEditingParent(false);
      setPanelView("current");
      void loadFloatingPanelState();
    };
    void loadFloatingPanelState();

    const listener = (message: unknown) => {
      if (isExtensionMessage(message) && message.type === "FLOATING_PANEL_STATE_UPDATED") {
        const incoming = message.state;
        const selected = selectedNodeIdRef.current;
        const previous = {
          projectId: projectIdRef.current,
          latestQuestionKey: latestQuestionKeyRef.current,
        };
        const newQuestion = hasRecognizedNewQuestion(
          previous,
          incoming,
        );
        const resetSelection = shouldResetFloatingPanelSelection(
          selected,
          previous,
          incoming,
        );
        rememberLatestState(incoming);
        setError(undefined);
        if (newQuestion) {
          panelStateRequestRef.current += 1;
          clearGraphSelection();
          setEditingParent(false);
          setPanelView("current");
          setState(incoming);
          return;
        }
        if (resetSelection) {
          panelStateRequestRef.current += 1;
          clearGraphSelection();
          setEditingParent(false);
          setState(incoming);
          return;
        }
        if (selected) {
          void loadFloatingPanelState(selected);
          return;
        }
        panelStateRequestRef.current += 1;
        setState(incoming);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    window.addEventListener("chat-graph-location-change", refreshForLocationChange);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      window.removeEventListener("chat-graph-location-change", refreshForLocationChange);
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    const timeout = window.setTimeout(() => {
      void browser.storage.local.set({
        [PANEL_PREFERENCES_KEY]: {
          schemaVersion: 2,
          mode,
          view: panelView,
          ...(position ? position : {}),
        } satisfies PanelPreferences,
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [mode, panelView, position, preferencesReady]);

  useEffect(() => {
    setParentSummaryExpanded(false);
    setCurrentSummaryExpanded(false);
  }, [
    state.currentNodeId,
    state.currentCandidateId,
    state.latestQuestionKey,
    state.viewingNodeId,
    state.parentId,
  ]);

  useEffect(() => {
    const clampCurrentPosition = () => {
      if (!position || !panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const next = clampPosition(position.x, position.y, rect.width, rect.height);
      if (next.x !== position.x || next.y !== position.y) setPosition(next);
    };
    window.addEventListener("resize", clampCurrentPosition);
    const frame = window.requestAnimationFrame(clampCurrentPosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", clampCurrentPosition);
    };
  }, [mode, position]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      if (!drag || !panel || event.pointerId !== drag.pointerId) return;
      const rect = panel.getBoundingClientRect();
      setPosition(
        clampPosition(
          event.clientX - drag.offsetX,
          event.clientY - drag.offsetY,
          rect.width,
          rect.height,
        ),
      );
    };
    const stop = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  function beginDrag(event: ReactPointerEvent<HTMLElement>, fromHandle = false) {
    if (
      event.button !== 0 ||
      (!fromHandle && (event.target as Element).closest("button, input, textarea"))
    ) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function rememberLatestState(nextState: FloatingPanelState) {
    projectIdRef.current = nextState.projectId;
    latestQuestionKeyRef.current = nextState.latestQuestionKey;
  }

  function setGraphSelection(nodeId: string | undefined) {
    selectedNodeIdRef.current = nodeId;
    setSelectedNodeId(nodeId);
    setConfirmingNavigationNodeId(undefined);
    setConfirmingNodeDelete(false);
  }

  function clearGraphSelection() {
    setGraphSelection(undefined);
  }

  async function loadFloatingPanelState(
    requestedNodeId?: string,
    reportError = false,
  ): Promise<boolean> {
    const requestId = ++panelStateRequestRef.current;
    const chatId = getConversationId(location.href);
    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_FLOATING_PANEL_STATE",
        ...(chatId ? { chatId } : {}),
        ...(requestedNodeId ? { selectedNodeId: requestedNodeId } : {}),
      } satisfies ExtensionMessage) as unknown;
      if (requestId !== panelStateRequestRef.current || !isFloatingPanelState(response)) {
        return false;
      }
      if (requestedNodeId && response.viewingNodeId !== requestedNodeId) {
        clearGraphSelection();
      }
      rememberLatestState(response);
      setState(response);
      return !requestedNodeId || response.viewingNodeId === requestedNodeId;
    } catch {
      if (requestId !== panelStateRequestRef.current) return false;
      if (requestedNodeId) clearGraphSelection();
      if (reportError) setError("暂时无法打开这个节点，请重试。");
      return false;
    }
  }

  async function selectGraphNode(nodeId: string) {
    setGraphSelection(nodeId);
    setEditingParent(false);
    setError(undefined);
    closeProjectMenu();
    return loadFloatingPanelState(nodeId, true);
  }

  async function viewGraphNodeDetails(nodeId: string) {
    if (await selectGraphNode(nodeId)) setPanelView("current");
  }

  async function focusParent() {
    if (!state.currentNodeId || !state.parentId) return;
    setProjectMenuOpen(false);
    setError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "FOCUS_PANEL_PARENT",
        currentNodeId: state.currentNodeId,
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) setError(response.error);
    } catch {
      setError("暂时无法切换到 Parent，请重试。");
    }
  }

  async function selectProject(projectId: string) {
    if (projectId === state.projectId) {
      closeProjectMenu();
      return;
    }
    setSwitchingProject(true);
    setError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "SELECT_PANEL_PROJECT",
        projectId,
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) setError(response.error);
      else closeProjectMenu();
    } catch {
      setError("暂时无法切换项目，请重试。");
    } finally {
      setSwitchingProject(false);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const title = newProjectTitle.trim();
    if (!title) return;
    setSavingProject(true);
    setError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "CREATE_PANEL_PROJECT",
        title,
        goal: newProjectGoal.trim(),
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) setError(response.error);
      else closeProjectMenu();
    } catch {
      setError("暂时无法创建项目，请重试。");
    } finally {
      setSavingProject(false);
    }
  }

  async function deleteProject(projectId: string) {
    setDeletingProjectId(projectId);
    setError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "DELETE_PANEL_PROJECT",
        projectId,
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setConfirmingDeleteProjectId(undefined);
    } catch {
      setError("暂时无法删除项目，请重试。");
    } finally {
      setDeletingProjectId(undefined);
    }
  }

  function closeProjectMenu() {
    setProjectMenuOpen(false);
    setCreatingProject(false);
    setNewProjectTitle("");
    setNewProjectGoal("");
    setConfirmingDeleteProjectId(undefined);
  }

  async function openDetail() {
    closeProjectMenu();
    setError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "OPEN_SIDE_PANEL",
        ...(state.projectId ? { projectId: state.projectId } : {}),
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) setError(response.error);
    } catch {
      setError("暂时无法打开完整 Graph，请重试或点击扩展工具栏图标。");
    }
  }

  async function setGraphNodeStatus(
    nodeId: string,
    status: NodeStatus,
  ): Promise<boolean> {
    setError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "SET_PANEL_NODE_STATUS",
        nodeId,
        status,
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) {
        setError(response.error);
        return false;
      }
      return true;
    } catch {
      setError("暂时无法更新节点状态，请重试。");
      return false;
    }
  }

  async function deleteGraphNode(nodeId: string): Promise<boolean> {
    setError(undefined);
    closeProjectMenu();
    try {
      const response = (await browser.runtime.sendMessage({
        type: "DELETE_PANEL_NODE",
        nodeId,
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) {
        setError(response.error);
        return false;
      }
      const retainedSelection = selectedNodeIdRef.current === nodeId
        ? undefined
        : selectedNodeIdRef.current;
      if (!retainedSelection) clearGraphSelection();
      await loadFloatingPanelState(retainedSelection);
      return true;
    } catch {
      setError("暂时无法删除这个节点，请重试。");
      return false;
    }
  }

  async function navigateGraphNode(
    nodeId: string,
    openMode?: ConversationOpenMode,
  ): Promise<boolean> {
    setError(undefined);
    setNavigationBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: "NAVIGATE_TO_NODE",
        nodeId,
        ...(openMode ? { openMode } : {}),
      } satisfies ExtensionMessage) as NavigateToNodeResponse;
      if (!response.ok) {
        if (response.status === "open_choice_required") {
          setPendingNavigationNodeId(nodeId);
          return true;
        }
        setPendingNavigationNodeId(undefined);
        setError(response.error);
        return false;
      }
      setPendingNavigationNodeId(undefined);
      return true;
    } catch {
      setError("暂时无法打开原会话，请重试。");
      return false;
    } finally {
      setNavigationBusy(false);
    }
  }

  async function toggleCaptureService() {
    const enabled = !state.captureEnabled;
    setTogglingCapture(true);
    setError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "SET_CAPTURE_SERVICE_ENABLED",
        enabled,
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setState((current) => ({ ...current, captureEnabled: enabled }));
    } catch {
      setError("暂时无法切换捕获服务，请重试。");
    } finally {
      setTogglingCapture(false);
    }
  }

  async function captureLatestQuestion() {
    setManualCapturing(true);
    setError(undefined);
    setNotice(undefined);
    closeProjectMenu();
    try {
      const captured = getLatestCapturedQuestion();
      if (!captured) {
        setError("当前对话中没有可补录的用户问题。");
        return;
      }
      const response = (await browser.runtime.sendMessage({
        type: "CAPTURE_QUESTION",
        captured,
        manual: true,
      } satisfies ExtensionMessage)) as CaptureQuestionResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      if (response.destination === "disabled") {
        setError("补录未执行，请重试。");
        return;
      }
      setNotice(
        response.destination === "duplicate"
          ? "最近一个问题已经在当前项目中。"
          : "已补录最近一个问题。",
      );
    } catch {
      setError("暂时无法补录最近问题，请重试。");
    } finally {
      setManualCapturing(false);
    }
  }

  async function buildCurrentPageGraph() {
    setBuildingGraph(true);
    setError(undefined);
    setNotice(undefined);
    closeProjectMenu();
    try {
      const capturedQuestions = await getAllCapturedQuestions();
      if (!capturedQuestions.length) {
        setError("当前页面没有可建图的用户问题。");
        return;
      }
      const response = (await browser.runtime.sendMessage({
        type: "BUILD_CURRENT_PAGE_GRAPH",
        capturedQuestions,
      } satisfies ExtensionMessage)) as BuildCurrentPageGraphResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setGraphSelection(response.activeNodeId);
      await loadFloatingPanelState(response.activeNodeId);
      setNotice(
        response.createdCount > 0
          ? `已新增 ${response.createdCount} 个节点，忽略 ${response.skippedCount} 个已有节点。`
          : "没有新增节点，已聚焦到当前页面最后一个问题。",
      );
    } catch {
      setError("一键建图失败，请重试。");
    } finally {
      setBuildingGraph(false);
    }
  }

  async function ignoreCurrentQuestion() {
    if (!state.currentNodeId && !state.currentCandidateId) return;
    setIgnoringCurrent(true);
    setError(undefined);
    closeProjectMenu();
    try {
      const response = (await browser.runtime.sendMessage({
        type: "IGNORE_PANEL_CURRENT",
        ...(state.currentNodeId ? { currentNodeId: state.currentNodeId } : {}),
        ...(state.currentCandidateId ? { currentCandidateId: state.currentCandidateId } : {}),
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setEditingParent(false);
    } catch {
      setError("暂时无法忽略当前问题，请重试。");
    } finally {
      setIgnoringCurrent(false);
    }
  }

  async function deleteViewedNode() {
    const nodeId = state.viewingNodeId;
    if (!nodeId) return;
    setDeletingNode(true);
    setError(undefined);
    closeProjectMenu();
    try {
      const response = (await browser.runtime.sendMessage({
        type: "DELETE_PANEL_NODE",
        nodeId,
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      clearGraphSelection();
      setEditingParent(false);
      setConfirmingNodeDelete(false);
      await loadFloatingPanelState();
    } catch {
      setError("暂时无法删除这个节点，请重试。");
    } finally {
      setDeletingNode(false);
    }
  }

  const panelStyle = position
    ? { left: `${position.x}px`, top: `${position.y}px`, right: "auto" }
    : undefined;
  const parentLabel = getParentLabel(state);
  const isViewingGraphNode = Boolean(
    selectedNodeId && state.viewingNodeId === selectedNodeId,
  );
  const viewedNodeChildCount = state.viewingNodeId
    ? state.graphNodes.filter((node) => node.parentId === state.viewingNodeId).length
    : 0;
  const currentAction = isViewingGraphNode ? (
    <button
      className="chat-graph-inline-action chat-graph-inline-action--delete"
      type="button"
      disabled={deletingNode}
      title="从项目图中删除这个节点"
      onClick={() => setConfirmingNodeDelete(true)}
    >
      删除节点
    </button>
  ) : (
    <button
      className="chat-graph-inline-action chat-graph-inline-action--ignore"
      type="button"
      disabled={ignoringCurrent || (!state.currentNodeId && !state.currentCandidateId)}
      title="从项目图中移除此问题"
      onClick={() => void ignoreCurrentQuestion()}
    >
      {ignoringCurrent ? "忽略中…" : "忽略"}
    </button>
  );

  if (mode === "collapsed") {
    return (
      <section
        ref={panelRef}
        className="chat-graph-panel chat-graph-panel--collapsed"
        data-theme={theme}
        style={panelStyle}
        aria-label="Chat Graph 当前讨论导航"
      >
        <button
          className="chat-graph-collapsed__drag-handle"
          type="button"
          title="拖动浮窗"
          aria-label="拖动 Chat Graph 浮窗"
          onPointerDown={(event) => beginDrag(event, true)}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <button
          className="chat-graph-collapsed"
          type="button"
          title="展开 Chat Graph"
          aria-label="展开 Chat Graph 工作面板"
          onClick={() => setMode("working")}
        >
          <span className="chat-graph-collapsed__project">{state.projectTitle}</span>
          <span className="chat-graph-collapsed__divider" aria-hidden="true">·</span>
          <span className="chat-graph-collapsed__parent" title={parentLabel}>
            {state.parentState === "root" || state.parentState === "empty"
              ? parentLabel
              : `Parent: ${parentLabel}`}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className="chat-graph-panel chat-graph-panel--working"
      data-theme={theme}
      style={panelStyle}
      aria-label="Chat Graph 当前讨论导航"
    >
      <header className="chat-graph-header" onPointerDown={beginDrag}>
        <button
          className="chat-graph-header__drag-handle"
          type="button"
          title="拖动浮窗"
          aria-label="拖动 Chat Graph 浮窗"
          onPointerDown={(event) => {
            event.stopPropagation();
            beginDrag(event, true);
          }}
        >
          <GripVertical size={15} aria-hidden="true" />
        </button>
        <div className="chat-graph-project-switcher">
          <button
            className="chat-graph-header__brand"
            type="button"
            title="切换项目"
            aria-label={`当前项目：${state.projectTitle}，点击切换项目`}
            aria-haspopup="menu"
            aria-expanded={projectMenuOpen}
            onClick={() => {
              if (projectMenuOpen) closeProjectMenu();
              else setProjectMenuOpen(true);
            }}
          >
            <span className="chat-graph-header__mark" aria-hidden="true" />
            <span>{state.projectTitle}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {projectMenuOpen ? (
            <div className="chat-graph-project-menu" role="menu" aria-label="切换 Chat Graph 项目">
              {creatingProject ? (
                <form className="chat-graph-project-form" onSubmit={(event) => void createProject(event)}>
                  <div className="chat-graph-project-menu__label">NEW PROJECT</div>
                  <label>
                    <span>项目名称</span>
                    <input
                      autoFocus
                      required
                      maxLength={80}
                      value={newProjectTitle}
                      placeholder="例如：产品发布计划"
                      onChange={(event) => setNewProjectTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>核心目标（可选）</span>
                    <textarea
                      rows={2}
                      maxLength={600}
                      value={newProjectGoal}
                      placeholder="这次讨论最终要解决什么？"
                      onChange={(event) => setNewProjectGoal(event.target.value)}
                    />
                  </label>
                  <div className="chat-graph-project-form__actions">
                    <button type="button" onClick={() => setCreatingProject(false)}>取消</button>
                    <button className="is-primary" type="submit" disabled={savingProject || !newProjectTitle.trim()}>
                      {savingProject ? "创建中…" : "创建并切换"}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="chat-graph-project-menu__label">PROJECTS</div>
                  {state.projects.map((project) =>
                    confirmingDeleteProjectId === project.id ? (
                      <div
                        key={project.id}
                        className="chat-graph-project-menu__confirm-delete"
                        role="group"
                        aria-label={`确认删除项目 ${project.title}`}
                      >
                        <span title={project.title}>删除“{project.title}”？</span>
                        <button
                          type="button"
                          disabled={deletingProjectId === project.id}
                          onClick={() => setConfirmingDeleteProjectId(undefined)}
                        >
                          取消
                        </button>
                        <button
                          className="is-danger"
                          type="button"
                          disabled={deletingProjectId === project.id}
                          onClick={() => void deleteProject(project.id)}
                        >
                          {deletingProjectId === project.id ? "删除中…" : "删除"}
                        </button>
                      </div>
                    ) : (
                      <div key={project.id} className="chat-graph-project-menu__item">
                        <button
                          className="chat-graph-project-menu__select"
                          type="button"
                          role="menuitemradio"
                          aria-checked={project.id === state.projectId}
                          disabled={switchingProject || Boolean(deletingProjectId)}
                          onClick={() => void selectProject(project.id)}
                        >
                          <span title={project.title}>{project.title}</span>
                          {project.id === state.projectId ? <Check size={14} aria-hidden="true" /> : null}
                        </button>
                        <button
                          className="chat-graph-project-menu__delete"
                          type="button"
                          title={`删除项目：${project.title}`}
                          aria-label={`删除项目：${project.title}`}
                          disabled={switchingProject || Boolean(deletingProjectId)}
                          onClick={() => setConfirmingDeleteProjectId(project.id)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </div>
                    ),
                  )}
                  <div className="chat-graph-project-menu__divider" />
                  <button
                    className="chat-graph-project-menu__create"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setConfirmingDeleteProjectId(undefined);
                      setCreatingProject(true);
                    }}
                  >
                    <span><Plus size={14} aria-hidden="true" /> 新建项目</span>
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
        <div className="chat-graph-header__actions">
          <button
            className={`chat-graph-capture-toggle${state.captureEnabled ? " is-enabled" : " is-paused"}`}
            type="button"
            title={state.captureEnabled ? "暂停问题捕获" : "开启问题捕获"}
            aria-label={state.captureEnabled ? "暂停 Chat Graph 问题捕获" : "开启 Chat Graph 问题捕获"}
            aria-pressed={state.captureEnabled}
            disabled={togglingCapture}
            onClick={() => void toggleCaptureService()}
          >
            {state.captureEnabled
              ? <Pause size={15} aria-hidden="true" />
              : <Play size={15} aria-hidden="true" />}
          </button>
          <button
            className="chat-graph-manual-capture"
            type="button"
            title={manualCapturing ? "正在补录最近问题" : "补录最近问题"}
            aria-label="补录当前对话的最近一个问题"
            disabled={manualCapturing || buildingGraph}
            onClick={() => void captureLatestQuestion()}
          >
            <RefreshCw
              className={manualCapturing ? "is-spinning" : undefined}
              size={15}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            title="收起浮窗"
            aria-label="收起 Chat Graph 浮窗"
            onClick={() => {
              setEditingParent(false);
              closeProjectMenu();
              setMode("collapsed");
            }}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            title={import.meta.env.FIREFOX ? "在新标签页打开完整 Graph" : "打开完整 Graph"}
            aria-label={import.meta.env.FIREFOX ? "在新标签页打开 Chat Graph" : "打开 Chat Graph 详情页"}
            onClick={() => void openDetail()}
          >
            <ExternalLink size={15} />
          </button>
        </div>
      </header>

      <div className="chat-graph-panel__body">
        <nav className="chat-graph-view-tabs" aria-label="浮窗视角">
          <button
            type="button"
            className={`${panelView === "current" ? "is-active" : ""}${isViewingGraphNode ? " has-selection" : ""}`.trim() || undefined}
            aria-current={panelView === "current" ? "page" : undefined}
            onClick={() => setPanelView("current")}
          >
            <List size={13} aria-hidden="true" />
            当前
            {isViewingGraphNode ? (
              <span className="chat-graph-view-tabs__selection-dot" aria-hidden="true" />
            ) : null}
          </button>
          <button
            type="button"
            className={panelView === "graph" ? "is-active" : undefined}
            aria-current={panelView === "graph" ? "page" : undefined}
            onClick={() => {
              setEditingParent(false);
              closeProjectMenu();
              setPanelView("graph");
            }}
          >
            <GitBranch size={13} aria-hidden="true" />
            图视角
          </button>
          <button
            className="chat-graph-view-tabs__build"
            type="button"
            title={buildingGraph ? "正在读取完整会话并建图" : "将当前页面的所有问题生成线性图"}
            aria-label="将当前页面的所有问题一键建图"
            disabled={buildingGraph || manualCapturing}
            onClick={() => void buildCurrentPageGraph()}
          >
            <Network
              className={buildingGraph ? "is-spinning" : undefined}
              size={13}
              aria-hidden="true"
            />
            {buildingGraph ? "读取并建图…" : "一键建图"}
          </button>
        </nav>

        {!state.captureEnabled ? (
          <div className="chat-graph-capture-paused" role="status">
            <Pause size={13} aria-hidden="true" />
            <span><strong>捕获已暂停</strong>你发送的新内容不会加入项目</span>
            <button
              type="button"
              disabled={manualCapturing || buildingGraph}
              onClick={() => void captureLatestQuestion()}
            >
              {manualCapturing ? "补录中…" : "补录最近问题"}
            </button>
          </div>
        ) : null}

        {notice ? (
          <div className="chat-graph-notice" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="关闭补录提示" onClick={() => setNotice(undefined)}>
              <X size={13} />
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="chat-graph-alert" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="关闭错误提示" onClick={() => setError(undefined)}>
              <X size={13} />
            </button>
          </div>
        ) : null}

        {panelView === "graph" ? (
          <CompactProjectGraph
            nodes={state.graphNodes ?? []}
            {...(state.currentNodeId ? { currentNodeId: state.currentNodeId } : {})}
            {...(state.focusedNodeId ? { focusedNodeId: state.focusedNodeId } : {})}
            {...(selectedNodeId ? { selectedNodeId } : {})}
            onSelectNode={(nodeId) => void selectGraphNode(nodeId)}
            onViewNodeDetails={(nodeId) => void viewGraphNodeDetails(nodeId)}
            onSetNodeStatus={setGraphNodeStatus}
            onDeleteNode={deleteGraphNode}
            onRequestLocateNode={setConfirmingNavigationNodeId}
          />
        ) : state.parentState === "selecting" ? (
          <>
            <section className="chat-graph-section chat-graph-section--current chat-graph-section--selection-current">
              <div className="chat-graph-section__heading">
                <div className="chat-graph-label">CURRENT</div>
                <div className="chat-graph-section__actions">
                  {state.currentQuestion ? (
                    <button
                      className={`chat-graph-summary-toggle${currentSummaryExpanded ? " is-expanded" : ""}`}
                      type="button"
                      aria-expanded={currentSummaryExpanded}
                      aria-controls="chat-graph-current-summary"
                      onClick={() => setCurrentSummaryExpanded((expanded) => !expanded)}
                    >
                      <ChevronDown size={13} aria-hidden="true" />
                      摘要
                    </button>
                  ) : null}
                  {currentAction}
                </div>
              </div>
              <p className="chat-graph-copy chat-graph-copy--current" title={state.currentQuestion}>
                {state.currentQuestion || "—"}
              </p>
              {currentSummaryExpanded ? (
                <div id="chat-graph-current-summary" className="chat-graph-inline-summary">
                  <div className="chat-graph-label">CURRENT SUMMARY</div>
                  <p title={state.currentSummary}>{state.currentSummary || "生成中…"}</p>
                </div>
              ) : null}
            </section>
            <ParentEditor
              state={state}
              compact
              onComplete={() => setEditingParent(false)}
              onError={setError}
            />
          </>
        ) : (
          <>
            <section className="chat-graph-section chat-graph-section--parent">
              <div className="chat-graph-section__heading">
                <div className="chat-graph-label">PARENT</div>
                <div className="chat-graph-section__actions">
                  {state.parentSummary ? (
                    <button
                      className={`chat-graph-summary-toggle${parentSummaryExpanded ? " is-expanded" : ""}`}
                      type="button"
                      aria-expanded={parentSummaryExpanded}
                      aria-controls="chat-graph-parent-summary"
                      onClick={() => setParentSummaryExpanded((expanded) => !expanded)}
                    >
                      <ChevronDown size={13} aria-hidden="true" />
                      摘要
                    </button>
                  ) : null}
                  <button
                    className="chat-graph-inline-action"
                    type="button"
                    disabled={state.parentState === "processing" || (!state.currentNodeId && !state.currentCandidateId)}
                    onClick={() => {
                      setError(undefined);
                      setProjectMenuOpen(false);
                      setEditingParent(true);
                    }}
                  >
                    Change Parent
                  </button>
                </div>
              </div>
              <button
                className={`chat-graph-copy chat-graph-copy--parent${state.parentId && state.focusedNodeId === state.parentId ? " is-focused" : ""}`}
                type="button"
                title={state.parentId ? `聚焦 Parent：${parentLabel}` : parentLabel}
                disabled={!state.parentId || !state.currentNodeId}
                onClick={() => void focusParent()}
              >
                {state.parentState === "processing" ? (
                  <span className="chat-graph-loading-dot" aria-hidden="true" />
                ) : null}
                <span className="chat-graph-copy__text">{parentLabel}</span>
                {state.parentId && state.focusedNodeId === state.parentId ? (
                  <small>已聚焦</small>
                ) : null}
              </button>
              {parentSummaryExpanded && state.parentSummary ? (
                <div id="chat-graph-parent-summary" className="chat-graph-inline-summary">
                  <div className="chat-graph-label">PARENT SUMMARY</div>
                  <p title={state.parentSummary}>{state.parentSummary}</p>
                </div>
              ) : null}
            </section>

            <div className="chat-graph-connector" aria-hidden="true">
              <span />
              <ArrowDown size={14} />
            </div>

            <section className="chat-graph-section chat-graph-section--current">
              <div className="chat-graph-section__heading">
                <div className="chat-graph-label chat-graph-label--current">
                  CURRENT
                  {isViewingGraphNode ? <small>图中选中</small> : null}
                </div>
                <div className="chat-graph-section__actions">
                  {state.currentQuestion ? (
                    <button
                      className={`chat-graph-summary-toggle${currentSummaryExpanded ? " is-expanded" : ""}`}
                      type="button"
                      aria-expanded={currentSummaryExpanded}
                      aria-controls="chat-graph-current-summary"
                      onClick={() => setCurrentSummaryExpanded((expanded) => !expanded)}
                    >
                      <ChevronDown size={13} aria-hidden="true" />
                      摘要
                    </button>
                  ) : null}
                  {currentAction}
                </div>
              </div>
              <p className="chat-graph-copy chat-graph-copy--current" title={state.currentQuestion}>
                {state.currentQuestion || "—"}
              </p>
              {currentSummaryExpanded ? (
                <div id="chat-graph-current-summary" className="chat-graph-inline-summary">
                  <div className="chat-graph-label">CURRENT SUMMARY</div>
                  <p title={state.currentSummary}>{state.currentSummary || "生成中…"}</p>
                </div>
              ) : null}
              {isViewingGraphNode && confirmingNodeDelete ? (
                <div
                  className="chat-graph-node-delete-confirm"
                  role="group"
                  aria-label={`确认删除节点：${state.currentQuestion || "当前节点"}`}
                >
                  <p>
                    {viewedNodeChildCount
                      ? `删除后，${viewedNodeChildCount} 个直接子节点会移动到当前父级。`
                      : "这个节点会从本地问题图中删除。"}
                  </p>
                  <div>
                    <button
                      type="button"
                      disabled={deletingNode}
                      onClick={() => setConfirmingNodeDelete(false)}
                    >
                      取消
                    </button>
                    <button
                      className="is-danger"
                      type="button"
                      disabled={deletingNode}
                      onClick={() => void deleteViewedNode()}
                    >
                      {deletingNode ? "删除中…" : "确认删除"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

          </>
        )}
      </div>

      {editingParent ? (
        <div className="chat-graph-editor-layer">
          <ParentEditor
            state={state}
            onCancel={() => setEditingParent(false)}
            onComplete={() => setEditingParent(false)}
            onError={setError}
          />
        </div>
      ) : null}
      {confirmingNavigationNodeId ? (
        <div className="chat-graph-navigation-layer" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="chat-graph-locate-title">
            <h3 id="chat-graph-locate-title">定位到原问题？</h3>
            <p title={state.graphNodes.find((node) => node.id === confirmingNavigationNodeId)?.question}>
              {state.graphNodes.find((node) => node.id === confirmingNavigationNodeId)?.question}
            </p>
            <small>插件会打开对应会话，并定位、高亮这条问题。</small>
            <div>
              <button type="button" disabled={navigationBusy} onClick={() => setConfirmingNavigationNodeId(undefined)}>取消</button>
              <button
                className="is-primary"
                type="button"
                disabled={navigationBusy}
                onClick={() => {
                  const nodeId = confirmingNavigationNodeId;
                  setConfirmingNavigationNodeId(undefined);
                  void navigateGraphNode(nodeId);
                }}
              >
                {navigationBusy ? "正在定位…" : "定位到原问题"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingNavigationNodeId ? (
        <div className="chat-graph-navigation-layer" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="chat-graph-navigation-title">
            <h3 id="chat-graph-navigation-title">原会话尚未打开</h3>
            <p title={state.graphNodes.find((node) => node.id === pendingNavigationNodeId)?.question}>
              {state.graphNodes.find((node) => node.id === pendingNavigationNodeId)?.question}
            </p>
            <small>请选择打开方式，插件随后会继续定位原问题。</small>
            <div>
              <button type="button" disabled={navigationBusy} onClick={() => setPendingNavigationNodeId(undefined)}>取消</button>
              <button type="button" disabled={navigationBusy} onClick={() => void navigateGraphNode(pendingNavigationNodeId, "current_tab")}>当前页打开</button>
              <button className="is-primary" type="button" disabled={navigationBusy} onClick={() => void navigateGraphNode(pendingNavigationNodeId, "new_tab")}>
                {navigationBusy ? "正在打开…" : "新标签页打开"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ParentEditor({
  state,
  compact = false,
  onCancel,
  onComplete,
  onError,
}: ParentEditorProps) {
  const suggestedSelection = useMemo(() => {
    const previous = state.recommendedParents.find((option) => option.isPrevious);
    if (previous) return previous.id;
    const best = state.recommendedParents.reduce<
      { id: string; confidence: number } | undefined
    >((result, option) => {
      const confidence = option.confidence ?? 0;
      return !result || confidence > result.confidence
        ? { id: option.id, confidence }
        : result;
    }, undefined);
    return (state.rootConfidence ?? 0) > (best?.confidence ?? 0) ? "" : best?.id;
  }, [state.recommendedParents, state.rootConfidence]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(
    compact ? suggestedSelection ?? "" : state.parentId ?? "",
  );
  const [saving, setSaving] = useState(false);
  const options = compact ? state.recommendedParents : state.parentOptions;
  const filteredOptions = options.filter((option) =>
    option.question.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  async function confirm() {
    setSaving(true);
    onError("");
    try {
      const response = (await browser.runtime.sendMessage({
        type: "SET_PANEL_PARENT",
        parentId: selectedId || null,
        ...(state.currentNodeId ? { currentNodeId: state.currentNodeId } : {}),
        ...(state.currentCandidateId ? { currentCandidateId: state.currentCandidateId } : {}),
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) {
        onError(response.error);
        return;
      }
      onComplete();
    } catch {
      onError("暂时无法更新 Parent，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`chat-graph-parent-editor${compact ? " is-compact" : ""}`}>
      <div className="chat-graph-parent-editor__title">
        <div>
          <div className="chat-graph-label">{compact ? "SELECT PARENT" : "CHANGE PARENT"}</div>
          {!compact ? <p>为当前问题选择新的直接父问题</p> : null}
        </div>
        {onCancel ? (
          <button type="button" title="取消" aria-label="取消修改 Parent" onClick={onCancel}>
            <X size={15} />
          </button>
        ) : null}
      </div>

      {!compact ? (
        <label className="chat-graph-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">搜索节点</span>
          <input
            type="search"
            placeholder="Search nodes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}

      <div className="chat-graph-parent-options" role="radiogroup" aria-label="Parent 候选">
        {filteredOptions.map((option) => (
          <label key={option.id} className="chat-graph-parent-option">
            <input
              type="radio"
              name={compact ? "recommended-parent" : "changed-parent"}
              value={option.id}
              checked={selectedId === option.id}
              onChange={() => setSelectedId(option.id)}
            />
            <span title={option.question}>{option.question}</span>
            {option.isPrevious ? (
              <small className="is-previous">上一问</small>
            ) : option.confidence !== undefined ? (
              <small>{Math.round(option.confidence * 100)}%</small>
            ) : null}
          </label>
        ))}
        <label className="chat-graph-parent-option">
          <input
            type="radio"
            name={compact ? "recommended-parent" : "changed-parent"}
            value=""
            checked={selectedId === ""}
            onChange={() => setSelectedId("")}
          />
          <span>No Parent / Root</span>
          {compact && state.rootConfidence !== undefined ? (
            <small>{Math.round(state.rootConfidence * 100)}%</small>
          ) : null}
        </label>
      </div>

      {!filteredOptions.length && query ? (
        <p className="chat-graph-parent-editor__empty">没有匹配的节点</p>
      ) : null}

      <div className="chat-graph-parent-editor__actions">
        {onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}
        <button className="is-primary" type="button" disabled={saving} onClick={() => void confirm()}>
          <Check size={14} /> {saving ? "Saving…" : "Confirm"}
        </button>
      </div>
    </section>
  );
}

function getParentLabel(state: FloatingPanelState): string {
  if (state.parentState === "processing") return "判断中…";
  if (state.parentState === "selecting") return "待确认";
  if (state.parentState === "unresolved") return "未判断";
  if (state.parentState === "ready") return state.parentQuestion || "未判断";
  if (state.parentState === "root") return "Root";
  return "—";
}

function clampPosition(x: number, y: number, width: number, height: number) {
  return {
    x: Math.min(Math.max(VIEWPORT_GAP, x), Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP)),
    y: Math.min(Math.max(VIEWPORT_GAP, y), Math.max(VIEWPORT_GAP, window.innerHeight - height - VIEWPORT_GAP)),
  };
}

function asPreferences(value: unknown): PanelPreferences | undefined {
  if (!value || typeof value !== "object") return undefined;
  const preferences = value as Partial<PanelPreferences>;
  if (preferences.mode !== "collapsed" && preferences.mode !== "working") return undefined;
  return {
    mode: preferences.mode,
    ...(preferences.schemaVersion === 2 ? { schemaVersion: 2 as const } : {}),
    ...(preferences.view === "current" || preferences.view === "graph"
      ? { view: preferences.view }
      : {}),
    ...(typeof preferences.x === "number" ? { x: preferences.x } : {}),
    ...(typeof preferences.y === "number" ? { y: preferences.y } : {}),
  };
}

function isFloatingPanelState(value: unknown): value is FloatingPanelState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "projectTitle" in value &&
      typeof (value as { projectTitle?: unknown }).projectTitle === "string" &&
      "parentState" in value,
  );
}

function getPageTheme(): "light" | "dark" {
  const htmlTheme =
    document.documentElement.dataset.theme ||
    document.documentElement.dataset.colorScheme ||
    document.body?.dataset.theme ||
    document.body?.dataset.colorScheme;
  if (htmlTheme === "dark" || document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  if (htmlTheme === "light" || document.documentElement.classList.contains("light")) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
