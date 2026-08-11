import { useEffect, useMemo, useRef, useState } from "react";
import { layoutCompactGraph } from "../../graph/compactGraphLayout";
import { getGraphNodeActivation } from "../../graph/graphNodeActivation";
import { NODE_STATUS_LABELS, NODE_STATUS_OPTIONS } from "../../shared/nodeStatus";
import type { FloatingPanelGraphNode } from "../../shared/messages";
import type { NodeStatus } from "../../types/domain";

type Props = {
  nodes: FloatingPanelGraphNode[];
  currentNodeId?: string;
  focusedNodeId?: string;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onViewNodeDetails: (nodeId: string) => void;
  onSetNodeStatus: (nodeId: string, status: NodeStatus) => Promise<boolean>;
  onDeleteNode: (nodeId: string) => Promise<boolean>;
  onRequestLocateNode: (nodeId: string) => void;
};

type TooltipState = {
  nodeId: string;
  x: number;
  y: number;
  below: boolean;
};

type ContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

export function CompactProjectGraph({
  nodes,
  currentNodeId,
  focusedNodeId,
  selectedNodeId,
  onSelectNode,
  onViewNodeDetails,
  onSetNodeStatus,
  onDeleteNode,
  onRequestLocateNode,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [updatingNodeId, setUpdatingNodeId] = useState<string>();
  const [deletingNodeId, setDeletingNodeId] = useState<string>();
  const [confirmingDeleteNodeId, setConfirmingDeleteNodeId] = useState<string>();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const layout = useMemo(() => layoutCompactGraph(nodes), [nodes]);
  const positionedById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const currentPath = useMemo(
    () => getAncestorPath(nodes, currentNodeId),
    [currentNodeId, nodes],
  );
  const tooltipNode = tooltip
    ? positionedById.get(tooltip.nodeId)
    : undefined;
  const contextNode = contextMenu
    ? positionedById.get(contextMenu.nodeId)
    : undefined;

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (menuRef.current && event.composedPath().includes(menuRef.current)) return;
      setContextMenu(undefined);
      setStatusMenuOpen(false);
      setConfirmingDeleteNodeId(undefined);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmingDeleteNodeId) setConfirmingDeleteNodeId(undefined);
      else if (statusMenuOpen) setStatusMenuOpen(false);
      else setContextMenu(undefined);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [confirmingDeleteNodeId, contextMenu, statusMenuOpen]);

  useEffect(() => {
    if (contextMenu && !positionedById.has(contextMenu.nodeId)) {
      setContextMenu(undefined);
    }
  }, [contextMenu, positionedById]);

  function revealNode(nodeId: string) {
    const canvas = canvasRef.current;
    const node = positionedById.get(nodeId);
    if (!canvas || !node) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / layout.width, rect.height / layout.height);
    const offsetX = (rect.width - layout.width * scale) / 2;
    const offsetY = (rect.height - layout.height * scale) / 2;
    const rawX = offsetX + node.x * scale;
    const rawY = offsetY + node.y * scale;
    setTooltip({
      nodeId,
      x: Math.min(Math.max(92, rawX), Math.max(92, rect.width - 92)),
      y: rawY,
      below: rawY < 70,
    });
  }

  function openContextMenu(
    nodeId: string,
    clientPosition?: { x: number; y: number },
  ) {
    const canvas = canvasRef.current;
    const node = positionedById.get(nodeId);
    if (!canvas || !node) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / layout.width, rect.height / layout.height);
    const offsetX = (rect.width - layout.width * scale) / 2;
    const offsetY = (rect.height - layout.height * scale) / 2;
    const rawX = clientPosition ? clientPosition.x - rect.left : offsetX + node.x * scale;
    const rawY = clientPosition ? clientPosition.y - rect.top : offsetY + node.y * scale;
    setTooltip(undefined);
    setContextMenu({
      nodeId,
      x: Math.min(Math.max(8, rawX), Math.max(8, rect.width - 210)),
      y: Math.min(Math.max(8, rawY), Math.max(8, rect.height - 154)),
    });
    setStatusMenuOpen(false);
    setConfirmingDeleteNodeId(undefined);
  }

  async function setNodeStatus(status: NodeStatus) {
    if (!contextNode || updatingNodeId) return;
    if (contextNode.status === status) {
      setContextMenu(undefined);
      return;
    }
    setUpdatingNodeId(contextNode.id);
    try {
      const updated = await onSetNodeStatus(contextNode.id, status);
      if (updated) setContextMenu(undefined);
    } finally {
      setUpdatingNodeId(undefined);
    }
  }

  function toggleStatusMenu() {
    setStatusMenuOpen((open) => {
      const next = !open;
      if (next) setContextMenu((menu) => menu ? { ...menu, y: 8 } : menu);
      return next;
    });
  }

  function viewNodeDetails() {
    if (!contextNode) return;
    onViewNodeDetails(contextNode.id);
    setContextMenu(undefined);
  }

  function requestNodeDelete() {
    if (!contextNode) return;
    setStatusMenuOpen(false);
    setConfirmingDeleteNodeId(contextNode.id);
  }

  async function deleteNode() {
    if (!contextNode || deletingNodeId) return;
    const nodeId = contextNode.id;
    setDeletingNodeId(nodeId);
    try {
      if (await onDeleteNode(nodeId)) {
        setContextMenu(undefined);
        setConfirmingDeleteNodeId(undefined);
      }
    } finally {
      setDeletingNodeId(undefined);
    }
  }

  function activateNode(nodeId: string) {
    revealNode(nodeId);
    const activation = getGraphNodeActivation(selectedNodeId, nodeId);
    if (activation === "ignore") return;
    if (activation === "confirm_locate") {
      onRequestLocateNode(nodeId);
      return;
    }
    onSelectNode(nodeId);
  }

  if (nodes.length === 0) {
    return (
      <section className="chat-graph-map chat-graph-map--empty">
        <div className="chat-graph-map__empty">当前项目还没有问题节点</div>
      </section>
    );
  }

  return (
    <section className="chat-graph-map" aria-label="当前项目问题图">
      <div
        ref={canvasRef}
        className="chat-graph-map__canvas"
        onPointerLeave={() => setTooltip(undefined)}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`当前项目共有 ${nodes.length} 个问题节点`}
        >
          <g className="chat-graph-map__edges" aria-hidden="true">
            {layout.edges.map((edge) => {
              const source = positionedById.get(edge.sourceId);
              const target = positionedById.get(edge.targetId);
              if (!source || !target) return null;
              const midpoint = (source.x + target.x) / 2;
              const onCurrentPath = currentPath.has(edge.sourceId) && currentPath.has(edge.targetId);
              return (
                <path
                  key={edge.id}
                  className={onCurrentPath ? "is-current-path" : undefined}
                  d={`M ${source.x} ${source.y} C ${midpoint} ${source.y}, ${midpoint} ${target.y}, ${target.x} ${target.y}`}
                />
              );
            })}
          </g>
          <g className="chat-graph-map__nodes">
            {layout.nodes.map((node) => {
              const classes = [
                "chat-graph-map-node",
                `chat-graph-map-node--${node.status}`,
                node.id === currentNodeId ? "is-current" : "",
                node.id === focusedNodeId ? "is-focused" : "",
                node.id === selectedNodeId ? "is-selected" : "",
              ].filter(Boolean).join(" ");
              return (
                <g
                  key={node.id}
                  className={classes}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  aria-label={node.question}
                  aria-pressed={node.id === selectedNodeId}
                  tabIndex={0}
                  onPointerEnter={() => revealNode(node.id)}
                  onFocus={() => revealNode(node.id)}
                  onBlur={() => setTooltip(undefined)}
                  onClick={() => activateNode(node.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openContextMenu(node.id, { x: event.clientX, y: event.clientY });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activateNode(node.id);
                    }
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      openContextMenu(node.id);
                    }
                  }}
                >
                  <circle className="chat-graph-map-node__focus-ring" r="12" />
                  <circle className="chat-graph-map-node__dot" r="7" />
                  <circle className="chat-graph-map-node__hit-area" r="15" />
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && tooltipNode ? (
          <div
            className={`chat-graph-map__tooltip${tooltip.below ? " is-below" : ""}`}
            role="tooltip"
            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          >
            {tooltipNode.question}
          </div>
        ) : null}

        {contextMenu && contextNode ? (
          <div
            ref={menuRef}
            className="chat-graph-map__context-menu"
            role="menu"
            aria-label={`节点操作：${contextNode.question}`}
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            <div className="chat-graph-map__context-title" title={contextNode.question}>
              {contextNode.question}
            </div>
            {confirmingDeleteNodeId === contextNode.id ? (
              <div
                className="chat-graph-map__delete-confirm"
                role="group"
                aria-label={`确认删除节点：${contextNode.question}`}
              >
                <p>
                  {nodes.some((node) => node.parentId === contextNode.id)
                    ? "删除后，直接子节点会移动到当前父级。"
                    : "这个节点会从本地问题图中删除。"}
                </p>
                <div>
                  <button
                    type="button"
                    disabled={deletingNodeId === contextNode.id}
                    onClick={() => setConfirmingDeleteNodeId(undefined)}
                  >
                    取消
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    autoFocus
                    disabled={deletingNodeId === contextNode.id}
                    onClick={() => void deleteNode()}
                  >
                    {deletingNodeId === contextNode.id ? "删除中…" : "确认删除"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  onClick={viewNodeDetails}
                >
                  查看总结与详情
                </button>
                <button
                  className="chat-graph-map__status-trigger"
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={statusMenuOpen}
                  disabled={updatingNodeId === contextNode.id}
                  onClick={toggleStatusMenu}
                >
                  <span>{updatingNodeId === contextNode.id ? "更新中…" : "标记状态"}</span>
                  <span className="chat-graph-map__status-current">
                    {NODE_STATUS_LABELS[contextNode.status]} {statusMenuOpen ? "⌃" : "⌄"}
                  </span>
                </button>
                {statusMenuOpen ? (
                  <div className="chat-graph-map__status-options" role="menu" aria-label="选择节点状态">
                    {NODE_STATUS_OPTIONS.map((status) => (
                      <button
                        key={status}
                        type="button"
                        role="menuitemradio"
                        aria-checked={contextNode.status === status}
                        disabled={updatingNodeId === contextNode.id}
                        onClick={() => void setNodeStatus(status)}
                      >
                        <span className={`chat-graph-map__status-dot is-${status}`} aria-hidden="true" />
                        <span>{NODE_STATUS_LABELS[status]}</span>
                        {contextNode.status === status ? <span aria-hidden="true">✓</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  className="chat-graph-map__context-delete"
                  type="button"
                  role="menuitem"
                  disabled={updatingNodeId === contextNode.id}
                  onClick={requestNodeDelete}
                >
                  删除节点
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
      <footer className="chat-graph-map__footer">
        <span>{nodes.length} 个问题</span>
        <span>单击选择 · 再次单击定位 · 右键查看详情、标记状态或删除</span>
      </footer>
    </section>
  );
}

function getAncestorPath(nodes: FloatingPanelGraphNode[], nodeId?: string): Set<string> {
  const path = new Set<string>();
  if (!nodeId) return path;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);

  while (current && !path.has(current.id)) {
    path.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path;
}
