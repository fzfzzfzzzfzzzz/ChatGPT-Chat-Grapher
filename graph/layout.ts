import type { Edge, Node } from "@xyflow/react";
import type { QuestionNode } from "../types/domain";
import { getCurrentPath } from "./questionTree";

export type QuestionNodeData = { label: string; node: QuestionNode; onCurrentPath: boolean };

const STATUS_COLORS: Record<QuestionNode["status"], { background: string; border: string }> = {
  pending: { background: "#ffffff", border: "#94a3b8" },
  resolved: { background: "#f0fdf4", border: "#22c55e" },
};

export function questionsToFlow(
  questions: QuestionNode[],
  focusId?: string,
): { nodes: Node<QuestionNodeData>[]; edges: Edge[] } {
  const pathIds = new Set(
    focusId ? getCurrentPath(questions, focusId).map((node) => node.id) : [],
  );
  const byDepth = new Map<number, QuestionNode[]>();
  for (const question of questions) {
    const depth = getCurrentPath(questions, question.id).length - 1;
    const level = byDepth.get(depth) ?? [];
    level.push(question);
    byDepth.set(depth, level);
  }

  const nodes: Node<QuestionNodeData>[] = [];
  for (const [depth, level] of byDepth) {
    level.sort((a, b) => a.createdAt - b.createdAt);
    level.forEach((question, index) => {
      const colors = STATUS_COLORS[question.status];
      const onCurrentPath = pathIds.has(question.id);
      nodes.push({
        id: question.id,
        position: { x: depth * 270, y: index * 118 },
        data: { label: question.question, node: question, onCurrentPath },
        style: {
          width: 220,
          border: `2px solid ${onCurrentPath ? "#2563eb" : colors.border}`,
          background: colors.background,
          borderRadius: 14,
          color: "#172033",
          fontSize: 13,
          fontWeight: question.id === focusId ? 750 : 600,
          opacity: 1,
          boxShadow: question.id === focusId ? "0 8px 24px rgba(37, 99, 235, .18)" : "none",
        },
      });
    });
  }

  const edges: Edge[] = questions
    .filter((question): question is QuestionNode & { parentId: string } => Boolean(question.parentId))
    .map((question) => ({
      id: `${question.parentId}-${question.id}`,
      source: question.parentId,
      target: question.id,
      type: "smoothstep",
      animated: pathIds.has(question.parentId) && pathIds.has(question.id),
      style: {
        stroke: pathIds.has(question.parentId) && pathIds.has(question.id) ? "#2563eb" : "#cbd5e1",
        strokeWidth: pathIds.has(question.parentId) && pathIds.has(question.id) ? 2.4 : 1.5,
      },
    }));

  return { nodes, edges };
}
