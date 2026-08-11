import { Position, type Edge, type Node } from "@xyflow/react";
import type { QuestionNode } from "../types/domain";
import { getCurrentPath } from "./questionTree";
import { layoutForest } from "./treeLayout";

export type QuestionNodeData = { label: string; node: QuestionNode; onCurrentPath: boolean };

const STATUS_COLORS: Record<QuestionNode["status"], { background: string; border: string }> = {
  pending: { background: "#ffffff", border: "#94a3b8" },
  resolved: { background: "#f0fdf4", border: "#22c55e" },
};

const HORIZONTAL_GAP = 270;
const VERTICAL_GAP = 156;
const FOREST_GAP = 64;

export function questionsToFlow(
  questions: QuestionNode[],
  focusId?: string,
): { nodes: Node<QuestionNodeData>[]; edges: Edge[] } {
  const pathIds = new Set(
    focusId ? getCurrentPath(questions, focusId).map((node) => node.id) : [],
  );
  const positions = layoutForest(
    [...questions].sort((a, b) => a.createdAt - b.createdAt),
    {
      horizontalGap: HORIZONTAL_GAP,
      verticalGap: VERTICAL_GAP,
      forestGap: FOREST_GAP,
    },
  );

  const nodes: Node<QuestionNodeData>[] = questions.map((question) => {
    const colors = STATUS_COLORS[question.status];
    const onCurrentPath = pathIds.has(question.id);
    return {
      id: question.id,
      position: positions.get(question.id) ?? { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
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
    };
  });

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
