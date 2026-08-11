export type TreeLayoutNode = {
  id: string;
  parentId: string | null;
};

export type TreeLayoutOptions = {
  horizontalGap: number;
  verticalGap: number;
  forestGap: number;
};

export function layoutForest(
  nodes: readonly TreeLayoutNode[],
  options: TreeLayoutOptions,
): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, TreeLayoutNode[]>();

  for (const node of nodes) {
    if (!node.parentId || node.parentId === node.id || !byId.has(node.parentId)) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const roots = nodes.filter((node) => (
    !node.parentId || node.parentId === node.id || !byId.has(node.parentId)
  ));
  const positions = new Map<string, { x: number; y: number }>();
  const positioned = new Set<string>();
  let nextLeafY = 0;

  function placeSubtree(node: TreeLayoutNode, depth: number, ancestors: Set<string>): number {
    const existing = positions.get(node.id);
    if (existing) return existing.y;

    const nextAncestors = new Set(ancestors).add(node.id);
    const childYs = (childrenByParent.get(node.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id) && !positioned.has(child.id))
      .map((child) => placeSubtree(child, depth + 1, nextAncestors));
    const y = childYs.length
      ? (childYs[0]! + childYs.at(-1)!) / 2
      : nextLeafY;

    positions.set(node.id, { x: depth * options.horizontalGap, y });
    positioned.add(node.id);
    if (childYs.length === 0) nextLeafY += options.verticalGap;
    return y;
  }

  function placeRoot(root: TreeLayoutNode) {
    if (positioned.has(root.id)) return;
    if (positions.size > 0) nextLeafY += options.forestGap;
    placeSubtree(root, 0, new Set());
  }

  roots.forEach(placeRoot);
  nodes.filter((node) => !positioned.has(node.id)).forEach(placeRoot);
  return positions;
}
