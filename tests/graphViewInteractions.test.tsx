// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionNode } from "../types/domain";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    Controls: () => null,
    MiniMap: () => null,
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

function node(id: string, question: string): QuestionNode {
  return {
    id,
    projectId: "project-1",
    parentId: null,
    question,
    summary: `${question} summary`,
    status: "pending",
    chatId: "chat-1",
    messageId: `message-${id}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("GraphView interactions", () => {
  afterEach(cleanup);

  it("offers parent editing from the node context menu", async () => {
    const question = node("node-1", "Question one");
    const onChangeParent = vi.fn();
    render(
      <GraphView
        questions={[question]}
        displayMode="questions"
        onDisplayModeChange={vi.fn()}
        onMakeCurrent={vi.fn()}
        onViewDetails={vi.fn()}
        onChangeParent={onChangeParent}
        onRequestLocate={vi.fn()}
        onRequestDelete={vi.fn()}
        onSetStatus={vi.fn(async () => true)}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Question one" }));
    const menu = screen.getByRole("menu", { name: "节点操作：Question one" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]?.textContent).toContain("查看总结与详情");
    expect(items[1]?.textContent).toContain("更换父节点");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "更换父节点" }));

    expect(onChangeParent).toHaveBeenCalledWith(question);
    expect(screen.queryByRole("menu", { name: "节点操作：Question one" })).toBeNull();
  });

  it("renders compact nodes with hover details and switches display modes", async () => {
    const question = node("node-1", "A complete question shown on hover");
    const onDisplayModeChange = vi.fn();
    const onMakeCurrent = vi.fn();
    render(
      <GraphView
        questions={[question]}
        displayMode="nodes"
        onDisplayModeChange={onDisplayModeChange}
        onMakeCurrent={onMakeCurrent}
        onViewDetails={vi.fn()}
        onChangeParent={vi.fn()}
        onRequestLocate={vi.fn()}
        onRequestDelete={vi.fn()}
        onSetStatus={vi.fn(async () => true)}
      />,
    );

    const compactNode = screen.getByRole("button", { name: question.question });
    expect(compactNode.textContent).toBe("");
    expect(compactNode.className).toContain("graph-flow-node--compact");

    fireEvent.mouseEnter(compactNode);
    expect(screen.getByRole("tooltip").textContent).toBe(question.question);
    await userEvent.click(compactNode);
    expect(onMakeCurrent).toHaveBeenCalledWith(question);

    await userEvent.click(screen.getByRole("button", { name: "详情问题视角" }));
    expect(onDisplayModeChange).toHaveBeenCalledWith("questions");
  });

  it("shows complete question text directly in question detail mode", () => {
    const question = node("node-1", "Question visible inside its node");
    render(
      <GraphView
        questions={[question]}
        displayMode="questions"
        onDisplayModeChange={vi.fn()}
        onMakeCurrent={vi.fn()}
        onViewDetails={vi.fn()}
        onChangeParent={vi.fn()}
        onRequestLocate={vi.fn()}
        onRequestDelete={vi.fn()}
        onSetStatus={vi.fn(async () => true)}
      />,
    );

    const questionNode = screen.getByRole("button", { name: question.question });
    expect(questionNode.textContent).toBe(question.question);
    expect(questionNode.className).toContain("graph-flow-node--question");
  });

  it("keeps collapsed state and project focus unchanged while switching views", async () => {
    const root = node("root", "Root question");
    const child = { ...node("child", "Child question"), parentId: root.id };
    const onMakeCurrent = vi.fn();

    function Harness() {
      const [displayMode, setDisplayMode] = useState<"nodes" | "questions">("nodes");
      return (
        <GraphView
          questions={[root, child]}
          focusId={root.id}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          onMakeCurrent={onMakeCurrent}
          onViewDetails={vi.fn()}
          onChangeParent={vi.fn()}
          onRequestLocate={vi.fn()}
          onRequestDelete={vi.fn()}
          onSetStatus={vi.fn(async () => true)}
        />
      );
    }

    render(<Harness />);
    fireEvent.doubleClick(screen.getByRole("button", { name: root.question }));
    expect(screen.queryByRole("button", { name: child.question })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "详情问题视角" }));
    expect(screen.queryByRole("button", { name: child.question })).toBeNull();
    expect(onMakeCurrent).not.toHaveBeenCalled();
  });
});
