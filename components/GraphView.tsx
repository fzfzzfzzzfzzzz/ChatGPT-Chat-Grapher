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
import type { QuestionNode } from "../types/domain";

type Props = {
  questions: QuestionNode[];
  focusId?: string;
  onMakeCurrent: (node: QuestionNode) => void;
  onRequestLocate: (node: QuestionNode) => void;
};

const NODE_COLORS: Record<QuestionNode["status"], string> = {
  active: "#f97316",
  pending: "#94a3b8",
  resolved: "#22c55e",
  parked: "#f59e0b",
  rejected: "#cbd5e1",
};

export function GraphView({
  questions,
  focusId,
  onMakeCurrent,
  onRequestLocate,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
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

  useEffect(() => {
    return () => window.clearTimeout(locateConfirmationTimerRef.current);
  }, []);

  return (
    <section className="graph-card">
      <div className="graph-card__legend" aria-label="状态图例">
        {Object.entries(NODE_COLORS).map(([status, color]) => (
          <span key={status}><i style={{ background: color }} /> {status}</span>
        ))}
      </div>
      <div className="graph-canvas">
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
        >
          <Background color="#dbe2ea" gap={18} size={1} variant={BackgroundVariant.Dots} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => NODE_COLORS[(node.data as QuestionNodeData).node.status]}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="graph-card__hint">单击设为 Current；再次单击可确认定位；双击折叠或展开子树。蓝色边表示 Current Path。</p>
    </section>
  );
}
