import type { QuestionNode } from "../types/domain";

export function getCurrentPath(nodes: QuestionNode[], nodeId: string): QuestionNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: QuestionNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(nodeId);

  while (current) {
    if (visited.has(current.id)) throw new Error("Question hierarchy contains a cycle.");
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function isDescendant(
  nodes: QuestionNode[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  let current = byId.get(candidateId);
  while (current?.parentId) {
    if (visited.has(current.id)) throw new Error("Question hierarchy contains a cycle.");
    visited.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

export function getValidParentNodes(
  nodes: QuestionNode[],
  nodeId: string,
): QuestionNode[] {
  return getParentSelectionCandidates(nodes, nodeId).nodes;
}

export type ParentSelectionCandidates = {
  nodes: QuestionNode[];
  latestConversationNodeId?: string;
};

export function getParentSelectionCandidates(
  nodes: QuestionNode[],
  nodeId: string,
): ParentSelectionCandidates {
  const currentNode = nodes.find((node) => node.id === nodeId);
  const validNodes = nodes
    .filter(
      (candidate) =>
        candidate.id !== nodeId &&
        !isDescendant(nodes, candidate.id, nodeId),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (!currentNode) return { nodes: validNodes };
  const latestConversationNode = validNodes.reduce<QuestionNode | undefined>(
    (latest, candidate) => {
      if (
        candidate.chatId !== currentNode.chatId ||
        candidate.createdAt >= currentNode.createdAt
      ) return latest;
      return !latest || candidate.createdAt > latest.createdAt
        ? candidate
        : latest;
    },
    undefined,
  );
  if (!latestConversationNode) return { nodes: validNodes };

  return {
    nodes: [
      latestConversationNode,
      ...validNodes.filter((candidate) => candidate.id !== latestConversationNode.id),
    ],
    latestConversationNodeId: latestConversationNode.id,
  };
}

export function getOpenBranches(nodes: QuestionNode[], focusId: string): QuestionNode[] {
  const focus = nodes.find((node) => node.id === focusId);
  if (!focus) return [];
  return nodes
    .filter(
      (node) =>
        node.id !== focus.id &&
        node.status === "pending" &&
        (node.parentId === focus.parentId || node.parentId === focus.id),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}
