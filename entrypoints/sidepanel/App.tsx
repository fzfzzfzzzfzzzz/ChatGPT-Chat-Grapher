import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  CornerUpLeft,
  Crosshair,
  GitBranch,
  Inbox,
  Map,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { browser } from "wxt/browser";
import { Breadcrumb } from "../../components/Breadcrumb";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { InboxPanel } from "../../components/InboxPanel";
import { OpenConversationDialog } from "../../components/OpenConversationDialog";
import { ProjectDialog } from "../../components/ProjectDialog";
import { ProjectHeader } from "../../components/ProjectHeader";
import { ProjectSearchPanel } from "../../components/ProjectSearchPanel";
import { QuestionDetailDialog } from "../../components/QuestionDetailDialog";
import { SettingsModal } from "../../components/SettingsModal";
import { SidePanelLayout } from "../../components/SidePanelLayout";
import { StatusPill } from "../../components/StatusPill";
import { db } from "../../db/database";
import { DiscussionService } from "../../graph/discussionService";
import { getCurrentPath, getOpenBranches } from "../../graph/questionTree";
import {
  hasActiveProviderPermission,
  requestActiveProviderPermission,
} from "../../platform/providerPermissions";
import {
  DEFAULT_AI_SETTINGS,
  getAISettings,
  saveAISettings,
} from "../../settings/storage";
import type {
  ConversationOpenMode,
  ExtensionMessage,
  NavigateToNodeResponse,
  TestAIProviderResponse,
} from "../../shared/messages";
import {
  getAIProviderProfile,
  normalizeProviderBaseUrl,
  validateAndNormalizeProviderProfile,
} from "../../ai/providers";
import type {
  AISettings,
  NodeStatus,
  Project,
  QuestionCandidate,
  QuestionNode,
} from "../../types/domain";

const service = new DiscussionService(db);
const GraphView = lazy(() =>
  import("../../components/GraphView").then((module) => ({ default: module.GraphView })),
);
const SELECTED_PROJECT_KEY = "selectedProjectId";
const REQUESTED_SIDE_PANEL_VIEW_KEY = "requestedSidePanelView";

async function testConfiguredProvider(settings: AISettings): Promise<TestAIProviderResponse> {
  const profile = getAIProviderProfile(settings.profiles, settings.activeProvider);
  validateAndNormalizeProviderProfile(settings.activeProvider, profile);
  const granted = await requestActiveProviderPermission(settings);
  if (!granted) return { ok: false, error: "未授予当前 AI 厂商的域名访问权限。" };
  return browser.runtime.sendMessage({
    type: "TEST_AI_PROVIDER",
    providerId: settings.activeProvider,
    profile,
    timeoutMs: settings.timeoutMs,
  } satisfies ExtensionMessage) as Promise<TestAIProviderResponse>;
}

type View = "focus" | "inbox" | "graph" | "search";
type ConfirmState = { title: string; body: string; onConfirm: () => Promise<void> };

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

export default function App() {
  const [view, setView] = useState<View>("focus");
  const [selectionReady, setSelectionReady] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [projectDialog, setProjectDialog] = useState<{ project?: Project } | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string>();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [error, setError] = useState<string>();
  const [confirmingNavigationNode, setConfirmingNavigationNode] = useState<QuestionNode>();
  const [pendingNavigationNode, setPendingNavigationNode] = useState<QuestionNode>();
  const [navigationBusy, setNavigationBusy] = useState(false);
  const selectionWriteQueue = useRef<Promise<void>>(Promise.resolve());

  const projectResults = useLiveQuery(() => service.projects.list(), []);
  const projects = projectResults ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const nodes = useLiveQuery(
    () => selectedProjectId ? service.nodes.listForProject(selectedProjectId) : Promise.resolve([]),
    [selectedProjectId],
    [],
  );
  const candidates = useLiveQuery(
    () => selectedProjectId ? service.candidates.listForProject(selectedProjectId) : Promise.resolve([]),
    [selectedProjectId],
    [],
  );
  const latestAutoLink = useLiveQuery(
    () => selectedProjectId
      ? service.events.latestUndoableAutoLink(selectedProjectId)
      : Promise.resolve(undefined),
    [selectedProjectId],
  );
  const focusNode =
    nodes.find((node) => node.id === selectedProject?.focusNodeId) ??
    nodes.at(-1);
  const path = useMemo(
    () => focusNode ? getCurrentPath(nodes, focusNode.id) : [],
    [focusNode, nodes],
  );
  const openBranches = useMemo(
    () => focusNode ? getOpenBranches(nodes, focusNode.id) : [],
    [focusNode, nodes],
  );
  const detailNode = nodes.find((node) => node.id === detailNodeId);
  const linkedNode = nodes.find((node) => node.id === latestAutoLink?.nodeId);
  const linkedParent = nodes.find((node) => node.id === latestAutoLink?.afterParentId);

  useEffect(() => {
    void getAISettings().then(setAISettings);
    let disposed = false;
    let selectionChangedWhileLoading = false;

    const handleStorageChanged = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;

      const projectChange = changes[SELECTED_PROJECT_KEY];
      if (projectChange) {
        selectionChangedWhileLoading = true;
        const nextProjectId = typeof projectChange.newValue === "string"
          ? projectChange.newValue
          : undefined;
        setSelectedProjectId(nextProjectId);
        setDetailNodeId(undefined);
        setConfirmingNavigationNode(undefined);
        setPendingNavigationNode(undefined);
        setView("focus");
      }

      if (changes[REQUESTED_SIDE_PANEL_VIEW_KEY]?.newValue === "graph") {
        setView("graph");
        void browser.storage.local.remove(REQUESTED_SIDE_PANEL_VIEW_KEY);
      }
    };

    browser.storage.onChanged.addListener(handleStorageChanged);
    void browser.storage.local
      .get([SELECTED_PROJECT_KEY, REQUESTED_SIDE_PANEL_VIEW_KEY])
      .then((stored) => {
        if (disposed) return;
        const storedId = stored[SELECTED_PROJECT_KEY];
        if (!selectionChangedWhileLoading && typeof storedId === "string") {
          setSelectedProjectId(storedId);
        }
        if (stored[REQUESTED_SIDE_PANEL_VIEW_KEY] === "graph") setView("graph");
        if (stored[REQUESTED_SIDE_PANEL_VIEW_KEY] !== undefined) {
          void browser.storage.local.remove(REQUESTED_SIDE_PANEL_VIEW_KEY);
        }
      })
      .finally(() => {
        if (!disposed) setSelectionReady(true);
      });

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(handleStorageChanged);
    };
  }, []);

  useEffect(() => {
    if (!selectionReady || projectResults === undefined) return;
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) return;
    const nextId = projects[0]?.id;
    setSelectedProjectId(nextId);
    void persistSelectedProject(nextId);
  }, [projectResults, projects, selectedProjectId, selectionReady]);

  function persistSelectedProject(projectId?: string): Promise<void> {
    const write = () => projectId
      ? browser.storage.local.set({ [SELECTED_PROJECT_KEY]: projectId })
      : browser.storage.local.remove(SELECTED_PROJECT_KEY);
    const pending = selectionWriteQueue.current.then(write, write);
    selectionWriteQueue.current = pending.catch(() => undefined);
    return pending;
  }

  async function announceChange(): Promise<void> {
    await browser.runtime
      .sendMessage({ type: "DISCUSSION_MAP_CHANGED" } satisfies ExtensionMessage)
      .catch(() => undefined);
  }

  async function execute(action: () => Promise<unknown>): Promise<boolean> {
    setError(undefined);
    try {
      await action();
      await announceChange();
      return true;
    } catch (actionError) {
      setError(messageFromError(actionError));
      return false;
    }
  }

  async function selectProject(projectId: string): Promise<void> {
    setSelectedProjectId(projectId);
    setDetailNodeId(undefined);
    setConfirmingNavigationNode(undefined);
    setView("focus");
    await persistSelectedProject(projectId);
    await announceChange();
  }

  async function locateNode(
    node: QuestionNode,
    openMode?: ConversationOpenMode,
  ): Promise<void> {
    setError(undefined);
    setNavigationBusy(true);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const response = await browser.runtime.sendMessage({
        type: "NAVIGATE_TO_NODE",
        nodeId: node.id,
        ...(openMode ? { openMode } : {}),
        ...(tab?.id !== undefined ? { sourceTabId: tab.id } : {}),
      } satisfies ExtensionMessage) as NavigateToNodeResponse;
      if (!response.ok) {
        if (response.status === "open_choice_required") {
          setPendingNavigationNode(node);
        } else {
          setPendingNavigationNode(undefined);
          setError(response.error);
        }
      } else {
        setPendingNavigationNode(undefined);
      }
    } catch (actionError) {
      setError(messageFromError(actionError));
    } finally {
      setNavigationBusy(false);
    }
  }

  function requestProjectDelete(project: Project): void {
    setConfirm({
      title: "删除整个项目？",
      body: `“${project.title}”下的问题图与 Inbox 会从本机删除。此操作不可撤销。`,
      onConfirm: async () => {
        if (await execute(() => service.deleteProject(project.id))) {
          setConfirm(null);
          setSelectedProjectId(undefined);
          await persistSelectedProject(undefined);
        }
      },
    });
  }

  function requestNodeDelete(node: QuestionNode, deleteDescendants = false): void {
    const childCount = nodes.filter((candidate) => candidate.parentId === node.id).length;
    const descendantCount = countDescendants(nodes, node.id);
    setDetailNodeId(undefined);
    setConfirm({
      title: deleteDescendants ? "删除节点及其全部子节点？" : "删除这个问题节点？",
      body: deleteDescendants
        ? `“${node.question}”及其 ${descendantCount} 个子孙节点会从本地问题图删除，此操作不可撤销。`
        : childCount
          ? `“${node.question}”有 ${childCount} 个直接子节点；删除后它们会移动到当前父级。`
          : `“${node.question}”会从本地问题图删除。`,
      onConfirm: async () => {
        const succeeded = deleteDescendants
          ? await execute(() => service.deleteNodeWithDescendants(node.id))
          : await execute(() => service.deleteNode(node.id));
        if (succeeded) setConfirm(null);
      },
    });
  }

  const header = (
    <ProjectHeader
      projects={projects}
      {...(selectedProject ? { selectedProject } : {})}
      onSelect={(id) => void selectProject(id)}
      onCreate={() => setProjectDialog({})}
      onEdit={() => selectedProject && setProjectDialog({ project: selectedProject })}
      onDelete={() => selectedProject && requestProjectDelete(selectedProject)}
      onSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <SidePanelLayout
      header={header}
      footer={<span>v0.9.0 · ChatGPT stores content; Chat Graph stores structure.</span>}
    >
      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="关闭错误提示" onClick={() => setError(undefined)}><X size={14} /></button>
        </div>
      ) : null}

      {!selectedProject ? (
        <EmptyState
          title="建立第一张问题图"
          description="创建项目，或直接在 ChatGPT 发出新问题；插件会自动捕获并建立项目。"
          actionLabel="创建项目"
          onAction={() => setProjectDialog({})}
        />
      ) : (
        <>
          <div className="project-goal-compact"><span>目标</span>{selectedProject.goal}</div>
          <div className="view-tabs" role="tablist" aria-label="Chat Graph 视图">
            <button className={view === "focus" ? "is-active" : ""} type="button" onClick={() => setView("focus")}>
              <GitBranch size={14} /> 当前路径
            </button>
            <button className={view === "inbox" ? "is-active" : ""} type="button" onClick={() => setView("inbox")}>
              <Inbox size={14} /> 待整理 {candidates.length ? `(${candidates.length})` : ""}
            </button>
            <button className={view === "graph" ? "is-active" : ""} type="button" onClick={() => setView("graph")}>
              <Map size={14} /> 图谱
            </button>
            <button className={view === "search" ? "is-active" : ""} type="button" onClick={() => setView("search")}>
              <Search size={14} /> 搜索
            </button>
          </div>

          {view === "focus" ? (
            <div className="focus-view">
              {focusNode ? (
                <>
                  <section className="workspace-panel">
                    <div className="section-label">当前路径</div>
                    <Breadcrumb path={path} onSelect={(node) => void execute(() => service.focusNode(node.id))} />
                  </section>

                  <section className="focus-node-card">
                    <div className="focus-node-card__topline">
                      <StatusPill status={focusNode.status} />
                      <button className="text-button" type="button" onClick={() => setDetailNodeId(focusNode.id)}>编辑节点</button>
                    </div>
                    <h2>{focusNode.question}</h2>
                    <p>{focusNode.summary}</p>
                    <div className="focus-node-card__actions">
                      <button className="button" type="button" onClick={() => void locateNode(focusNode)}>
                        <Crosshair size={14} /> 原始消息
                      </button>
                      <select
                        aria-label="修改问题状态"
                        value={focusNode.status}
                        onChange={(event) => void execute(() => service.setStatus(focusNode.id, event.target.value as NodeStatus))}
                      >
                        <option value="pending">待讨论</option>
                        <option value="resolved">已完结</option>
                      </select>
                    </div>
                  </section>

                  <div className="quick-nav">
                    <button
                      className="button"
                      type="button"
                      disabled={!focusNode.parentId}
                      onClick={() => focusNode.parentId && void execute(() => service.focusNode(focusNode.parentId!))}
                    >
                      <ArrowLeft size={14} /> 查看父节点
                    </button>
                    <button
                      className="button"
                      type="button"
                      disabled={path.length < 2}
                      onClick={() => path[0] && void execute(() => service.focusNode(path[0]!.id))}
                    >
                      <CornerUpLeft size={14} /> 返回主线
                    </button>
                    <button className="button button--primary" type="button" onClick={() => setView("graph")}>
                      <Map size={14} /> 在图中定位
                    </button>
                  </div>

                  <section className="workspace-panel">
                    <div className="section-heading">
                      <div><div className="section-label">待讨论分支</div><h2>仍待讨论</h2></div>
                      <span>{openBranches.length}</span>
                    </div>
                    {openBranches.length ? (
                      <div className="open-branches">
                        {openBranches.map((node) => (
                          <button key={node.id} type="button" onClick={() => void execute(() => service.focusNode(node.id))}>
                            <span className={`branch-dot branch-dot--${node.status}`} />
                            <span>{node.question}</span>
                            <StatusPill status={node.status} />
                          </button>
                        ))}
                      </div>
                    ) : <p className="muted-empty">当前路径附近没有待讨论的分支。</p>}
                  </section>

                  {latestAutoLink && linkedNode?.parentId === latestAutoLink.afterParentId && linkedParent ? (
                    <section className="linked-toast">
                      <span>已将“{linkedNode.question}”连接到“{linkedParent.question}”</span>
                      <button className="text-button" type="button" onClick={() => void execute(() => service.undoLatestAutoLink(selectedProject.id))}>
                        <Undo2 size={13} /> 撤销
                      </button>
                      <button className="text-button" type="button" onClick={() => setDetailNodeId(linkedNode.id)}>更换父节点</button>
                    </section>
                  ) : null}
                </>
              ) : (
                <section className="empty-state empty-state--compact">
                  <h2>等待第一个问题</h2>
                  <p>在 ChatGPT 输入框发送问题后，它会被自动捕获；AI 未配置时会安全进入 Inbox。</p>
                </section>
              )}
            </div>
          ) : null}

          {view === "inbox" ? (
            <InboxPanel
              candidates={candidates}
              nodes={nodes}
              mediumConfidence={aiSettings.mediumConfidence}
              onPromote={async (candidate: QuestionCandidate, parentId) => {
                if (await execute(() => service.promoteCandidate(candidate.id, parentId, "user"))) setView("focus");
              }}
              onDelete={async (candidate: QuestionCandidate) => {
                await execute(() => service.candidates.delete(candidate.id));
              }}
            />
          ) : null}

          {view === "graph" ? (
            nodes.length ? (
              <Suspense fallback={<div className="graph-loading">正在加载图谱…</div>}>
                <GraphView
                  questions={nodes}
                  {...(focusNode ? { focusId: focusNode.id } : {})}
                  onMakeCurrent={(node) => void execute(() => service.focusNode(node.id))}
                  onViewDetails={(node) => setDetailNodeId(node.id)}
                  onRequestLocate={setConfirmingNavigationNode}
                  onRequestDelete={(node, deleteDescendants) => requestNodeDelete(node, deleteDescendants)}
                  onSetStatus={(node, status) => execute(() => service.setStatus(node.id, status))}
                />
              </Suspense>
            ) : <p className="muted-empty">发送第一个问题后，这里会显示问题图。</p>
          ) : null}

          {view === "search" ? (
            <ProjectSearchPanel nodes={nodes} onLocate={(node) => void locateNode(node)} />
          ) : null}
        </>
      )}

      {projectDialog ? (
        <ProjectDialog
          {...(projectDialog.project ? { project: projectDialog.project } : {})}
          onClose={() => setProjectDialog(null)}
          onSubmit={async (input) => {
            const succeeded = await execute(async () => {
              if (projectDialog.project) await service.updateProject(projectDialog.project.id, input);
              else {
                const project = await service.createProject(input.title, input.goal);
                setSelectedProjectId(project.id);
                await persistSelectedProject(project.id);
              }
            });
            if (succeeded) setProjectDialog(null);
          }}
        />
      ) : null}

      {detailNode ? (
        <QuestionDetailDialog
          node={detailNode}
          nodes={nodes}
          onClose={() => setDetailNodeId(undefined)}
          onSave={(input) => execute(() => service.updateNode(detailNode.id, input))}
          onFocus={() => execute(() => service.focusNode(detailNode.id)).then(() => undefined)}
          onLocate={() => locateNode(detailNode)}
          onDelete={() => requestNodeDelete(detailNode)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          ai={aiSettings}
          onClose={() => setSettingsOpen(false)}
          onCheckPermission={hasActiveProviderPermission}
          onTest={testConfiguredProvider}
          onSave={async (nextAI) => {
            const profile = getAIProviderProfile(nextAI.profiles, nextAI.activeProvider);
            if (profile.baseUrl.trim()) {
              normalizeProviderBaseUrl(nextAI.activeProvider, profile.baseUrl);
            }
            if (nextAI.enabled) {
              validateAndNormalizeProviderProfile(nextAI.activeProvider, profile);
            }
            if (nextAI.enabled && !(await requestActiveProviderPermission(nextAI))) {
              throw new Error("未授予当前 AI 厂商的域名访问权限，设置尚未保存。");
            }
            await saveAISettings(nextAI);
            setAISettings(nextAI);
            setSettingsOpen(false);
          }}
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog title={confirm.title} body={confirm.body} onClose={() => setConfirm(null)} onConfirm={confirm.onConfirm} />
      ) : null}

      {confirmingNavigationNode ? (
        <ConfirmDialog
          title="定位到原问题？"
          body={`将打开“${confirmingNavigationNode.question}”所在会话，并定位、高亮这条问题。`}
          confirmLabel="定位到原问题"
          intent="primary"
          onClose={() => setConfirmingNavigationNode(undefined)}
          onConfirm={async () => {
            const node = confirmingNavigationNode;
            setConfirmingNavigationNode(undefined);
            await locateNode(node);
          }}
        />
      ) : null}

      {pendingNavigationNode ? (
        <OpenConversationDialog
          question={pendingNavigationNode.question}
          busy={navigationBusy}
          onClose={() => setPendingNavigationNode(undefined)}
          onChoose={(mode) => void locateNode(pendingNavigationNode, mode)}
        />
      ) : null}
    </SidePanelLayout>
  );
}

function countDescendants(nodes: QuestionNode[], rootId: string): number {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids.size - 1;
}
