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
  DEFAULT_AI_SETTINGS,
  getAISettings,
  saveAISettings,
} from "../../settings/storage";
import type {
  ConversationOpenMode,
  ExtensionMessage,
  NavigateToNodeResponse,
} from "../../shared/messages";
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
    nodes.find((node) => node.status === "active") ??
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
    void browser.storage.local
      .get(SELECTED_PROJECT_KEY)
      .then((stored) => {
        const storedId = stored[SELECTED_PROJECT_KEY];
        if (typeof storedId === "string") setSelectedProjectId(storedId);
      })
      .finally(() => setSelectionReady(true));
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

  function requestNodeDelete(node: QuestionNode): void {
    const childCount = nodes.filter((candidate) => candidate.parentId === node.id).length;
    setDetailNodeId(undefined);
    setConfirm({
      title: "删除这个 Question Node？",
      body: childCount
        ? `“${node.question}”有 ${childCount} 个直接子节点；删除后它们会移动到当前父级。`
        : `“${node.question}”会从本地问题图删除。`,
      onConfirm: async () => {
        if (await execute(() => service.deleteNode(node.id))) setConfirm(null);
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
      footer={<span>v0.8.0 · ChatGPT stores content; Chat Graph stores structure.</span>}
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
              <Inbox size={14} /> Inbox {candidates.length ? `(${candidates.length})` : ""}
            </button>
            <button className={view === "graph" ? "is-active" : ""} type="button" onClick={() => setView("graph")}>
              <Map size={14} /> Graph
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
                    <div className="section-label">CURRENT PATH</div>
                    <Breadcrumb path={path} onSelect={(node) => void execute(() => service.focusNode(node.id))} />
                  </section>

                  <section className="focus-node-card">
                    <div className="focus-node-card__topline">
                      <StatusPill status={focusNode.status} />
                      <button className="text-button" type="button" onClick={() => setDetailNodeId(focusNode.id)}>Change</button>
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
                        <option value="active">讨论中</option>
                        <option value="pending">待继续</option>
                        <option value="resolved">已解决</option>
                        <option value="parked">暂时搁置</option>
                        <option value="rejected">不再继续</option>
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
                      <ArrowLeft size={14} /> Parent
                    </button>
                    <button
                      className="button"
                      type="button"
                      disabled={path.length < 2}
                      onClick={() => path[0] && void execute(() => service.focusNode(path[0]!.id))}
                    >
                      <CornerUpLeft size={14} /> Main Thread
                    </button>
                    <button className="button button--primary" type="button" onClick={() => setView("graph")}>
                      <Map size={14} /> Open Graph
                    </button>
                  </div>

                  <section className="workspace-panel">
                    <div className="section-heading">
                      <div><div className="section-label">OPEN BRANCHES</div><h2>尚未继续</h2></div>
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
                    ) : <p className="muted-empty">当前路径附近没有 pending / parked 分支。</p>}
                  </section>

                  {latestAutoLink && linkedNode?.parentId === latestAutoLink.afterParentId && linkedParent ? (
                    <section className="linked-toast">
                      <span>Linked “{linkedNode.question}” to “{linkedParent.question}”</span>
                      <button className="text-button" type="button" onClick={() => void execute(() => service.undoLatestAutoLink(selectedProject.id))}>
                        <Undo2 size={13} /> Undo
                      </button>
                      <button className="text-button" type="button" onClick={() => setDetailNodeId(linkedNode.id)}>Change Parent</button>
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
              <Suspense fallback={<div className="graph-loading">正在加载 Graph…</div>}>
                <GraphView
                  questions={nodes}
                  {...(focusNode ? { focusId: focusNode.id } : {})}
                  onMakeCurrent={(node) => void execute(() => service.focusNode(node.id))}
                  onViewDetails={(node) => setDetailNodeId(node.id)}
                  onRequestLocate={setConfirmingNavigationNode}
                  onRequestDelete={requestNodeDelete}
                  onSetStatus={(node, status) => execute(() => service.setStatus(node.id, status))}
                />
              </Suspense>
            ) : <p className="muted-empty">发送第一个问题后，这里会显示 Question Forest。</p>
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
          onSave={async (nextAI) => {
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
