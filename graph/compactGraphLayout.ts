import type { FloatingPanelGraphNode } from "../shared/messages";
import { layoutForest } from "./treeLayout";

const HORIZONTAL_GAP = 68;
const VERTICAL_GAP = 44;
const FOREST_GAP = 22;
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
  const positions = layoutForest(nodes, {
    horizontalGap: HORIZONTAL_GAP,
    verticalGap: VERTICAL_GAP,
    forestGap: FOREST_GAP,
  });
  const rawPositions = [...positions.values()];
  const maximumX = Math.max(...rawPositions.map(({ x }) => x));
  const minimumY = Math.min(...rawPositions.map(({ y }) => y));
  const maximumY = Math.max(...rawPositions.map(({ y }) => y));
  const rawHeight = maximumY - minimumY;
  const width = Math.max(MIN_WIDTH, maximumX + PADDING * 2);
  const height = Math.max(MIN_HEIGHT, rawHeight + PADDING * 2);
  const offsetX = (width - maximumX) / 2;
  const offsetY = (height - rawHeight) / 2 - minimumY;
  const positionedNodes = nodes.map<CompactGraphPositionedNode>((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      x: position.x + offsetX,
      y: position.y + offsetY,
    };
  });

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
