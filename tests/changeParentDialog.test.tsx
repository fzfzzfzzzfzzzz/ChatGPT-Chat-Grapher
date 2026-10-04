// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangeParentDialog } from "../components/ChangeParentDialog";
import type { QuestionNode } from "../types/domain";

function node(
  id: string,
  question: string,
  parentId: string | null,
  updatedAt: number,
  chatId = "chat-1",
  createdAt = updatedAt,
): QuestionNode {
  return {
    id,
    projectId: "project-1",
    parentId,
    question,
    summary: `${question} summary`,
    status: "pending",
    chatId,
    messageId: `message-${id}`,
    createdAt,
    updatedAt,
  };
}

describe("ChangeParentDialog", () => {
  afterEach(cleanup);

  it("searches all valid parents and excludes the node and its descendants", async () => {
    const root = node("root", "Root question", null, 1);
    const current = node("current", "Current question", root.id, 2);
    const descendant = node("descendant", "Descendant question", current.id, 4);
    const sibling = node("sibling", "Sibling question", root.id, 3);
    const onSave = vi.fn(async () => true);
    const onClose = vi.fn();

    render(
      <ChangeParentDialog
        node={current}
        nodes={[root, current, descendant, sibling]}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    expect((screen.getByRole("radio", { name: /Root question/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("radio", { name: "Current question" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Descendant question" })).toBeNull();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索父节点" }), "Sibling");
    expect(screen.getByRole("radio", { name: "Sibling question" })).toBeDefined();
    expect(screen.queryByRole("radio", { name: "Root question" })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Sibling question" }));
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(onSave).toHaveBeenCalledWith("sibling");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("puts the same-conversation previous node first, labels and selects it", async () => {
    const currentParent = node("current-parent", "Current parent", null, 80, "chat-2", 10);
    const latestPrevious = node("latest-previous", "Latest previous", null, 20, "chat-1", 20);
    const recentlyUpdatedOtherChat = node("other-chat", "Other chat", null, 100, "chat-2", 25);
    const current = node("current", "Current question", currentParent.id, 30, "chat-1", 30);
    const onSave = vi.fn(async () => true);

    render(
      <ChangeParentDialog
        node={current}
        nodes={[currentParent, latestPrevious, recentlyUpdatedOtherChat, current]}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    const options = screen.getAllByRole("radio");
    expect(options[0]?.getAttribute("value")).toBe(latestPrevious.id);
    expect((options[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("最后一次")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onSave).toHaveBeenCalledWith(latestPrevious.id);
  });

  it("keeps the current parent selected when no same-conversation previous node exists", () => {
    const currentParent = node("current-parent", "Current parent", null, 10, "chat-2");
    const current = node("current", "Current question", currentParent.id, 20, "chat-1");

    render(
      <ChangeParentDialog
        node={current}
        nodes={[currentParent, current]}
        onSave={vi.fn(async () => true)}
        onClose={vi.fn()}
      />,
    );

    expect((screen.getByRole("radio", { name: "Current parent" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("最后一次")).toBeNull();
  });

  it("supports a root parent and stays open when saving fails", async () => {
    const root = node("root", "Root question", null, 1);
    const current = node("current", "Current question", root.id, 2);
    const onSave = vi.fn(async () => false);
    const onClose = vi.fn();
    render(
      <ChangeParentDialog
        node={current}
        nodes={[root, current]}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "无父节点 / 新根节点" }));
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(onSave).toHaveBeenCalledWith(null);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "更换父节点" })).toBeDefined();
  });

  it("closes without saving when cancelled", async () => {
    const current = node("current", "Current question", null, 1);
    const onSave = vi.fn(async () => true);
    const onClose = vi.fn();
    render(
      <ChangeParentDialog node={current} nodes={[current]} onSave={onSave} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
