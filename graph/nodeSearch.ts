import type { QuestionNode } from "../types/domain";

export type NodeSearchResult = {
  node: QuestionNode;
  field: "question" | "summary" | "reference";
  referenceText?: string;
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
      const referenceText = node.references
        ?.map((reference) => reference.type === "file"
          ? reference.name
          : reference.type === "image"
            ? [reference.name, reference.alt].filter(Boolean).join(" ")
            : reference.excerpt)
        .find((value) => normalizeNodeSearchText(value).includes(query));
      if (referenceText) return { node, field: "reference", referenceText };
      return undefined;
    })
    .filter((result): result is NodeSearchResult => Boolean(result))
    .sort((left, right) => {
      if (left.field !== right.field) {
        const rank = { question: 0, summary: 1, reference: 2 } as const;
        return rank[left.field] - rank[right.field];
      }
      return right.node.updatedAt - left.node.updatedAt;
    });
}
