import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import { getGraphNodeActivation } from "../graph/graphNodeActivation";
import {
  projectGraphToFlow,
  type GraphFlowNodeData,
  type QuestionNodeData,
  type ReviewArtifactNodeData,
} from "../graph/layout";
import {
  reviewArtifactFlowNodeId,
  type ReviewGraphArtifact,
} from "../graph/reviewArtifacts";
import type { GraphDisplayMode } from "../shared/graphDisplayMode";
import { NODE_STATUS_LABELS, NODE_STATUS_OPTIONS } from "../shared/nodeStatus";
import type { NodeStatus, QuestionNode } from "../types/domain";
import { QuestionReferenceBadges } from "./QuestionReferenceList";

type Props = {
  questions: QuestionNode[];
  focusId?: string;
  displayMode: GraphDisplayMode;
  onDisplayModeChange: (mode: GraphDisplayMode) => void;
  onMakeCurrent: (node: QuestionNode) => void;
  onViewDetails: (node: QuestionNode) => void;
  onChangeParent: (node: QuestionNode) => void;
  onRequestLocate: (node: QuestionNode) => void;
  onRequestDelete: (node: QuestionNode, deleteDescendants?: boolean) => void;
  onSetStatus: (node: QuestionNode, status: NodeStatus) => Promise<boolean>;
  onSummarizeNode?: (node: QuestionNode) => void;
  reviews?: readonly ReviewGraphArtifact[];
  onOpenReview?: (review: ReviewGraphArtifact) => void;
  onDeleteReview?: (review: ReviewGraphArtifact) => void;
};

const NODE_COLORS: Record<QuestionNode["status"], string> = {
  pending: "#94a3b8",
  resolved: "#22c55e",
};

const QUESTION_NODE_TYPES = {
  questionReference: QuestionReferenceNode,
  reviewArtifact: ReviewArtifactNode,
};

export function GraphView({
  questions,
  focusId,
  displayMode,
  onDisplayModeChange,
  onMakeCurrent,
  onViewDetails,
  onChangeParent,
  onRequestLocate,
  onRequestDelete,
  onSetStatus,
  onSummarizeNode,
  reviews = [],
  onOpenReview,
  onDeleteReview,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [updatingNodeId, setUpdatingNodeId] = useState<string>();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [tooltip, setTooltip] = useState<{
    label: string;
    x: number;
    y: number;
    below: boolean;
  }>();
  const [contextMenu, setContextMenu] = useState<{
    node: QuestionNode;
    x: number;
    y: number;
  }>();
  const [reviewContextMenu, setReviewContextMenu] = useState<{
    review: ReviewGraphArtifact;
    x: number;
    y: number;
  }>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const locateConfirmationTimerRef = useRef<number | undefined>(undefined);
  const visibleQuestions = useMemo(() => {
    const byId = new Map(questions.map((node) => [node.id, node]));
    return questions.filter((node) => {
      const visited = new Set<string>();
      let parentId = node.parentId;
      while (parentId) {
        if (visited.has(parentId)) return false;
        visited.add(parentId);
        if (collapsed.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return true;
    });
  }, [collapsed, questions]);
  const visibleReviews = useMemo(() => {
    const allQuestionIds = new Set(questions.map((question) => question.id));
    const visibleQuestionIds = new Set(visibleQuestions.map((question) => question.id));
    return reviews.filter((review) => (
      !allQuestionIds.has(review.graphAnchorNodeId)
      || visibleQuestionIds.has(review.graphAnchorNodeId)
    ));
  }, [questions, reviews, visibleQuestions]);
  const { nodes, edges } = useMemo(() => {
    const flow = projectGraphToFlow(visibleQuestions, visibleReviews, focusId, displayMode);
    return {
      ...flow,
      nodes: flow.nodes.map((node) => ({
        ...node,
        ...(node.data.kind === "question" && displayMode === "questions"
          ? { type: "questionReference" }
          : {}),
        data: node.data.kind === "question"
          ? {
              ...node.data,
              onViewReferences: () => onViewDetails((node.data as QuestionNodeData).node),
            }
          : node.data,
        selected: node.id === selectedNodeId,
      })),
    };
  }, [displayMode, focusId, onViewDetails, selectedNodeId, visibleQuestions, visibleReviews]);
  const handleNodeClick: NodeMouseHandler = (event, node) => {
    const data = node.data as GraphFlowNodeData;
    window.clearTimeout(locateConfirmationTimerRef.current);
    setContextMenu(undefined);
    setReviewContextMenu(undefined);
    setTooltip(undefined);
    if (data.kind === "review") {
      setSelectedNodeId(node.id);
      onOpenReview?.(data.review);
      return;
    }
    const question = data.node;
    const activation = getGraphNodeActivation(
      selectedNodeId,
      question.id,
      event.detail,
    );
    if (activation === "ignore") return;
    if (activation === "confirm_locate") {
      if (question.kind === "planned") return;
      window.clearTimeout(locateConfirmationTimerRef.current);
      locateConfirmationTimerRef.current = window.setTimeout(
        () => onRequestLocate(question),
        240,
      );
      return;
    }
    setSelectedNodeId(question.id);
    onMakeCurrent(question);
  };
  const handleNodeDoubleClick: NodeMouseHandler = (_, node) => {
    if ((node.data as GraphFlowNodeData).kind === "review") return;
    const hasChildren = questions.some((question) => question.parentId === node.id);
    if (!hasChildren) return;
    window.clearTimeout(locateConfirmationTimerRef.current);
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const openContextMenu = (question: QuestionNode, clientX?: number, clientY?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    window.clearTimeout(locateConfirmationTimerRef.current);
    setTooltip(undefined);
    setReviewContextMenu(undefined);
    const rect = canvas.getBoundingClientRect();
    setContextMenu({
      node: question,
      x: Math.min(Math.max(8, (clientX ?? rect.left + rect.width / 2) - rect.left), Math.max(8, rect.width - 210)),
      y: Math.min(Math.max(8, (clientY ?? rect.top + rect.height / 2) - rect.top), Math.max(8, rect.height - 184)),
    });
    setStatusMenuOpen(false);
  };

  const openReviewContextMenu = (
    review: ReviewGraphArtifact,
    clientX?: number,
    clientY?: number,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    window.clearTimeout(locateConfirmationTimerRef.current);
    setTooltip(undefined);
    setContextMenu(undefined);
    setStatusMenuOpen(false);
    const rect = canvas.getBoundingClientRect();
    setReviewContextMenu({
      review,
      x: Math.min(
        Math.max(8, (clientX ?? rect.left + rect.width / 2) - rect.left),
        Math.max(8, rect.width - 210),
      ),
      y: Math.min(
        Math.max(8, (clientY ?? rect.top + rect.height / 2) - rect.top),
        Math.max(8, rect.height - 104),
      ),
    });
  };

  function revealNode(data: GraphFlowNodeData, target: EventTarget | null) {
    if (displayMode !== "nodes") return;
    const canvas = canvasRef.current;
    const element = target instanceof Element
      ? target.closest<HTMLElement>(".react-flow__node[data-id]")
      : null;
    if (!canvas || !element) return;
    const canvasRect = canvas.getBoundingClientRect();
    const nodeRect = element.getBoundingClientRect();
    const below = nodeRect.top - canvasRect.top < 72;
    setTooltip({
      label: data.kind === "review" ? data.review.version.title : data.node.question,
      x: nodeRect.left - canvasRect.left + nodeRect.width / 2,
      y: below
        ? nodeRect.bottom - canvasRect.top + 10
        : nodeRect.top - canvasRect.top - 10,
      below,
    });
  }

  async function setNodeStatus(status: NodeStatus) {
    if (!contextMenu || updatingNodeId) return;
    const node = contextMenu.node;
    if (node.status === status) {
      setContextMenu(undefined);
      return;
    }
    setUpdatingNodeId(node.id);
    try {
      const updated = await onSetStatus(node, status);
      if (updated) setContextMenu(undefined);
    } finally {
      setUpdatingNodeId(undefined);
    }
  }

  function viewNodeDetails() {
    if (!contextMenu) return;
    setSelectedNodeId(contextMenu.node.id);
    onViewDetails(contextMenu.node);
    setContextMenu(undefined);
  }

  function changeNodeParent() {
    if (!contextMenu) return;
    const node = contextMenu.node;
    setSelectedNodeId(node.id);
    setContextMenu(undefined);
    setStatusMenuOpen(false);
    onChangeParent(node);
  }

  function requestNodeDelete(deleteDescendants = false) {
    if (!contextMenu) return;
    const node = contextMenu.node;
    setSelectedNodeId(node.id);
    setContextMenu(undefined);
    setStatusMenuOpen(false);
    onRequestDelete(node, deleteDescendants);
  }

  function toggleStatusMenu() {
    setStatusMenuOpen((open) => {
      const next = !open;
      if (next) {
        const canvasHeight = canvasRef.current?.clientHeight ?? 0;
        setContextMenu((menu) => menu
          ? { ...menu, y: Math.min(menu.y, Math.max(8, canvasHeight - 316)) }
          : menu);
      }
      return next;
    });
  }

  useEffect(() => {
    return () => window.clearTimeout(locateConfirmationTimerRef.current);
  }, []);

  useEffect(() => {
    setTooltip(undefined);
    setContextMenu(undefined);
    setReviewContextMenu(undefined);
    setStatusMenuOpen(false);
  }, [displayMode]);

  useEffect(() => {
    if (!contextMenu && !reviewContextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (menuRef.current && event.composedPath().includes(menuRef.current)) return;
      setContextMenu(undefined);
      setReviewContextMenu(undefined);
      setStatusMenuOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (statusMenuOpen) setStatusMenuOpen(false);
      else {
        setContextMenu(undefined);
        setReviewContextMenu(undefined);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [contextMenu, reviewContextMenu, statusMenuOpen]);

  return (
    <section className="graph-card">
      <div className="graph-card__toolbar">
        <div className="graph-card__legend" aria-label="状态图例">
          {NODE_STATUS_OPTIONS.map((status) => (
            <span key={status}>
              <i style={{ background: NODE_COLORS[status] }} /> {NODE_STATUS_LABELS[status]}
            </span>
          ))}
          {reviews.length ? (
            <span>
              <i style={{ background: "#8b5cf6" }} /> 总结
            </span>
          ) : null}
        </div>
        <div className="graph-display-switch" role="group" aria-label="图谱显示视角">
          <button
            type="button"
            className={displayMode === "nodes" ? "is-active" : undefined}
            aria-pressed={displayMode === "nodes"}
            onClick={() => onDisplayModeChange("nodes")}
          >
            节点视角
          </button>
          <button
            type="button"
            className={displayMode === "questions" ? "is-active" : undefined}
            aria-pressed={displayMode === "questions"}
            onClick={() => onDisplayModeChange("questions")}
          >
            详情问题视角
          </button>
        </div>
      </div>
      <div
        ref={canvasRef}
        className="graph-canvas"
        onFocusCapture={(event) => {
          const element = event.target instanceof Element
            ? event.target.closest<HTMLElement>(".react-flow__node[data-id]")
            : null;
          const node = nodes.find((item) => item.id === element?.dataset.id);
          if (node) revealNode(node.data, element);
        }}
        onBlurCapture={() => setTooltip(undefined)}
        onKeyDownCapture={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          const element = event.target instanceof Element
            ? event.target.closest<HTMLElement>(".react-flow__node[data-id]")
            : null;
          const nodeId = element?.dataset.id ?? selectedNodeId;
          const node = nodes.find((item) => item.id === nodeId);
          if (!node) return;
          event.preventDefault();
          if (node.data.kind === "review") openReviewContextMenu(node.data.review);
          else openContextMenu(node.data.node);
        }}
      >
        <ReactFlow
          key={displayMode}
          nodes={nodes}
          edges={edges}
          nodeTypes={QUESTION_NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          minZoom={0.25}
          maxZoom={displayMode === "nodes" ? 4 : 1.8}
          fitViewOptions={{ padding: displayMode === "nodes" ? 0.3 : 0.15 }}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeMouseEnter={(event, node) =>
            revealNode(node.data as GraphFlowNodeData, event.target)}
          onNodeMouseLeave={() => setTooltip(undefined)}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            const data = node.data as GraphFlowNodeData;
            if (data.kind === "review") {
              openReviewContextMenu(data.review, event.clientX, event.clientY);
            } else {
              openContextMenu(data.node, event.clientX, event.clientY);
            }
          }}
          onPaneClick={() => {
            setContextMenu(undefined);
            setReviewContextMenu(undefined);
          }}
        >
          <Background color="#dbe2ea" gap={18} size={1} variant={BackgroundVariant.Dots} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => {
              const data = node.data as GraphFlowNodeData;
              return data.kind === "review" ? "#8b5cf6" : NODE_COLORS[data.node.status];
            }}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
        {tooltip && displayMode === "nodes" ? (
          <div
            className={`graph-node-tooltip${tooltip.below ? " is-below" : ""}`}
            role="tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.label}
          </div>
        ) : null}
        {contextMenu ? (
          <div
            ref={menuRef}
            className="graph-context-menu"
            role="menu"
            aria-label={`节点操作：${contextMenu.node.question}`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="graph-context-menu__title" title={contextMenu.node.question}>
              {contextMenu.node.question}
            </div>
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={viewNodeDetails}
            >
              查看总结与详情
            </button>
            {onSummarizeNode ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const node = contextMenu.node;
                  setContextMenu(undefined);
                  onSummarizeNode(node);
                }}
              >
                总结此节点
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={updatingNodeId === contextMenu.node.id}
              onClick={changeNodeParent}
            >
              更换父节点
            </button>
            <button
              className="graph-context-menu__status-trigger"
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={statusMenuOpen}
              disabled={updatingNodeId === contextMenu.node.id}
              onClick={toggleStatusMenu}
            >
              <span>{updatingNodeId === contextMenu.node.id ? "更新中…" : "标记状态"}</span>
              <span className="graph-context-menu__status-current">
                {NODE_STATUS_LABELS[contextMenu.node.status]} {statusMenuOpen ? "⌃" : "⌄"}
              </span>
            </button>
            {statusMenuOpen ? (
              <div className="graph-context-menu__status-options" role="menu" aria-label="选择节点状态">
                {NODE_STATUS_OPTIONS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="menuitemradio"
                    aria-checked={contextMenu.node.status === status}
                    disabled={updatingNodeId === contextMenu.node.id}
                    onClick={() => void setNodeStatus(status)}
                  >
                    <span className={`graph-context-menu__status-dot is-${status}`} aria-hidden="true" />
                    <span>{NODE_STATUS_LABELS[status]}</span>
                    {contextMenu.node.status === status ? <span aria-hidden="true">✓</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              className="graph-context-menu__delete"
              type="button"
              role="menuitem"
              disabled={updatingNodeId === contextMenu.node.id}
              onClick={() => requestNodeDelete(false)}
            >
              删除节点
            </button>
            <button
              className="graph-context-menu__delete"
              type="button"
              role="menuitem"
              disabled={updatingNodeId === contextMenu.node.id || countDescendants(questions, contextMenu.node.id) === 0}
              onClick={() => requestNodeDelete(true)}
            >
              删除节点及其子节点
            </button>
          </div>
        ) : null}
        {reviewContextMenu ? (
          <div
            ref={menuRef}
            className="graph-context-menu"
            role="menu"
            aria-label={`总结操作：${reviewContextMenu.review.version.title}`}
            style={{ left: reviewContextMenu.x, top: reviewContextMenu.y }}
          >
            <div
              className="graph-context-menu__title"
              title={reviewContextMenu.review.version.title}
            >
              {reviewContextMenu.review.version.title}
            </div>
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => {
                const review = reviewContextMenu.review;
                setSelectedNodeId(reviewArtifactFlowNodeId(review.id));
                setReviewContextMenu(undefined);
                onOpenReview?.(review);
              }}
            >
              打开总结
            </button>
            <button
              className="graph-context-menu__delete"
              type="button"
              role="menuitem"
              onClick={() => {
                const review = reviewContextMenu.review;
                setReviewContextMenu(undefined);
                onDeleteReview?.(review);
              }}
            >
              删除总结
            </button>
          </div>
        ) : null}
      </div>
      <p className="graph-card__hint">
        {displayMode === "nodes" ? "悬浮节点查看完整问题；" : ""}
        问题节点单击设为当前、再次单击定位，双击折叠子树；紫色文档节点单击打开总结，右键可删除。蓝色边表示当前路径。
      </p>
    </section>
  );
}

function QuestionReferenceNode({ data }: NodeProps<Node<QuestionNodeData>>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div className="graph-question-node__question">{data.node.question}</div>
      <QuestionReferenceBadges
        references={data.node.references}
        onOpen={() => data.onViewReferences?.()}
      />
      <Handle type="source" position={Position.Right} />
    </>
  );
}

function ReviewArtifactNode({ data }: NodeProps<Node<ReviewArtifactNodeData>>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <span
        aria-hidden="true"
        style={{ marginRight: data.compact ? 0 : 7, fontSize: data.compact ? 12 : "inherit" }}
      >
        ▤
      </span>
      {data.compact ? null : <span>{data.review.version.title}</span>}
      {data.review.stale ? (
        <span title="已有后续消息" aria-label="已有后续消息" style={{ marginLeft: 6, color: "#f59e0b" }}>●</span>
      ) : null}
    </>
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
