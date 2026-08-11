// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentParentPanel } from "../components/CurrentParentPanel";
import type { QuestionNode } from "../types/domain";

function node(
  id: string,
  question: string,
  summary: string,
  parentId: string | null,
): QuestionNode {
  return {
    id,
    projectId: "project-1",
    parentId,
    question,
    summary,
    status: "pending",
    chatId: "chat-1",
    messageId: `message-${id}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("CurrentParentPanel", () => {
  afterEach(cleanup);

  it("shows both summaries by default and lets each one collapse", async () => {
    const parent = node("parent", "Parent question", "Parent summary", null);
    const current = node("current", "Current question", "Current summary", parent.id);

    render(
      <CurrentParentPanel
        current={current}
        parent={parent}
        onEdit={vi.fn()}
        onLocate={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );

    expect(screen.getByText("Current summary")).toBeDefined();
    expect(screen.getByText("Parent summary")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "CURRENT SUMMARY" }));
    await userEvent.click(screen.getByRole("button", { name: "PARENT SUMMARY" }));
    expect(screen.queryByText("Current summary")).toBeNull();
    expect(screen.queryByText("Parent summary")).toBeNull();
  });

  it("reopens summaries when the current node changes", async () => {
    const parent = node("parent", "Parent question", "Parent summary", null);
    const first = node("first", "First question", "First summary", parent.id);
    const second = node("second", "Second question", "Second summary", parent.id);
    const { rerender } = render(
      <CurrentParentPanel
        current={first}
        parent={parent}
        onEdit={vi.fn()}
        onLocate={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "CURRENT SUMMARY" }));
    await userEvent.click(screen.getByRole("button", { name: "PARENT SUMMARY" }));

    rerender(
      <CurrentParentPanel
        current={second}
        parent={parent}
        onEdit={vi.fn()}
        onLocate={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );

    expect(await screen.findByText("Second summary")).toBeDefined();
    expect(screen.getByText("Parent summary")).toBeDefined();
  });

  it("shows the root state and preserves current-node actions", async () => {
    const onEdit = vi.fn();
    const onLocate = vi.fn();
    const onSetStatus = vi.fn();
    render(
      <CurrentParentPanel
        current={node("root", "Root question", "Root summary", null)}
        onEdit={onEdit}
        onLocate={onLocate}
        onSetStatus={onSetStatus}
      />,
    );

    expect(screen.getByText("无父节点 / 当前为根节点")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "编辑节点" }));
    await userEvent.click(screen.getByRole("button", { name: "原始消息" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "修改问题状态" }), "resolved");
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onLocate).toHaveBeenCalledOnce();
    expect(onSetStatus).toHaveBeenCalledWith("resolved");
  });
});
