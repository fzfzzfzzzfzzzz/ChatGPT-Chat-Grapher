import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { layoutCompactGraph } from "../../graph/compactGraphLayout";
import { getGraphNodeActivation } from "../../graph/graphNodeActivation";
import { NODE_STATUS_LABELS, NODE_STATUS_OPTIONS } from "../../shared/nodeStatus";
import type {
  FloatingPanelGraphNode,
  FloatingPanelReviewArtifact,
} from "../../shared/messages";
import type { NodeStatus } from "../../types/domain";

type Props = {
  nodes: FloatingPanelGraphNode[];
  reviewArtifacts?: FloatingPanelReviewArtifact[];
  currentNodeId?: string;
  focusedNodeId?: string;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onViewNodeDetails: (nodeId: string) => void;
  onChangeNodeParent: (nodeId: string) => void;
  onSetNodeStatus: (nodeId: string, status: NodeStatus) => Promise<boolean>;
  onDeleteNode: (nodeId: string, deleteDescendants?: boolean) => Promise<boolean>;
  onRequestLocateNode: (nodeId: string) => void;
  onSummarizeNode?: (nodeId: string) => void;
  onOpenReviewArtifact?: (artifact: FloatingPanelReviewArtifact) => void;
  onDeleteReviewArtifact?: (documentId: string) => Promise<boolean>;
  onOpenFullGraph: () => void;
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

type PositionedReviewArtifact = FloatingPanelReviewArtifact & {
  x: number;
  y: number;
  attached: boolean;
};

type GraphViewport = {
  zoom: number;
  x: number;
  y: number;
};

const DEFAULT_VIEWPORT: GraphViewport = { zoom: 1, x: 0, y: 0 };
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

export function CompactProjectGraph({
  nodes,
  reviewArtifacts = [],
  currentNodeId,
  focusedNodeId,
  selectedNodeId,
  onSelectNode,
  onViewNodeDetails,
  onChangeNodeParent,
  onSetNodeStatus,
  onDeleteNode,
  onRequestLocateNode,
  onSummarizeNode,
  onOpenReviewArtifact,
  onDeleteReviewArtifact,
  onOpenFullGraph,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
  } | undefined>(undefined);
  const [tooltip, setTooltip] = useState<TooltipState>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [updatingNodeId, setUpdatingNodeId] = useState<string>();
  const [deletingNodeId, setDeletingNodeId] = useState<string>();
  const [deletingReviewId, setDeletingReviewId] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState<{
    nodeId: string;
    deleteDescendants: boolean;
  }>();
  const [confirmingReviewDeleteId, setConfirmingReviewDeleteId] = useState<string>();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [viewport, setViewport] = useState<GraphViewport>(DEFAULT_VIEWPORT);
  const [panning, setPanning] = useState(false);
  const layout = useMemo(() => layoutCompactGraph(nodes), [nodes]);
  const graphStructureKey = useMemo(
    () => [
      nodes.map((node) => `${node.id}:${node.parentId ?? ""}`).join("|"),
      reviewArtifacts.map((artifact) => `${artifact.id}:${artifact.anchorNodeId}`).join("|"),
    ].join("#"),
    [nodes, reviewArtifacts],
  );
  const positionedById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const currentPath = useMemo(
    () => getAncestorPath(nodes, currentNodeId),
    [currentNodeId, nodes],
  );
  const positionedReviewArtifacts = useMemo(
    () => positionReviewArtifacts(reviewArtifacts, positionedById, layout.width),
    [layout.width, positionedById, reviewArtifacts],
  );
  const reviewArtifactById = useMemo(
    () => new Map(positionedReviewArtifacts.map((artifact) => [artifact.id, artifact])),
    [positionedReviewArtifacts],
  );
  const graphDimensions = useMemo(() => ({
    width: Math.max(
      layout.width,
      ...positionedReviewArtifacts.map((artifact) => artifact.x + 30),
    ),
    height: Math.max(
      layout.height,
      ...positionedReviewArtifacts.map((artifact) => artifact.y + 30),
    ),
  }), [layout.height, layout.width, positionedReviewArtifacts]);
  const tooltipNode = tooltip
    ? positionedById.get(tooltip.nodeId)
    : undefined;
  const tooltipReviewArtifact = tooltip
    ? reviewArtifactById.get(tooltip.nodeId)
    : undefined;
  const contextNode = contextMenu
    ? positionedById.get(contextMenu.nodeId)
    : undefined;
  const contextReviewArtifact = contextMenu
    ? reviewArtifactById.get(contextMenu.nodeId)
    : undefined;

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (menuRef.current && event.composedPath().includes(menuRef.current)) return;
      setContextMenu(undefined);
      setStatusMenuOpen(false);
      setConfirmingDelete(undefined);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmingDelete) setConfirmingDelete(undefined);
      else if (confirmingReviewDeleteId) setConfirmingReviewDeleteId(undefined);
      else if (statusMenuOpen) setStatusMenuOpen(false);
      else setContextMenu(undefined);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [confirmingDelete, confirmingReviewDeleteId, contextMenu, statusMenuOpen]);

  useEffect(() => {
    if (
      contextMenu
      && !positionedById.has(contextMenu.nodeId)
      && !reviewArtifactById.has(contextMenu.nodeId)
    ) {
      setContextMenu(undefined);
    }
  }, [contextMenu, positionedById, reviewArtifactById]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const menu = menuRef.current;
    if (!contextMenu || !canvas || !menu) return;

    const canvasRect = canvas.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const inset = 8;
    const nextX = Math.min(
      Math.max(inset, contextMenu.x),
      Math.max(inset, canvasRect.width - menuRect.width - inset),
    );
    const nextY = Math.min(
      Math.max(inset, contextMenu.y),
      Math.max(inset, canvasRect.height - menuRect.height - inset),
    );

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((current) => current ? { ...current, x: nextX, y: nextY } : current);
    }
  }, [
    confirmingDelete?.deleteDescendants,
    confirmingDelete?.nodeId,
    confirmingReviewDeleteId,
    contextMenu?.nodeId,
    contextMenu?.x,
    contextMenu?.y,
    statusMenuOpen,
  ]);

  useEffect(() => {
    setViewport(DEFAULT_VIEWPORT);
    setTooltip(undefined);
    setContextMenu(undefined);
  }, [graphStructureKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      zoomGraph(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, {
        x: event.clientX,
        y: event.clientY,
      });
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [graphDimensions.height, graphDimensions.width]);

  function graphPointInCanvas(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const baseScale = Math.min(
      rect.width / graphDimensions.width,
      rect.height / graphDimensions.height,
    );
    if (!Number.isFinite(baseScale) || baseScale <= 0) return;
    const offsetX = (rect.width - graphDimensions.width * baseScale) / 2;
    const offsetY = (rect.height - graphDimensions.height * baseScale) / 2;
    return {
      x: offsetX + (viewport.x + x * viewport.zoom) * baseScale,
      y: offsetY + (viewport.y + y * viewport.zoom) * baseScale,
    };
  }

  function revealNode(nodeId: string) {
    const canvas = canvasRef.current;
    const node = positionedById.get(nodeId) ?? reviewArtifactById.get(nodeId);
    if (!canvas || !node) return;
    const rect = canvas.getBoundingClientRect();
    const point = graphPointInCanvas(node.x, node.y);
    if (!point) return;
    setTooltip({
      nodeId,
      x: Math.min(Math.max(92, point.x), Math.max(92, rect.width - 92)),
      y: point.y,
      below: point.y < 70,
    });
  }

  function openContextMenu(
    nodeId: string,
    clientPosition?: { x: number; y: number },
  ) {
    const canvas = canvasRef.current;
    const node = positionedById.get(nodeId) ?? reviewArtifactById.get(nodeId);
    if (!canvas || !node) return;
    const rect = canvas.getBoundingClientRect();
    const point = clientPosition ? undefined : graphPointInCanvas(node.x, node.y);
    if (!clientPosition && !point) return;
    const rawX = clientPosition ? clientPosition.x - rect.left : point!.x;
    const rawY = clientPosition ? clientPosition.y - rect.top : point!.y;
    setTooltip(undefined);
    setContextMenu({
      nodeId,
      x: Math.min(Math.max(8, rawX), Math.max(8, rect.width - 210)),
      y: Math.min(Math.max(8, rawY), Math.max(8, rect.height - 8)),
    });
    setStatusMenuOpen(false);
    setConfirmingDelete(undefined);
    setConfirmingReviewDeleteId(undefined);
  }

  function zoomGraph(multiplier: number, clientPosition?: { x: number; y: number }) {
    const canvas = canvasRef.current;
    setTooltip(undefined);
    setContextMenu(undefined);
    setViewport((current) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * multiplier));
      if (nextZoom === current.zoom) return current;
      if (!canvas || !clientPosition) {
        const centerX = graphDimensions.width / 2;
        const centerY = graphDimensions.height / 2;
        const graphX = (centerX - current.x) / current.zoom;
        const graphY = (centerY - current.y) / current.zoom;
        return {
          zoom: nextZoom,
          x: centerX - graphX * nextZoom,
          y: centerY - graphY * nextZoom,
        };
      }

      const rect = canvas.getBoundingClientRect();
      const baseScale = Math.min(
        rect.width / graphDimensions.width,
        rect.height / graphDimensions.height,
      );
      if (!Number.isFinite(baseScale) || baseScale <= 0) return { ...current, zoom: nextZoom };
      const offsetX = (rect.width - graphDimensions.width * baseScale) / 2;
      const offsetY = (rect.height - graphDimensions.height * baseScale) / 2;
      const anchorX = (clientPosition.x - rect.left - offsetX) / baseScale;
      const anchorY = (clientPosition.y - rect.top - offsetY) / baseScale;
      const graphX = (anchorX - current.x) / current.zoom;
      const graphY = (anchorY - current.y) / current.zoom;
      return {
        zoom: nextZoom,
        x: anchorX - graphX * nextZoom,
        y: anchorY - graphY * nextZoom,
      };
    });
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      (event.target as Element).closest(
        ".chat-graph-map-node, .chat-graph-review-artifact, .chat-graph-map__controls, .chat-graph-map__context-menu",
      )
    ) return;
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    setTooltip(undefined);
    setContextMenu(undefined);
    setPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const canvas = canvasRef.current;
    if (!pan || !canvas || pan.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const baseScale = Math.min(
      rect.width / graphDimensions.width,
      rect.height / graphDimensions.height,
    );
    if (!Number.isFinite(baseScale) || baseScale <= 0) return;
    const deltaX = (event.clientX - pan.clientX) / baseScale;
    const deltaY = (event.clientY - pan.clientY) / baseScale;
    pan.clientX = event.clientX;
    pan.clientY = event.clientY;
    setViewport((current) => ({
      ...current,
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = undefined;
    setPanning(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function fitAllNodes() {
    setViewport(DEFAULT_VIEWPORT);
    setTooltip(undefined);
    setContextMenu(undefined);
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

  function openReviewArtifact() {
    if (!contextReviewArtifact || !onOpenReviewArtifact) return;
    setContextMenu(undefined);
    setConfirmingReviewDeleteId(undefined);
    onOpenReviewArtifact(reviewArtifactValue(contextReviewArtifact));
  }

  async function deleteReviewArtifact() {
    if (!contextReviewArtifact || !onDeleteReviewArtifact || deletingReviewId) return;
    setDeletingReviewId(contextReviewArtifact.documentId);
    try {
      if (await onDeleteReviewArtifact(contextReviewArtifact.documentId)) {
        setContextMenu(undefined);
        setConfirmingReviewDeleteId(undefined);
      }
    } finally {
      setDeletingReviewId(undefined);
    }
  }

  function changeNodeParent() {
    if (!contextNode) return;
    const nodeId = contextNode.id;
    setContextMenu(undefined);
    setStatusMenuOpen(false);
    setConfirmingDelete(undefined);
    onChangeNodeParent(nodeId);
  }

  function requestNodeDelete(deleteDescendants = false) {
    if (!contextNode) return;
    setStatusMenuOpen(false);
    setConfirmingDelete({ nodeId: contextNode.id, deleteDescendants });
  }

  async function deleteNode() {
    if (!contextNode || deletingNodeId) return;
    const nodeId = contextNode.id;
    setDeletingNodeId(nodeId);
    try {
      if (await onDeleteNode(nodeId, confirmingDelete?.deleteDescendants)) {
        setContextMenu(undefined);
        setConfirmingDelete(undefined);
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
      if (positionedById.get(nodeId)?.kind === "planned") return;
      onRequestLocateNode(nodeId);
      return;
    }
    onSelectNode(nodeId);
  }

  if (nodes.length === 0 && reviewArtifacts.length === 0) {
    return (
      <section className="chat-graph-map chat-graph-map--empty">
        <div className="chat-graph-map__empty">当前项目还没有问题节点</div>
      </section>
    );
  }

  return (
    <section className="chat-graph-map" aria-label="项目图视角">
      <div
        ref={canvasRef}
        className={`chat-graph-map__canvas${panning ? " is-panning" : ""}`}
        onPointerLeave={() => setTooltip(undefined)}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <svg
          viewBox={`0 0 ${graphDimensions.width} ${graphDimensions.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={reviewArtifacts.length
            ? `图视角显示项目的全部 ${nodes.length} 个问题节点和 ${reviewArtifacts.length} 个总结节点`
            : `图视角显示项目的全部 ${nodes.length} 个问题节点`}
        >
          <g
            className="chat-graph-map__viewport"
            transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
          >
            <g className="chat-graph-map__edges" aria-hidden="true">
              {layout.edges.map((edge) => {
                const source = positionedById.get(edge.sourceId);
                const target = positionedById.get(edge.targetId);
                if (!source || !target) return null;
                const onCurrentPath = currentPath.has(edge.sourceId) && currentPath.has(edge.targetId);
                return (
                  <path
                    key={edge.id}
                    className={onCurrentPath ? "is-current-path" : undefined}
                    d={`M ${source.x} ${source.y} L ${target.x} ${target.y}`}
                  />
                );
              })}
              {positionedReviewArtifacts.map((artifact) => {
                const source = positionedById.get(artifact.anchorNodeId);
                if (!source) return null;
                return (
                  <path
                    key={`review-edge:${artifact.documentId}`}
                    data-review-edge={artifact.documentId}
                    d={`M ${source.x} ${source.y} L ${artifact.x} ${artifact.y}`}
                    style={{ stroke: "#8b5cf6", strokeDasharray: "6 4" }}
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
                  node.kind === "planned" ? "is-planned" : "",
                ].filter(Boolean).join(" ");
                return (
                  <g
                    key={node.id}
                    className={classes}
                    transform={`translate(${node.x} ${node.y})`}
                    role="button"
                    aria-label={node.kind === "planned" ? `计划问题：${node.question}` : node.question}
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
                    {node.kind === "planned" ? (
                      <>
                        <rect
                          className="chat-graph-map-node__focus-ring"
                          x={node.id === currentNodeId ? -11 : -10}
                          y={node.id === currentNodeId ? -11 : -10}
                          width={node.id === currentNodeId ? 22 : 20}
                          height={node.id === currentNodeId ? 22 : 20}
                          rx="4"
                        />
                        <rect className="chat-graph-map-node__dot" x="-7" y="-7" width="14" height="14" rx="3" />
                      </>
                    ) : (
                      <>
                        <circle className="chat-graph-map-node__focus-ring" r={node.id === currentNodeId ? 14 : 12} />
                        <circle className="chat-graph-map-node__dot" r={node.id === currentNodeId ? 8 : 7} />
                      </>
                    )}
                    <circle className="chat-graph-map-node__hit-area" r="15" />
                  </g>
                );
              })}
            </g>
            <g className="chat-graph-map__review-artifacts">
              {positionedReviewArtifacts.map((artifact) => (
                <g
                  key={artifact.id}
                  className="chat-graph-review-artifact"
                  data-document-id={artifact.documentId}
                  transform={`translate(${artifact.x} ${artifact.y})`}
                  role="button"
                  aria-label={`总结：${artifact.title}${artifact.stale ? "，已有后续消息" : ""}`}
                  tabIndex={0}
                  onPointerEnter={() => revealNode(artifact.id)}
                  onFocus={() => revealNode(artifact.id)}
                  onBlur={() => setTooltip(undefined)}
                  onClick={() => {
                    revealNode(artifact.id);
                    onOpenReviewArtifact?.(reviewArtifactValue(artifact));
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openContextMenu(artifact.id, { x: event.clientX, y: event.clientY });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenReviewArtifact?.(reviewArtifactValue(artifact));
                    }
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      openContextMenu(artifact.id);
                    }
                  }}
                  style={{ cursor: "pointer", outline: "none" }}
                >
                  <rect
                    x="-10"
                    y="-12"
                    width="20"
                    height="24"
                    rx="3"
                    style={{ fill: "#8b5cf6", stroke: "#6d28d9", strokeWidth: 1.5 }}
                  />
                  <path
                    d="M 3 -12 L 10 -5 L 3 -5 Z M -5 1 L 5 1 M -5 5 L 3 5"
                    style={{ fill: "#c4b5fd", stroke: "#ffffff", strokeWidth: 1.2 }}
                    aria-hidden="true"
                  />
                  <rect x="-15" y="-17" width="30" height="34" fill="transparent" />
                  {artifact.stale ? <circle cx="10" cy="-12" r="3" fill="#f59e0b" /> : null}
                </g>
              ))}
            </g>
          </g>
        </svg>

        <div className="chat-graph-map__controls" role="group" aria-label="图视角缩放控制">
          <button
            type="button"
            title="缩小"
            aria-label="缩小图视角"
            disabled={viewport.zoom <= MIN_ZOOM}
            onClick={() => zoomGraph(1 / ZOOM_STEP)}
          >
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <output aria-label="当前缩放比例">{Math.round(viewport.zoom * 100)}%</output>
          <button
            type="button"
            title="放大"
            aria-label="放大图视角"
            disabled={viewport.zoom >= MAX_ZOOM}
            onClick={() => zoomGraph(ZOOM_STEP)}
          >
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="适应全部节点"
            aria-label="适应全部节点"
            onClick={fitAllNodes}
          >
            <Maximize2 size={13} aria-hidden="true" />
          </button>
        </div>

        {tooltip && (tooltipNode || tooltipReviewArtifact) ? (
          <div
            className={`chat-graph-map__tooltip${tooltip.below ? " is-below" : ""}`}
            role="tooltip"
            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          >
            <span>{tooltipReviewArtifact?.title ?? tooltipNode?.question}</span>
            {tooltipReviewArtifact ? (
              <small>{tooltipReviewArtifact.stale ? "已有后续消息" : "已保存总结"}</small>
            ) : tooltipNode?.kind === "planned" ? (
              <small>计划问题 · 发送后自动绑定原消息</small>
            ) : tooltipNode?.referenceCounts?.total ? (
              <small>
                {[
                  tooltipNode.referenceCounts.files ? `附件 ${tooltipNode.referenceCounts.files}` : "",
                  tooltipNode.referenceCounts.images ? `图片 ${tooltipNode.referenceCounts.images}` : "",
                  tooltipNode.referenceCounts.assistantQuotes
                    ? `回答引用 ${tooltipNode.referenceCounts.assistantQuotes}`
                    : "",
                ].filter(Boolean).join(" · ")}
              </small>
            ) : null}
          </div>
        ) : null}

        {contextMenu && (contextNode || contextReviewArtifact) ? (
          <div
            ref={menuRef}
            className="chat-graph-map__context-menu"
            role="menu"
            aria-label={contextReviewArtifact
              ? `总结操作：${contextReviewArtifact.title}`
              : `节点操作：${contextNode?.question ?? ""}`}
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            <div
              className="chat-graph-map__context-title"
              title={contextReviewArtifact?.title ?? contextNode?.question}
            >
              {contextReviewArtifact?.title ?? contextNode?.question}
            </div>
            {contextReviewArtifact ? (
              confirmingReviewDeleteId === contextReviewArtifact.documentId ? (
                <div
                  className="chat-graph-map__delete-confirm"
                  role="group"
                  aria-label={`确认删除总结：${contextReviewArtifact.title}`}
                >
                  <p>将删除这个本地总结及其全部历史版本，此操作不可撤销。</p>
                  <div>
                    <button
                      type="button"
                      disabled={deletingReviewId === contextReviewArtifact.documentId}
                      onClick={() => setConfirmingReviewDeleteId(undefined)}
                    >
                      取消
                    </button>
                    <button
                      className="is-danger"
                      type="button"
                      autoFocus
                      disabled={deletingReviewId === contextReviewArtifact.documentId}
                      onClick={() => void deleteReviewArtifact()}
                    >
                      {deletingReviewId === contextReviewArtifact.documentId ? "删除中…" : "确认删除"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus
                    onClick={openReviewArtifact}
                  >
                    打开总结
                  </button>
                  <button
                    className="chat-graph-map__context-delete"
                    type="button"
                    role="menuitem"
                    disabled={!onDeleteReviewArtifact}
                    onClick={() => setConfirmingReviewDeleteId(contextReviewArtifact.documentId)}
                  >
                    删除总结
                  </button>
                </>
              )
            ) : contextNode && confirmingDelete?.nodeId === contextNode.id ? (
              <div
                className="chat-graph-map__delete-confirm"
                role="group"
                aria-label={`确认删除节点：${contextNode.question}`}
              >
                <p>
                  {confirmingDelete.deleteDescendants
                    ? `将删除这个节点及其全部 ${countDescendants(nodes, contextNode.id)} 个子孙节点，此操作不可撤销。`
                    : nodes.some((node) => node.parentId === contextNode.id)
                      ? "删除后，直接子节点会移动到当前父级。"
                      : "这个节点会从本地问题图中删除。"}
                </p>
                <div>
                  <button
                    type="button"
                    disabled={deletingNodeId === contextNode.id}
                    onClick={() => setConfirmingDelete(undefined)}
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
            ) : contextNode ? (
              <>
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
                      const nodeId = contextNode.id;
                      setContextMenu(undefined);
                      onSummarizeNode(nodeId);
                    }}
                  >
                    总结此节点
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  disabled={updatingNodeId === contextNode.id}
                  onClick={changeNodeParent}
                >
                  更换父节点
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
                  onClick={() => requestNodeDelete(false)}
                >
                  删除节点
                </button>
                <button
                  className="chat-graph-map__context-delete"
                  type="button"
                  role="menuitem"
                  disabled={updatingNodeId === contextNode.id || countDescendants(nodes, contextNode.id) === 0}
                  onClick={() => requestNodeDelete(true)}
                >
                  删除节点及其子节点
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="chat-graph-map__footer">
        <span>
          全部 {nodes.length} 个问题节点
          {reviewArtifacts.length ? ` · ${reviewArtifacts.length} 个总结` : ""}
          {" · 滚轮缩放 / 拖动画布"}
        </span>
        <button type="button" onClick={onOpenFullGraph}>在侧栏打开 →</button>
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

function countDescendants(nodes: FloatingPanelGraphNode[], rootId: string): number {
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

function positionReviewArtifacts(
  artifacts: readonly FloatingPanelReviewArtifact[],
  questionPositions: ReadonlyMap<string, { x: number; y: number }>,
  baseWidth: number,
): PositionedReviewArtifact[] {
  const nextOffsetByAnchor = new Map<string, number>();
  let orphanIndex = 0;
  return artifacts.map((artifact) => {
    const anchor = questionPositions.get(artifact.anchorNodeId);
    if (!anchor) {
      const positioned = {
        ...artifact,
        x: baseWidth + 26,
        y: 24 + orphanIndex * 34,
        attached: false,
      };
      orphanIndex += 1;
      return positioned;
    }
    const anchorOffset = nextOffsetByAnchor.get(anchorId(artifact)) ?? 0;
    nextOffsetByAnchor.set(anchorId(artifact), anchorOffset + 1);
    return {
      ...artifact,
      x: anchor.x + 42,
      y: anchor.y + anchorOffset * 28,
      attached: true,
    };
  });
}

function anchorId(artifact: FloatingPanelReviewArtifact): string {
  return artifact.anchorNodeId;
}

function reviewArtifactValue(
  artifact: PositionedReviewArtifact,
): FloatingPanelReviewArtifact {
  return {
    id: artifact.id,
    title: artifact.title,
    anchorNodeId: artifact.anchorNodeId,
    documentId: artifact.documentId,
    versionId: artifact.versionId,
    savedAt: artifact.savedAt,
    ...(artifact.stale ? { stale: true } : {}),
  };
}
