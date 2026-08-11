import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import { getGraphNodeActivation } from "../graph/graphNodeActivation";
import { questionsToFlow, type QuestionNodeData } from "../graph/layout";
import { NODE_STATUS_LABELS, NODE_STATUS_OPTIONS } from "../shared/nodeStatus";
import type { NodeStatus, QuestionNode } from "../types/domain";

type Props = {
  questions: QuestionNode[];
  focusId?: string;
  onMakeCurrent: (node: QuestionNode) => void;
  onViewDetails: (node: QuestionNode) => void;
  onRequestLocate: (node: QuestionNode) => void;
  onRequestDelete: (node: QuestionNode, deleteDescendants?: boolean) => void;
  onSetStatus: (node: QuestionNode, status: NodeStatus) => Promise<boolean>;
};

const NODE_COLORS: Record<QuestionNode["status"], string> = {
  pending: "#94a3b8",
  resolved: "#22c55e",
};

export function GraphView({
  questions,
  focusId,
  onMakeCurrent,
  onViewDetails,
  onRequestLocate,
  onRequestDelete,
  onSetStatus,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [updatingNodeId, setUpdatingNodeId] = useState<string>();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    node: QuestionNode;
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
  const { nodes, edges } = useMemo(
    () => questionsToFlow(visibleQuestions, focusId),
    [focusId, visibleQuestions],
  );
  const handleNodeClick: NodeMouseHandler = (event, node) => {
    const question = (node.data as QuestionNodeData).node;
    window.clearTimeout(locateConfirmationTimerRef.current);
    setContextMenu(undefined);
    const activation = getGraphNodeActivation(
      selectedNodeId,
      question.id,
      event.detail,
    );
    if (activation === "ignore") return;
    if (activation === "confirm_locate") {
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
    const rect = canvas.getBoundingClientRect();
    setContextMenu({
      node: question,
      x: Math.min(Math.max(8, (clientX ?? rect.left + rect.width / 2) - rect.left), Math.max(8, rect.width - 210)),
      y: Math.min(Math.max(8, (clientY ?? rect.top + rect.height / 2) - rect.top), Math.max(8, rect.height - 126)),
    });
    setStatusMenuOpen(false);
  };

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
          ? { ...menu, y: Math.min(menu.y, Math.max(8, canvasHeight - 284)) }
          : menu);
      }
      return next;
    });
  }

  useEffect(() => {
    return () => window.clearTimeout(locateConfirmationTimerRef.current);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (menuRef.current && event.composedPath().includes(menuRef.current)) return;
      setContextMenu(undefined);
      setStatusMenuOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (statusMenuOpen) setStatusMenuOpen(false);
      else setContextMenu(undefined);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [contextMenu, statusMenuOpen]);

  return (
    <section className="graph-card">
      <div className="graph-card__legend" aria-label="状态图例">
        {NODE_STATUS_OPTIONS.map((status) => (
          <span key={status}>
            <i style={{ background: NODE_COLORS[status] }} /> {NODE_STATUS_LABELS[status]}
          </span>
        ))}
      </div>
      <div
        ref={canvasRef}
        className="graph-canvas"
        onKeyDownCapture={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          const element = event.target instanceof Element
            ? event.target.closest<HTMLElement>(".react-flow__node[data-id]")
            : null;
          const nodeId = element?.dataset.id ?? selectedNodeId;
          const question = questions.find((item) => item.id === nodeId);
          if (!question) return;
          event.preventDefault();
          openContextMenu(question);
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          minZoom={0.25}
          maxZoom={1.8}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            openContextMenu((node.data as QuestionNodeData).node, event.clientX, event.clientY);
          }}
          onPaneClick={() => setContextMenu(undefined)}
        >
          <Background color="#dbe2ea" gap={18} size={1} variant={BackgroundVariant.Dots} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => NODE_COLORS[(node.data as QuestionNodeData).node.status]}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
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
      </div>
      <p className="graph-card__hint">单击设为当前节点；再次单击可确认定位；双击折叠或展开子树；右键查看详情、标记状态或删除。蓝色边表示当前路径。</p>
    </section>
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
