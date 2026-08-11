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

export function getOpenBranches(nodes: QuestionNode[], focusId: string): QuestionNode[] {
  const focus = nodes.find((node) => node.id === focusId);
  if (!focus) return [];
  return nodes
    .filter(
      (node) =>
        node.id !== focus.id &&
        (node.status === "pending" || node.status === "parked") &&
        (node.parentId === focus.parentId || node.parentId === focus.id),
    )
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
}
