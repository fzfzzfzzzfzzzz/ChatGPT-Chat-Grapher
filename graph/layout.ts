import { Position, type Edge, type Node } from "@xyflow/react";
import type { GraphDisplayMode } from "../shared/graphDisplayMode";
import type { QuestionNode } from "../types/domain";
import { getCurrentPath } from "./questionTree";
import {
  reviewArtifactFlowNodeId,
  type ReviewGraphArtifact,
} from "./reviewArtifacts";
import { layoutForest } from "./treeLayout";

export type QuestionNodeData = {
  kind: "question";
  label: string;
  node: QuestionNode;
  onCurrentPath: boolean;
  onViewReferences?: () => void;
};

export type ReviewArtifactNodeData = {
  kind: "review";
  label: string;
  review: ReviewGraphArtifact;
  compact: boolean;
};

export type GraphFlowNodeData = QuestionNodeData | ReviewArtifactNodeData;

const STATUS_COLORS: Record<QuestionNode["status"], { background: string; border: string }> = {
  pending: { background: "#ffffff", border: "#94a3b8" },
  resolved: { background: "#f0fdf4", border: "#22c55e" },
};

const QUESTION_GAPS = {
  horizontalGap: 270,
  verticalGap: 156,
  forestGap: 64,
};
const NODE_GAPS = {
  horizontalGap: 68,
  verticalGap: 44,
  forestGap: 22,
};

export function questionsToFlow(
  questions: QuestionNode[],
  focusId?: string,
  displayMode: GraphDisplayMode = "questions",
): { nodes: Node<QuestionNodeData>[]; edges: Edge[] } {
  const pathIds = new Set(
    focusId ? getCurrentPath(questions, focusId).map((node) => node.id) : [],
  );
  const positions = layoutForest(
    [...questions].sort((a, b) => a.createdAt - b.createdAt),
    displayMode === "nodes" ? NODE_GAPS : QUESTION_GAPS,
  );

  const nodes: Node<QuestionNodeData>[] = questions.map((question) => {
    const colors = STATUS_COLORS[question.status];
    const onCurrentPath = pathIds.has(question.id);
    const compact = displayMode === "nodes";
    return {
      id: question.id,
      position: positions.get(question.id) ?? { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        kind: "question",
        label: compact ? "" : question.question,
        node: question,
        onCurrentPath,
      },
      ariaLabel: question.question,
      className: compact ? "graph-flow-node--compact" : "graph-flow-node--question",
      style: {
        width: compact ? (question.id === focusId ? 18 : 16) : 220,
        height: compact ? (question.id === focusId ? 18 : 16) : undefined,
        padding: compact ? 0 : 10,
        border: compact
          ? `2px solid ${colors.border}`
          : `2px solid ${onCurrentPath ? "#2563eb" : colors.border}`,
        background: compact ? colors.border : colors.background,
        borderRadius: compact ? "50%" : 14,
        color: "#172033",
        fontSize: compact ? 0 : 13,
        fontWeight: question.id === focusId ? 750 : 600,
        opacity: 1,
        boxShadow: question.id === focusId
          ? compact
            ? "0 0 0 4px rgba(37, 99, 235, .2), 0 4px 12px rgba(37, 99, 235, .24)"
            : "0 8px 24px rgba(37, 99, 235, .18)"
          : "none",
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

export function projectGraphToFlow(
  questions: QuestionNode[],
  reviews: readonly ReviewGraphArtifact[],
  focusId?: string,
  displayMode: GraphDisplayMode = "questions",
): { nodes: Node<GraphFlowNodeData>[]; edges: Edge[] } {
  const pathIds = new Set(
    focusId ? getCurrentPath(questions, focusId).map((node) => node.id) : [],
  );
  const compact = displayMode === "nodes";
  const sortedQuestions = [...questions].sort((a, b) => a.createdAt - b.createdAt);
  const sortedReviews = [...reviews].sort(
    (left, right) => left.savedAt - right.savedAt || left.id.localeCompare(right.id),
  );
  const positions = layoutForest(
    [
      ...sortedQuestions,
      ...sortedReviews.map((review) => ({
        id: reviewArtifactFlowNodeId(review.id),
        parentId: review.graphAnchorNodeId,
      })),
    ],
    compact ? NODE_GAPS : QUESTION_GAPS,
  );

  const questionNodes: Node<QuestionNodeData>[] = questions.map((question) => {
    const colors = STATUS_COLORS[question.status];
    const planned = question.kind === "planned";
    const onCurrentPath = pathIds.has(question.id);
    return {
      id: question.id,
      position: positions.get(question.id) ?? { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        kind: "question",
        label: compact ? "" : question.question,
        node: question,
        onCurrentPath,
      },
      ariaLabel: planned ? `计划问题：${question.question}` : question.question,
      className: `${compact ? "graph-flow-node--compact" : "graph-flow-node--question"}${planned ? " graph-flow-node--planned" : ""}`,
      style: {
        width: compact ? (question.id === focusId ? 18 : 16) : 220,
        height: compact ? (question.id === focusId ? 18 : 16) : undefined,
        padding: compact ? 0 : 10,
        border: planned
          ? `2px dashed ${onCurrentPath ? "#2563eb" : "#d97706"}`
          : compact
            ? `2px solid ${colors.border}`
            : `2px solid ${onCurrentPath ? "#2563eb" : colors.border}`,
        background: planned ? (compact ? "#f59e0b" : "#fffbeb") : compact ? colors.border : colors.background,
        borderRadius: compact ? (planned ? 4 : "50%") : 14,
        color: "#172033",
        fontSize: compact ? 0 : 13,
        fontWeight: question.id === focusId ? 750 : 600,
        opacity: 1,
        boxShadow: question.id === focusId
          ? compact
            ? "0 0 0 4px rgba(37, 99, 235, .2), 0 4px 12px rgba(37, 99, 235, .24)"
            : "0 8px 24px rgba(37, 99, 235, .18)"
          : "none",
      },
    };
  });

  const reviewNodes: Node<ReviewArtifactNodeData>[] = sortedReviews.map((review) => {
    const id = reviewArtifactFlowNodeId(review.id);
    return {
      id,
      type: "reviewArtifact",
      position: positions.get(id) ?? { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        kind: "review",
        label: compact ? "" : review.version.title,
        review,
        compact,
      },
      ariaLabel: `总结：${review.version.title}`,
      className: compact
        ? "graph-flow-node--review graph-flow-node--review-compact"
        : "graph-flow-node--review",
      style: {
        width: compact ? 20 : 220,
        height: compact ? 24 : undefined,
        padding: compact ? 0 : 10,
        border: "2px solid #7c3aed",
        background: compact ? "#8b5cf6" : "#f5f3ff",
        borderRadius: compact ? 5 : 10,
        color: compact ? "#ffffff" : "#4c1d95",
        fontSize: compact ? 0 : 13,
        fontWeight: 700,
        opacity: 1,
        boxShadow: "0 5px 14px rgba(124, 58, 237, .16)",
      },
    };
  });

  const questionEdges: Edge[] = questions
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
  const questionIds = new Set(questions.map((question) => question.id));
  const reviewEdges: Edge[] = sortedReviews
    .filter((review) => questionIds.has(review.graphAnchorNodeId))
    .map((review) => ({
      id: `review-source:${review.graphAnchorNodeId}:${review.id}`,
      source: review.graphAnchorNodeId,
      target: reviewArtifactFlowNodeId(review.id),
      type: "smoothstep",
      animated: false,
      style: {
        stroke: "#8b5cf6",
        strokeWidth: 1.8,
        strokeDasharray: "6 4",
      },
    }));

  return {
    nodes: [...questionNodes, ...reviewNodes],
    edges: [...questionEdges, ...reviewEdges],
  };
}
