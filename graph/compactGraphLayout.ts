import type { FloatingPanelGraphNode } from "../shared/messages";

const HORIZONTAL_GAP = 68;
const VERTICAL_GAP = 44;
const PADDING = 24;
const MIN_WIDTH = 292;
const MIN_HEIGHT = 220;

export type CompactGraphPositionedNode = FloatingPanelGraphNode & {
  x: number;
  y: number;
};

export type CompactGraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

export type CompactGraphLayout = {
  width: number;
  height: number;
  nodes: CompactGraphPositionedNode[];
  edges: CompactGraphEdge[];
};

export function layoutCompactGraph(nodes: FloatingPanelGraphNode[]): CompactGraphLayout {
  if (nodes.length === 0) {
    return { width: MIN_WIDTH, height: MIN_HEIGHT, nodes: [], edges: [] };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = nodes.map((node) => depthFor(node, byId));
  const minimumDepth = Math.min(...depths);
  const normalizedDepths = depths.map((depth) => depth - minimumDepth);
  const maximumDepth = Math.max(...normalizedDepths);
  const levels = new Map<number, FloatingPanelGraphNode[]>();

  nodes.forEach((node, index) => {
    const depth = normalizedDepths[index] ?? 0;
    const level = levels.get(depth) ?? [];
    level.push(node);
    levels.set(depth, level);
  });

  const widestLevel = Math.max(...Array.from(levels.values(), (level) => level.length));
  const width = Math.max(MIN_WIDTH, maximumDepth * HORIZONTAL_GAP + PADDING * 2);
  const height = Math.max(MIN_HEIGHT, (widestLevel - 1) * VERTICAL_GAP + PADDING * 2);
  const positionedNodes: CompactGraphPositionedNode[] = [];

  for (const [depth, level] of levels) {
    level.forEach((node, index) => {
      const x = maximumDepth === 0
        ? width / 2
        : PADDING + depth * ((width - PADDING * 2) / maximumDepth);
      const y = level.length === 1
        ? height / 2
        : PADDING + index * ((height - PADDING * 2) / (level.length - 1));
      positionedNodes.push({ ...node, x, y });
    });
  }

  const edges = nodes.flatMap<CompactGraphEdge>((node) => {
    if (!node.parentId || node.parentId === node.id || !byId.has(node.parentId)) return [];
    return [{
      id: `${node.parentId}-${node.id}`,
      sourceId: node.parentId,
      targetId: node.id,
    }];
  });

  return { width, height, nodes: positionedNodes, edges };
}

function depthFor(
  node: FloatingPanelGraphNode,
  byId: Map<string, FloatingPanelGraphNode>,
): number {
  let depth = 0;
  let current = node;
  const visited = new Set([node.id]);

  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    depth += 1;
    current = parent;
  }

  return depth;
}
