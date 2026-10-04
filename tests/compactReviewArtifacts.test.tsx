// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactProjectGraph } from "../entrypoints/chatgpt.content/CompactProjectGraph";
import type {
  FloatingPanelGraphNode,
  FloatingPanelReviewArtifact,
} from "../shared/messages";

const nodes: FloatingPanelGraphNode[] = [{
  id: "root",
  parentId: null,
  question: "Root question",
  status: "pending",
}];

const artifact: FloatingPanelReviewArtifact = {
  id: "review-artifact:review-1",
  title: "Saved branch review",
  anchorNodeId: "root",
  documentId: "review-1",
  versionId: "version-1",
  savedAt: 10,
};

describe("CompactProjectGraph review artifacts", () => {
  afterEach(cleanup);

  it("renders a purple document with a dashed relation without selecting a question", async () => {
    const onOpenReviewArtifact = vi.fn();
    const onSelectNode = vi.fn();
    const onRequestLocateNode = vi.fn();
    const { container } = renderGraph({
      onOpenReviewArtifact,
      onSelectNode,
      onRequestLocateNode,
    });

    const reviewNode = screen.getByRole("button", { name: "总结：Saved branch review" });
    expect(reviewNode.querySelector("rect")?.getAttribute("style")).toContain("fill: #8b5cf6");
    expect(container.querySelector('[data-review-edge="review-1"]')?.getAttribute("style"))
      .toContain("stroke-dasharray: 6 4");

    await userEvent.click(reviewNode);
    expect(onOpenReviewArtifact).toHaveBeenCalledWith(artifact);
    expect(onSelectNode).not.toHaveBeenCalled();
    expect(onRequestLocateNode).not.toHaveBeenCalled();
  });

  it("opens and deletes a saved review from its context menu", async () => {
    const onOpenReviewArtifact = vi.fn();
    const onDeleteReviewArtifact = vi.fn(async () => true);
    renderGraph({ onOpenReviewArtifact, onDeleteReviewArtifact });

    const reviewNode = screen.getByRole("button", { name: "总结：Saved branch review" });
    fireEvent.contextMenu(reviewNode, { clientX: 80, clientY: 60 });
    await userEvent.click(screen.getByRole("menuitem", { name: "打开总结" }));
    expect(onOpenReviewArtifact).toHaveBeenCalledWith(artifact);

    fireEvent.contextMenu(reviewNode, { clientX: 80, clientY: 60 });
    await userEvent.click(screen.getByRole("menuitem", { name: "删除总结" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(onDeleteReviewArtifact).toHaveBeenCalledWith("review-1"));
  });

  it("renders planned-question semantics and never locates it on a second activation", async () => {
    const onSelectNode = vi.fn();
    const onRequestLocateNode = vi.fn();
    const props = graphProps({
      nodes: [{
        id: "planned-1",
        parentId: null,
        question: "Verify the rollout plan",
        status: "pending",
        kind: "planned",
      }],
      reviewArtifacts: [],
      onSelectNode,
      onRequestLocateNode,
    });
    const { rerender } = render(<CompactProjectGraph {...props} />);

    let plannedNode = screen.getByRole("button", {
      name: "计划问题：Verify the rollout plan",
    });
    expect(plannedNode.classList.contains("is-planned")).toBe(true);
    expect(plannedNode.querySelector(".chat-graph-map-node__dot")?.tagName.toLowerCase())
      .toBe("rect");

    await userEvent.click(plannedNode);
    expect(onSelectNode).toHaveBeenCalledTimes(1);

    rerender(<CompactProjectGraph {...props} selectedNodeId="planned-1" />);
    plannedNode = screen.getByRole("button", {
      name: "计划问题：Verify the rollout plan",
    });
    await userEvent.click(plannedNode);
    expect(onRequestLocateNode).not.toHaveBeenCalled();
    expect(onSelectNode).toHaveBeenCalledTimes(1);
  });
});

function renderGraph(overrides: Partial<Parameters<typeof CompactProjectGraph>[0]> = {}) {
  return render(<CompactProjectGraph {...graphProps(overrides)} />);
}

function graphProps(
  overrides: Partial<Parameters<typeof CompactProjectGraph>[0]> = {},
): Parameters<typeof CompactProjectGraph>[0] {
  return {
    nodes,
    reviewArtifacts: [artifact],
    onSelectNode: vi.fn(),
    onViewNodeDetails: vi.fn(),
    onChangeNodeParent: vi.fn(),
    onSetNodeStatus: vi.fn(async () => true),
    onDeleteNode: vi.fn(async () => true),
    onRequestLocateNode: vi.fn(),
    onOpenReviewArtifact: vi.fn(),
    onDeleteReviewArtifact: vi.fn(async () => true),
    onOpenFullGraph: vi.fn(),
    ...overrides,
  };
}
