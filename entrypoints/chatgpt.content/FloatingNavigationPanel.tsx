import {
  ArrowUp,
  Check,
  ChevronDown,
  GitBranch,
  GripVertical,
  List,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Network,
  PanelRightOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { browser } from "wxt/browser";
import { getConversationId } from "../../adapters/chatgpt/getConversation";
import {
  getAllCapturedQuestions,
  getCapturedQuestionFromElement,
  watchForRefinedMessageLocator,
} from "../../adapters/chatgpt/questionCapture";
import { CHATGPT_SELECTORS } from "../../adapters/chatgpt/selectors";
import {
  hasRecognizedNewQuestion,
  shouldResetFloatingPanelSelection,
} from "../../graph/floatingPanelSelection";
import { CompactProjectGraph } from "./CompactProjectGraph";
import {
  type BuildCurrentPageGraphResponse,
  type CaptureQuestionResponse,
  type ExtensionMessage,
  type FloatingPanelGraphNode,
  type FloatingPanelMode,
  type FloatingPanelState,
  type NavigateToNodeResponse,
  type PanelActionResponse,
  type PanelDeleteResult,
  type PanelMutationResponse,
  type PanelParentResult,
  type PanelQuestionSource,
} from "../../shared/messages";
import { isExtensionMessage } from "../../shared/messages";
import type { NodeStatus } from "../../types/domain";
import { FLOATING_PANEL_READY_EVENT } from "./panelLifecycle";

const PANEL_PREFERENCES_KEY = "floatingPanelPreferencesV06";
const REQUESTED_SIDE_PANEL_VIEW_KEY = "requestedSidePanelView";
const PAGE_QUESTION_SELECTION_ATTRIBUTE = "data-chat-graph-selecting-question";
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
type NodeDeleteMode = "node" | "subtree";

type NavigationTarget = PanelQuestionSource & { question: string };

type ParentEditorProps = {
  state: FloatingPanelState;
  compact?: boolean;
  onCancel?: () => void;
  onComplete: () => void;
  onSave: (parentId: string | null) => Promise<boolean>;
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
  const [dismissed, setDismissed] = useState(false);
  const [panelView, setPanelView] = useState<FloatingPanelView>("current");
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [editingParent, setEditingParent] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectGoal, setNewProjectGoal] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState<string>();
  const [renamedProjectTitle, setRenamedProjectTitle] = useState("");
  const [savingRenamedProject, setSavingRenamedProject] = useState(false);
  const [switchingProjectId, setSwitchingProjectId] = useState<string>();
  const [savingProject, setSavingProject] = useState(false);
  const [confirmingDeleteProjectId, setConfirmingDeleteProjectId] = useState<string>();
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const [togglingCapture, setTogglingCapture] = useState(false);
  const [selectingPageQuestion, setSelectingPageQuestion] = useState(false);
  const [importingPageQuestion, setImportingPageQuestion] = useState(false);
  const [buildingGraph, setBuildingGraph] = useState(false);
  const [ignoringCurrent, setIgnoringCurrent] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [confirmingNodeDelete, setConfirmingNodeDelete] = useState<NodeDeleteMode>();
  const [deletingNode, setDeletingNode] = useState(false);
  const [parentSummaryExpanded, setParentSummaryExpanded] = useState(false);
  const [currentSummaryExpanded, setCurrentSummaryExpanded] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmingNavigationTarget, setConfirmingNavigationTarget] = useState<NavigationTarget>();
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
      setSelectingPageQuestion(false);
      clearGraphSelection();
      setEditingParent(false);
      setPanelView("current");
      void loadFloatingPanelState();
    };
    void loadFloatingPanelState();

    const listener = (message: unknown) => {
      if (!isExtensionMessage(message)) return;
      if (message.type === "OPEN_FLOATING_PANEL") {
        setDismissed(false);
        setSelectingPageQuestion(false);
        clearGraphSelection();
        setEditingParent(false);
        setConfirmingNavigationTarget(undefined);
        closeProjectMenu();
        setMode("working");
        setPanelView("current");
        void loadFloatingPanelState();
        return;
      }
      if (message.type === "FLOATING_PANEL_STATE_UPDATED") {
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
          setSelectingPageQuestion(false);
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
    window.dispatchEvent(new Event(FLOATING_PANEL_READY_EVENT));
    window.addEventListener("chat-graph-location-change", refreshForLocationChange);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      window.removeEventListener("chat-graph-location-change", refreshForLocationChange);
    };
  }, []);

  useEffect(() => {
    if (!selectingPageQuestion) return;

    const style = document.createElement("style");
    style.dataset.chatGraphQuestionSelection = "true";
    style.textContent = `
      html[${PAGE_QUESTION_SELECTION_ATTRIBUTE}] ${CHATGPT_SELECTORS.userMessage} {
        cursor: copy !important;
        outline: 2px dashed rgba(15, 138, 131, 0.48) !important;
        outline-offset: 4px !important;
        border-radius: 8px !important;
        transition: outline-color 120ms ease, background-color 120ms ease !important;
      }
      html[${PAGE_QUESTION_SELECTION_ATTRIBUTE}] ${CHATGPT_SELECTORS.userMessage}:hover {
        outline-color: rgb(15, 138, 131) !important;
        background: rgba(15, 138, 131, 0.1) !important;
      }
    `;
    document.documentElement.setAttribute(PAGE_QUESTION_SELECTION_ATTRIBUTE, "true");
    (document.head ?? document.documentElement).append(style);

    const selectQuestion = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const message = event.target.closest<HTMLElement>(CHATGPT_SELECTORS.userMessage);
      if (!message) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setSelectingPageQuestion(false);
      void captureSelectedPageQuestion(message);
    };
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectingPageQuestion(false);
    };
    document.addEventListener("click", selectQuestion, true);
    window.addEventListener("keydown", cancelOnEscape);
    return () => {
      document.documentElement.removeAttribute(PAGE_QUESTION_SELECTION_ATTRIBUTE);
      style.remove();
      document.removeEventListener("click", selectQuestion, true);
      window.removeEventListener("keydown", cancelOnEscape);
    };
  }, [selectingPageQuestion]);

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
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(undefined), 4_200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!confirmingNavigationTarget) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || navigationBusy) return;
      setConfirmingNavigationTarget(undefined);
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [confirmingNavigationTarget, navigationBusy]);

  function dismissNavigationLayer() {
    if (navigationBusy) return;
    setConfirmingNavigationTarget(undefined);
  }

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
    setConfirmingNavigationTarget(undefined);
    setConfirmingNodeDelete(undefined);
  }

  function clearGraphSelection() {
    setGraphSelection(undefined);
  }

  function panelActionContext() {
    const chatId = getConversationId(location.href);
    const viewingNodeId = selectedNodeIdRef.current;
    return {
      ...(chatId ? { chatId } : {}),
      ...(viewingNodeId ? { viewingNodeId } : {}),
    };
  }

  function applyAuthoritativeState(nextState: FloatingPanelState) {
    panelStateRequestRef.current += 1;
    rememberLatestState(nextState);
    selectedNodeIdRef.current = nextState.viewingNodeId;
    setSelectedNodeId(nextState.viewingNodeId);
    setState(nextState);
  }

  async function performPanelMutation<T>(
    message: ExtensionMessage,
    fallbackError: string,
  ): Promise<T | undefined> {
    setError(undefined);
    try {
      const response = await browser.runtime.sendMessage(message) as PanelMutationResponse<T>;
      if (!response.ok) {
        setError(response.error);
        return undefined;
      }
      applyAuthoritativeState(response.state);
      return response.result;
    } catch {
      setError(fallbackError);
      return undefined;
    }
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

  async function selectProject(projectId: string) {
    if (projectId === state.projectId) {
      closeProjectMenu();
      return;
    }
    setSwitchingProjectId(projectId);
    try {
      const result = await performPanelMutation<{ projectId?: string }>({
        type: "SELECT_PANEL_PROJECT",
        projectId,
        context: panelActionContext(),
      }, "暂时无法切换项目，请重试。");
      if (result) {
        clearGraphSelection();
        closeProjectMenu();
      }
    } finally {
      setSwitchingProjectId(undefined);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const title = newProjectTitle.trim();
    if (!title) return;
    setSavingProject(true);
    try {
      const result = await performPanelMutation<{ projectId?: string }>({
        type: "CREATE_PANEL_PROJECT",
        title,
        goal: newProjectGoal.trim(),
        context: panelActionContext(),
      }, "暂时无法创建项目，请重试。");
      if (result) {
        clearGraphSelection();
        closeProjectMenu();
      }
    } finally {
      setSavingProject(false);
    }
  }

  async function deleteProject(projectId: string) {
    setDeletingProjectId(projectId);
    try {
      const result = await performPanelMutation<{ projectId?: string }>({
        type: "DELETE_PANEL_PROJECT",
        projectId,
        context: panelActionContext(),
      }, "暂时无法删除项目，请重试。");
      if (result) {
        clearGraphSelection();
        setConfirmingDeleteProjectId(undefined);
      }
    } finally {
      setDeletingProjectId(undefined);
    }
  }

  function beginProjectRename(projectId: string, title: string) {
    setCreatingProject(false);
    setConfirmingDeleteProjectId(undefined);
    setRenamingProjectId(projectId);
    setRenamedProjectTitle(title);
  }

  async function renameProject(event: FormEvent) {
    event.preventDefault();
    const projectId = renamingProjectId;
    const title = renamedProjectTitle.trim();
    if (!projectId || !title) return;
    setSavingRenamedProject(true);
    try {
      const result = await performPanelMutation<{ projectId?: string }>({
        type: "RENAME_PANEL_PROJECT",
        projectId,
        title,
        context: panelActionContext(),
      }, "暂时无法重命名项目，请重试。");
      if (result) {
        setRenamingProjectId(undefined);
        setRenamedProjectTitle("");
      }
    } finally {
      setSavingRenamedProject(false);
    }
  }

  function closeProjectMenu() {
    setProjectMenuOpen(false);
    setCreatingProject(false);
    setNewProjectTitle("");
    setNewProjectGoal("");
    setRenamingProjectId(undefined);
    setRenamedProjectTitle("");
    setConfirmingDeleteProjectId(undefined);
  }

  function dismissPanel() {
    dragRef.current = undefined;
    setSelectingPageQuestion(false);
    clearGraphSelection();
    setEditingParent(false);
    setConfirmingNavigationTarget(undefined);
    closeProjectMenu();
    setDismissed(true);
  }

  async function openDetail(view?: "graph") {
    closeProjectMenu();
    setError(undefined);
    setNotice(undefined);

    if (import.meta.env.FIREFOX) {
      if (view) {
        try {
          await browser.storage.local.set({ [REQUESTED_SIDE_PANEL_VIEW_KEY]: view });
        } catch {
          setError("暂时无法准备侧边栏视图，请重试。");
          return;
        }
      }
      setNotice(
        `${view ? "完整图已准备。" : "Firefox 限制："}请点击工具栏 Chat Graph 图标，或按 Alt+Shift+G 打开侧边栏。`,
      );
      return;
    }

    try {
      const response = (await browser.runtime.sendMessage({
        type: "OPEN_SIDE_PANEL",
        ...(state.projectId ? { projectId: state.projectId } : {}),
        ...(view ? { view } : {}),
      } satisfies ExtensionMessage)) as PanelActionResponse;
      if (!response.ok) setError(response.error);
    } catch {
      setError("暂时无法打开侧边栏，请重试或点击扩展工具栏图标。");
    }
  }

  async function setGraphNodeStatus(
    nodeId: string,
    status: NodeStatus,
  ): Promise<boolean> {
    return Boolean(await performPanelMutation<{ nodeId: string; status: string }>({
      type: "SET_PANEL_NODE_STATUS",
      nodeId,
      status,
      context: panelActionContext(),
    }, "暂时无法更新节点状态，请重试。"));
  }

  async function deleteGraphNode(nodeId: string, deleteDescendants = false): Promise<boolean> {
    closeProjectMenu();
    const result = await performPanelMutation<PanelDeleteResult>({
      type: "DELETE_PANEL_NODE",
      nodeId,
      ...(deleteDescendants ? { deleteDescendants: true } : {}),
      context: panelActionContext(),
    }, "暂时无法删除这个节点，请重试。");
    return Boolean(result);
  }

  async function navigateQuestionTarget(target: NavigationTarget): Promise<boolean> {
    setError(undefined);
    setNavigationBusy(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: "NAVIGATE_TO_QUESTION",
        source: { kind: target.kind, id: target.id },
      } satisfies ExtensionMessage) as NavigateToNodeResponse;
      if (!response.ok) {
        setError(response.error);
        return false;
      }
      return true;
    } catch {
      setError("暂时无法在当前页面定位原问题，请重试。");
      return false;
    } finally {
      setNavigationBusy(false);
    }
  }

  async function toggleCaptureService() {
    const enabled = !state.captureEnabled;
    setTogglingCapture(true);
    setNotice(undefined);
    try {
      const result = await performPanelMutation<{ captureEnabled: boolean }>({
        type: "SET_CAPTURE_SERVICE_ENABLED",
        enabled,
        context: panelActionContext(),
      }, "暂时无法切换捕获服务，请重试。");
      if (result) {
        setNotice(enabled ? "问题捕获已开启。" : "问题捕获已暂停，仍可从页面选择问题加入项目。");
      }
    } finally {
      setTogglingCapture(false);
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
        context: panelActionContext(),
      } satisfies ExtensionMessage)) as BuildCurrentPageGraphResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      applyAuthoritativeState(response.state);
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
    setNotice("正在忽略当前问题…");
    closeProjectMenu();
    try {
      const result = await performPanelMutation<{ ignoredId: string; kind: "node" | "candidate" }>({
        type: "IGNORE_PANEL_CURRENT",
        ...(state.currentNodeId ? { currentNodeId: state.currentNodeId } : {}),
        ...(state.currentCandidateId ? { currentCandidateId: state.currentCandidateId } : {}),
        context: panelActionContext(),
      }, "暂时无法忽略当前问题，请重试。");
      if (result) {
        setEditingParent(false);
        setNotice("已忽略当前问题。");
      } else {
        setNotice(undefined);
      }
    } finally {
      setIgnoringCurrent(false);
    }
  }

  async function deleteViewedNode() {
    const nodeId = state.viewingNodeId;
    if (!nodeId || !confirmingNodeDelete) return;
    setDeletingNode(true);
    closeProjectMenu();
    try {
      const result = await performPanelMutation<PanelDeleteResult>({
        type: "DELETE_PANEL_NODE",
        nodeId,
        ...(confirmingNodeDelete === "subtree" ? { deleteDescendants: true } : {}),
        context: panelActionContext(),
      }, "暂时无法删除这个节点，请重试。");
      if (result) {
        setEditingParent(false);
        setConfirmingNodeDelete(undefined);
        setNotice(result.deletedNodeCount > 1
          ? `已删除该节点及 ${result.deletedNodeCount - 1} 个子孙节点。`
          : "节点已删除。");
      }
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
  const viewedNodeDescendantCount = state.viewingNodeId
    ? countDescendants(state.graphNodes, state.viewingNodeId)
    : 0;
  const canEditParent = state.parentState !== "processing" && Boolean(
    state.currentNodeId || state.currentCandidateId,
  );

  function beginParentEditing() {
    setError(undefined);
    setProjectMenuOpen(false);
    setEditingParent(true);
  }

  function togglePageQuestionSelection() {
    closeProjectMenu();
    setError(undefined);
    setNotice(undefined);
    setSelectingPageQuestion((selecting) => !selecting);
  }

  async function captureSelectedPageQuestion(message: HTMLElement) {
    setImportingPageQuestion(true);
    setError(undefined);
    setNotice(undefined);
    closeProjectMenu();
    try {
      const captured = getCapturedQuestionFromElement(message);
      if (!captured) {
        setError("无法读取所选问题，请确认当前页面仍停留在该对话。");
        return;
      }

      if (captured.messageAnchor) {
        watchForRefinedMessageLocator(captured, (messageLocator) => {
          void browser.runtime.sendMessage({
            type: "REFINE_MESSAGE_LOCATOR",
            chatId: captured.chatId,
            messageAnchor: captured.messageAnchor!,
            messageLocator,
          } satisfies ExtensionMessage).catch(() => undefined);
        });
      }

      clearGraphSelection();
      const response = (await browser.runtime.sendMessage({
        type: "CAPTURE_QUESTION",
        captured,
        manual: true,
        context: panelActionContext(),
      } satisfies ExtensionMessage)) as CaptureQuestionResponse;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      if (response.destination === "disabled") {
        setError("所选问题未能加入项目，请重试。");
        return;
      }

      setPanelView("current");
      if (response.nodeId) {
        setGraphSelection(response.nodeId);
        await loadFloatingPanelState(response.nodeId);
      } else {
        applyAuthoritativeState(response.state);
      }

      if (response.destination === "duplicate") {
        setNotice("所选问题已经在当前项目中，已切换到对应节点。");
      } else if (response.destination === "inbox") {
        setNotice(captured.assistantContext
          ? "已读取所选问题和回答，请确认它的父节点。"
          : "已读取所选问题；未找到对应回答，请确认它的父节点。");
      } else {
        setNotice(captured.assistantContext
          ? "已加入所选问题；回答仅用于本次摘要和父节点匹配。"
          : "已加入所选问题；未找到对应回答，已仅根据问题分析。");
      }
    } catch {
      setError("暂时无法加入所选问题，请重试。");
    } finally {
      setImportingPageQuestion(false);
    }
  }

  async function saveCurrentParent(parentId: string | null): Promise<boolean> {
    const result = await performPanelMutation<PanelParentResult>({
      type: "SET_PANEL_PARENT",
      parentId,
      ...(state.currentNodeId ? { currentNodeId: state.currentNodeId } : {}),
      ...(state.currentCandidateId ? { currentCandidateId: state.currentCandidateId } : {}),
      context: panelActionContext(),
    }, "暂时无法更新父节点，请重试。");
    if (!result) return false;
    setNotice(parentId ? "父节点已更新。" : "已设为新的根节点。");
    return true;
  }

  function requestNodeNavigation(nodeId: string) {
    const node = state.graphNodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      setError("该节点已经不存在，请刷新后重试。");
      return;
    }
    setConfirmingNavigationTarget({ kind: "node", id: node.id, question: node.question });
  }

  function requestCurrentNavigation() {
    if (state.currentNodeId) {
      setConfirmingNavigationTarget({
        kind: "node",
        id: state.currentNodeId,
        question: state.currentQuestion ?? "当前问题",
      });
      return;
    }
    if (state.currentCandidateId) {
      setConfirmingNavigationTarget({
        kind: "candidate",
        id: state.currentCandidateId,
        question: state.currentQuestion ?? "当前问题",
      });
    }
  }

  const currentActionMenu = (
    <NodeActionMenu label="当前节点操作">
      <button
        type="button"
        role="menuitem"
        disabled={!state.currentQuestion}
        onClick={() => setCurrentSummaryExpanded((expanded) => !expanded)}
      >
        {currentSummaryExpanded ? "收起摘要" : "查看摘要"}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={navigationBusy || (!state.currentNodeId && !state.currentCandidateId)}
        onClick={requestCurrentNavigation}
      >
        {navigationBusy ? "正在定位…" : "定位原文"}
      </button>
      <button type="button" role="menuitem" disabled={!canEditParent} onClick={beginParentEditing}>
        更换父节点
      </button>
      {isViewingGraphNode ? (
        <>
          <button
            className="is-danger"
            type="button"
            role="menuitem"
            disabled={deletingNode}
            onClick={() => setConfirmingNodeDelete("node")}
          >
            删除节点
          </button>
          <button
            className="is-danger"
            type="button"
            role="menuitem"
            disabled={deletingNode || viewedNodeDescendantCount === 0}
            onClick={() => setConfirmingNodeDelete("subtree")}
          >
            删除节点及其子节点
          </button>
        </>
      ) : (
        <button
          className="is-danger"
          type="button"
          role="menuitem"
          disabled={ignoringCurrent || (!state.currentNodeId && !state.currentCandidateId)}
          onClick={() => void ignoreCurrentQuestion()}
        >
          {ignoringCurrent ? "忽略中…" : "忽略此节点"}
        </button>
      )}
    </NodeActionMenu>
  );

  const parentActionMenu = (
    <NodeActionMenu label="父节点操作">
      <button
        type="button"
        role="menuitem"
        disabled={!state.parentSummary}
        onClick={() => setParentSummaryExpanded((expanded) => !expanded)}
      >
        {parentSummaryExpanded ? "收起摘要" : "查看摘要"}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={navigationBusy || !state.parentId}
        onClick={() => state.parentId && requestNodeNavigation(state.parentId)}
      >
        {navigationBusy ? "正在定位…" : "定位原文"}
      </button>
    </NodeActionMenu>
  );

  if (dismissed) return null;

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
          <span className="chat-graph-collapsed__parent" title={state.currentQuestion || parentLabel}>
            {`当前：${state.currentQuestion || parentLabel}`}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <button
          className="chat-graph-collapsed__close"
          type="button"
          title="关闭浮窗（刷新页面后恢复）"
          aria-label="关闭 Chat Graph 浮窗"
          onClick={dismissPanel}
        >
          <X size={14} aria-hidden="true" />
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
                    renamingProjectId === project.id ? (
                      <form
                        key={project.id}
                        className="chat-graph-project-menu__rename"
                        onSubmit={(event) => void renameProject(event)}
                      >
                        <input
                          autoFocus
                          required
                          maxLength={80}
                          aria-label={`重命名项目：${project.title}`}
                          value={renamedProjectTitle}
                          onChange={(event) => setRenamedProjectTitle(event.target.value)}
                        />
                        <button
                          type="button"
                          disabled={savingRenamedProject}
                          onClick={() => {
                            setRenamingProjectId(undefined);
                            setRenamedProjectTitle("");
                          }}
                        >
                          取消
                        </button>
                        <button
                          className="is-primary"
                          type="submit"
                          disabled={savingRenamedProject || !renamedProjectTitle.trim()}
                        >
                          {savingRenamedProject ? "保存中…" : "保存"}
                        </button>
                      </form>
                    ) : confirmingDeleteProjectId === project.id ? (
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
                          disabled={Boolean(switchingProjectId) || Boolean(deletingProjectId) || Boolean(renamingProjectId)}
                          onClick={() => void selectProject(project.id)}
                        >
                          <span title={project.title}>
                            {switchingProjectId === project.id ? `${project.title}（切换中…）` : project.title}
                          </span>
                          {project.id === state.projectId ? <Check size={14} aria-hidden="true" /> : null}
                        </button>
                        <button
                          className="chat-graph-project-menu__rename-trigger"
                          type="button"
                          title={`重命名项目：${project.title}`}
                          aria-label={`重命名项目：${project.title}`}
                          disabled={Boolean(switchingProjectId) || Boolean(deletingProjectId) || Boolean(renamingProjectId)}
                          onClick={() => beginProjectRename(project.id, project.title)}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                        <button
                          className="chat-graph-project-menu__delete"
                          type="button"
                          title={`删除项目：${project.title}`}
                          aria-label={`删除项目：${project.title}`}
                          disabled={Boolean(switchingProjectId) || Boolean(deletingProjectId) || Boolean(renamingProjectId)}
                          onClick={() => {
                            setRenamingProjectId(undefined);
                            setRenamedProjectTitle("");
                            setConfirmingDeleteProjectId(project.id);
                          }}
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
                      setRenamingProjectId(undefined);
                      setRenamedProjectTitle("");
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
            title={togglingCapture
              ? "正在更新捕获状态"
              : state.captureEnabled ? "暂停问题捕获" : "开启问题捕获"}
            aria-label={togglingCapture
              ? "正在更新 Chat Graph 问题捕获状态"
              : state.captureEnabled ? "暂停 Chat Graph 问题捕获" : "开启 Chat Graph 问题捕获"}
            aria-pressed={state.captureEnabled}
            disabled={togglingCapture}
            onClick={() => void toggleCaptureService()}
          >
            {togglingCapture
              ? <RefreshCw className="is-spinning" size={15} aria-hidden="true" />
              : state.captureEnabled
                ? <Pause size={15} aria-hidden="true" />
                : <Play size={15} aria-hidden="true" />}
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
            title={import.meta.env.FIREFOX
              ? "打开方法：点击工具栏图标或按 Alt+Shift+G"
              : "打开 Chat Graph 侧边栏"}
            aria-label={import.meta.env.FIREFOX
              ? "显示 Firefox 侧边栏打开方法"
              : "打开 Chat Graph 侧边栏"}
            onClick={() => void openDetail()}
          >
            <PanelRightOpen size={15} aria-hidden="true" />
          </button>
          <button
            className={`chat-graph-page-picker${selectingPageQuestion ? " is-active" : ""}`}
            type="button"
            title={selectingPageQuestion ? "取消选择页面问题" : "从页面选择任意问题加入当前项目"}
            aria-label={selectingPageQuestion ? "取消选择页面问题" : "选择页面问题加入 Chat Graph"}
            aria-pressed={selectingPageQuestion}
            disabled={importingPageQuestion || buildingGraph}
            onClick={togglePageQuestionSelection}
          >
            <MousePointer2 size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="关闭浮窗（刷新页面后恢复）"
            aria-label="关闭 Chat Graph 浮窗"
            onClick={dismissPanel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={`chat-graph-panel__body chat-graph-panel__body--${panelView}`}>
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
              setSelectingPageQuestion(false);
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
            disabled={buildingGraph || importingPageQuestion || selectingPageQuestion}
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

        {selectingPageQuestion ? (
          <div className="chat-graph-page-selection" role="status">
            <MousePointer2 size={14} aria-hidden="true" />
            <span>滚动页面并点击任意用户问题</span>
            <button type="button" onClick={() => setSelectingPageQuestion(false)}>取消</button>
          </div>
        ) : null}

        {!state.captureEnabled ? (
          <div
            className="chat-graph-capture-paused"
            role="status"
            title="你发送的新内容不会自动加入项目；仍可从页面选择任意问题。"
          >
            <TriangleAlert size={13} aria-hidden="true" />
            <strong>捕获已暂停</strong>
            <button
              type="button"
              disabled={importingPageQuestion || buildingGraph}
              onClick={togglePageQuestionSelection}
            >
              选择问题
            </button>
          </div>
        ) : null}

        {notice ? (
          <div className="chat-graph-notice" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="关闭提示" onClick={() => setNotice(undefined)}>
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
            onRequestLocateNode={requestNodeNavigation}
            onOpenFullGraph={() => void openDetail("graph")}
          />
        ) : state.parentState === "selecting" ? (
          <>
            <section
              key={state.latestQuestionKey ?? state.currentNodeId ?? state.currentCandidateId ?? "current"}
              className="chat-graph-section chat-graph-section--current chat-graph-section--selection-current chat-graph-section--updated"
            >
              <div className="chat-graph-section__heading">
                <div className="chat-graph-label chat-graph-label--current">CURRENT</div>
                {currentActionMenu}
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
              onSave={saveCurrentParent}
            />
          </>
        ) : (
          <>
            <section
              key={state.latestQuestionKey ?? state.currentNodeId ?? state.currentCandidateId ?? "current"}
              className="chat-graph-section chat-graph-section--current chat-graph-section--updated"
            >
              <div className="chat-graph-section__heading">
                <div className="chat-graph-label chat-graph-label--current">
                  CURRENT
                  {isViewingGraphNode ? <small>图中选中</small> : null}
                </div>
                {currentActionMenu}
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
                    {confirmingNodeDelete === "subtree"
                      ? `将删除这个节点及其全部 ${viewedNodeDescendantCount} 个子孙节点，此操作不可撤销。`
                      : viewedNodeChildCount
                        ? `删除后，${viewedNodeChildCount} 个直接子节点会移动到当前父级。`
                        : "这个节点会从本地问题图中删除。"}
                  </p>
                  <div>
                    <button
                      type="button"
                      disabled={deletingNode}
                      onClick={() => setConfirmingNodeDelete(undefined)}
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

            <div className="chat-graph-connector chat-graph-connector--reverse" aria-hidden="true">
              <span />
              <ArrowUp size={14} />
            </div>

            <section className="chat-graph-section chat-graph-section--parent">
              <div className="chat-graph-section__heading">
                <div className="chat-graph-label">PARENT</div>
                {parentActionMenu}
              </div>
              <button
                className={`chat-graph-copy chat-graph-copy--parent${state.parentId && state.focusedNodeId === state.parentId ? " is-focused" : ""}`}
                type="button"
                title={state.parentSummary ? `查看父节点摘要：${parentLabel}` : parentLabel}
                disabled={!state.parentId || !state.currentNodeId}
                onClick={() => setParentSummaryExpanded((expanded) => !expanded)}
              >
                {state.parentState === "processing" ? (
                  <span className="chat-graph-loading-dot" aria-hidden="true" />
                ) : null}
                <span className="chat-graph-copy__text">{parentLabel}</span>
                {state.parentId && state.focusedNodeId === state.parentId ? <small>已聚焦</small> : null}
              </button>
              {parentSummaryExpanded && state.parentSummary ? (
                <div id="chat-graph-parent-summary" className="chat-graph-inline-summary">
                  <div className="chat-graph-label">PARENT SUMMARY</div>
                  <p title={state.parentSummary}>{state.parentSummary}</p>
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
            onSave={saveCurrentParent}
          />
        </div>
      ) : null}
      {confirmingNavigationTarget ? (
        <div
          className="chat-graph-navigation-layer"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) dismissNavigationLayer();
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="chat-graph-locate-title">
            <h3 id="chat-graph-locate-title">定位到原问题？</h3>
            <p title={confirmingNavigationTarget.question}>{confirmingNavigationTarget.question}</p>
            <small>插件会在当前 ChatGPT 页面查找并高亮这条问题。</small>
            <div>
              <button type="button" disabled={navigationBusy} onClick={() => setConfirmingNavigationTarget(undefined)}>取消</button>
              <button
                className="is-primary"
                type="button"
                disabled={navigationBusy}
                onClick={() => {
                  const target = confirmingNavigationTarget;
                  setConfirmingNavigationTarget(undefined);
                  void navigateQuestionTarget(target);
                }}
              >
                {navigationBusy ? "正在定位…" : "定位到原问题"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function NodeActionMenu({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (menuRef.current && event.composedPath().includes(menuRef.current)) return;
      setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="chat-graph-node-actions">
      <button
        className="chat-graph-node-actions__trigger"
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="chat-graph-node-actions__menu"
          role="menu"
          aria-label={label}
          onClick={(event) => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest<HTMLButtonElement>("button");
            if (button && !button.disabled) setOpen(false);
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ParentEditor({
  state,
  compact = false,
  onCancel,
  onComplete,
  onSave,
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
    try {
      if (await onSave(selectedId || null)) onComplete();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`chat-graph-parent-editor${compact ? " is-compact" : ""}`}>
      <div className="chat-graph-parent-editor__title">
        <div>
          <div className="chat-graph-label">{compact ? "选择父节点" : "更换父节点"}</div>
          {!compact ? <p>为当前问题选择新的直接父问题</p> : null}
        </div>
        {onCancel ? (
          <button type="button" title="取消" aria-label="取消修改父节点" onClick={onCancel}>
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
            placeholder="搜索问题节点…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}

      <div className="chat-graph-parent-options" role="radiogroup" aria-label="父节点候选">
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
          <span>无父节点 / 新根节点</span>
          {compact && state.rootConfidence !== undefined ? (
            <small>{Math.round(state.rootConfidence * 100)}%</small>
          ) : null}
        </label>
      </div>

      {!filteredOptions.length && query ? (
        <p className="chat-graph-parent-editor__empty">没有匹配的节点</p>
      ) : null}

      <div className="chat-graph-parent-editor__actions">
        {onCancel ? <button type="button" onClick={onCancel}>取消</button> : null}
        <button className="is-primary" type="button" disabled={saving} onClick={() => void confirm()}>
          <Check size={14} /> {saving ? "保存中…" : "确认"}
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
  if (state.parentState === "root") return "根节点";
  return "—";
}

function countDescendants(nodes: FloatingPanelGraphNode[], rootId: string): number {
  const descendants = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  return descendants.size - 1;
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
