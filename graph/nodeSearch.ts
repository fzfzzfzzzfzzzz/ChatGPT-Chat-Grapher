import type { QuestionNode } from "../types/domain";

export type NodeSearchResult = {
  node: QuestionNode;
  field: "question" | "summary";
};

export function normalizeNodeSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function searchProjectNodes(
  nodes: QuestionNode[],
  rawQuery: string,
): NodeSearchResult[] {
  const query = normalizeNodeSearchText(rawQuery);
  if (!query) return [];
  return nodes
    .map<NodeSearchResult | undefined>((node) => {
      if (normalizeNodeSearchText(node.question).includes(query)) {
        return { node, field: "question" };
      }
      if (normalizeNodeSearchText(node.summary).includes(query)) {
        return { node, field: "summary" };
      }
      return undefined;
    })
    .filter((result): result is NodeSearchResult => Boolean(result))
    .sort((left, right) => {
      if (left.field !== right.field) return left.field === "question" ? -1 : 1;
      return right.node.updatedAt - left.node.updatedAt;
    });
}
