import type { QuestionNode } from "../types/domain";

export function canBeParentNode(
  node: Pick<QuestionNode, "status">,
): boolean {
  return node.status !== "resolved";
}
