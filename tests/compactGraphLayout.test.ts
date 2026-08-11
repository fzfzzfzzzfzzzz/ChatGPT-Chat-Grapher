import { describe, expect, it } from "vitest";
import { layoutCompactGraph } from "../graph/compactGraphLayout";
import type { FloatingPanelGraphNode } from "../shared/messages";

function graphNode(
  id: string,
  parentId: string | null = null,
): FloatingPanelGraphNode {
  return {
    id,
    parentId,
    question: `Question ${id}`,
    status: "active",
  };
}

describe("compact floating-panel graph layout", () => {
  it("places descendants to the right and separates siblings", () => {
    const layout = layoutCompactGraph([
      graphNode("root"),
      graphNode("child-a", "root"),
      graphNode("child-b", "root"),
      graphNode("grandchild", "child-a"),
    ]);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(byId.get("child-a")!.x).toBeGreaterThan(byId.get("root")!.x);
    expect(byId.get("grandchild")!.x).toBeGreaterThan(byId.get("child-a")!.x);
    expect(byId.get("child-a")!.y).not.toBe(byId.get("child-b")!.y);
    expect(layout.edges).toHaveLength(3);
  });

  it("keeps every node inside the generated view box", () => {
    const layout = layoutCompactGraph([
      graphNode("orphan", "missing"),
      graphNode("self", "self"),
    ]);

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(layout.width);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(layout.height);
    }
    expect(layout.edges).toEqual([]);
  });
});
