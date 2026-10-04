// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionNode, ReviewDocument, ReviewVersion } from "../types/domain";
import type { ReviewGraphArtifact } from "../graph/reviewArtifacts";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    Controls: () => null,
    Handle: () => null,
    MiniMap: ({ nodeColor }: { nodeColor: (node: unknown) => string }) => React.createElement(
      "output",
      { "data-testid": "review-minimap-color" },
      nodeColor({ data: { kind: "review" } }),
    ),
    Position: { Left: "left", Right: "right" },
    ReactFlow: ({
      nodes,
      onNodeClick,
      onNodeDoubleClick,
      onNodeMouseEnter,
      onNodeMouseLeave,
      onNodeContextMenu,
      children,
    }: {
      nodes: Array<{
        id: string;
        ariaLabel?: string;
        className?: string;
        data: { label: string };
      }>;
      onNodeClick?: (event: React.MouseEvent, node: unknown) => void;
      onNodeDoubleClick?: (event: React.MouseEvent, node: unknown) => void;
      onNodeMouseEnter?: (event: React.MouseEvent, node: unknown) => void;
      onNodeMouseLeave?: (event: React.MouseEvent, node: unknown) => void;
      onNodeContextMenu?: (event: React.MouseEvent, node: unknown) => void;
      children?: React.ReactNode;
    }) => React.createElement(
      "div",
      null,
      nodes.map((node) => React.createElement(
        "button",
        {
          key: node.id,
          type: "button",
          className: `react-flow__node ${node.className ?? ""}`,
          "data-id": node.id,
          "aria-label": node.ariaLabel,
          onClick: (event: React.MouseEvent) => onNodeClick?.(event, node),
          onDoubleClick: (event: React.MouseEvent) => onNodeDoubleClick?.(event, node),
          onMouseEnter: (event: React.MouseEvent) => onNodeMouseEnter?.(event, node),
          onMouseLeave: (event: React.MouseEvent) => onNodeMouseLeave?.(event, node),
          onContextMenu: (event: React.MouseEvent) => onNodeContextMenu?.(event, node),
        },
        node.data.label,
      )),
      children,
    ),
  };
});

import { GraphView } from "../components/GraphView";

describe("GraphView review artifacts", () => {
  afterEach(cleanup);

  it("opens a review on click without invoking any question-node action", async () => {
    const review = artifact();
    const callbacks = callbackSpies();

    renderGraph(review, callbacks);
    await userEvent.click(screen.getByRole("button", { name: "总结：Saved branch review" }));

    expect(callbacks.onOpenReview).toHaveBeenCalledWith(review);
    expect(callbacks.onMakeCurrent).not.toHaveBeenCalled();
    expect(callbacks.onViewDetails).not.toHaveBeenCalled();
    expect(callbacks.onChangeParent).not.toHaveBeenCalled();
    expect(callbacks.onRequestLocate).not.toHaveBeenCalled();
    expect(callbacks.onSetStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId("review-minimap-color").textContent).toBe("#8b5cf6");
  });

  it("offers only open and delete actions from a review context menu", async () => {
    const review = artifact();
    const callbacks = callbackSpies();

    renderGraph(review, callbacks);
    fireEvent.contextMenu(screen.getByRole("button", { name: "总结：Saved branch review" }));

    const menu = screen.getByRole("menu", { name: "总结操作：Saved branch review" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "打开总结",
      "删除总结",
    ]);
    expect(within(menu).queryByText("标记状态")).toBeNull();
    expect(within(menu).queryByText("更换父节点")).toBeNull();

    await userEvent.click(within(menu).getByRole("menuitem", { name: "删除总结" }));
    expect(callbacks.onDeleteReview).toHaveBeenCalledWith(review);
    expect(callbacks.onMakeCurrent).not.toHaveBeenCalled();
    expect(callbacks.onRequestDelete).not.toHaveBeenCalled();
  });
});

function renderGraph(review: ReviewGraphArtifact, callbacks: ReturnType<typeof callbackSpies>) {
  return render(
    <GraphView
      questions={[question()]}
      reviews={[review]}
      displayMode="questions"
      onDisplayModeChange={vi.fn()}
      {...callbacks}
    />,
  );
}

function callbackSpies() {
  return {
    onMakeCurrent: vi.fn(),
    onViewDetails: vi.fn(),
    onChangeParent: vi.fn(),
    onRequestLocate: vi.fn(),
    onRequestDelete: vi.fn(),
    onSetStatus: vi.fn(async () => true),
    onOpenReview: vi.fn(),
    onDeleteReview: vi.fn(),
  };
}

function artifact(): ReviewGraphArtifact {
  const activeVersion = version();
  const reviewDocument: ReviewDocument = {
    id: "review-1",
    projectId: "project-1",
    chatId: "chat-1",
    scopeFamilyKey: "scope-1",
    entrySource: "side_panel",
    activeVersionId: activeVersion.id,
    graphAnchorNodeId: "node-1",
    savedAt: 10,
    createdAt: 1,
    updatedAt: 10,
  };
  return {
    kind: "review",
    id: reviewDocument.id,
    graphAnchorNodeId: "node-1",
    savedAt: 10,
    document: reviewDocument,
    version: activeVersion,
  };
}

function version(): ReviewVersion {
  return {
    id: "version-1",
    documentId: "review-1",
    projectId: "project-1",
    version: 1,
    title: "Saved branch review",
    scope: {
      type: "current_branch",
      chatId: "chat-1",
      nodeIds: ["node-1"],
      messageSourceIds: [],
      messageCount: 0,
      nodeCount: 1,
      includesOtherBranches: false,
      completeness: "complete",
      missingSourceIds: [],
      estimatedTokens: 0,
      sourceSnapshotHash: "hash",
    },
    moduleOrder: [],
    modules: [],
    evidences: [],
    segmented: false,
    segmentCount: 1,
    missingRanges: [],
    generatedAt: 1,
    updatedAt: 1,
  };
}

function question(): QuestionNode {
  return {
    id: "node-1",
    projectId: "project-1",
    parentId: null,
    question: "Question one",
    summary: "Question summary",
    status: "pending",
    chatId: "chat-1",
    messageId: "message-1",
    createdAt: 1,
    updatedAt: 1,
  };
}
