import { describe, expect, it } from "vitest";
import { getParentSelectionCandidates } from "../graph/questionTree";
import type { QuestionNode } from "../types/domain";

function node(
  id: string,
  chatId: string,
  createdAt: number,
  options: { parentId?: string | null; updatedAt?: number } = {},
): QuestionNode {
  return {
    id,
    projectId: "project-1",
    parentId: options.parentId ?? null,
    question: id,
    summary: `${id} summary`,
    status: "pending",
    chatId,
    messageId: `message-${id}`,
    createdAt,
    updatedAt: options.updatedAt ?? createdAt,
  };
}

describe("getParentSelectionCandidates", () => {
  it("puts the closest earlier node from the same conversation first", () => {
    const oldSameChat = node("old-same-chat", "chat-1", 10, { updatedAt: 100 });
    const latestSameChat = node("latest-same-chat", "chat-1", 20, { updatedAt: 20 });
    const recentlyUpdatedOtherChat = node("other-chat", "chat-2", 25, { updatedAt: 200 });
    const current = node("current", "chat-1", 30, { updatedAt: 30 });

    const result = getParentSelectionCandidates(
      [oldSameChat, latestSameChat, recentlyUpdatedOtherChat, current],
      current.id,
    );

    expect(result.latestConversationNodeId).toBe(latestSameChat.id);
    expect(result.nodes.map(({ id }) => id)).toEqual([
      latestSameChat.id,
      recentlyUpdatedOtherChat.id,
      oldSameChat.id,
    ]);
  });

  it("never treats a later node as the latest previous conversation", () => {
    const previous = node("previous", "chat-1", 10);
    const current = node("current", "chat-1", 20);
    const later = node("later", "chat-1", 30, { updatedAt: 300 });

    const result = getParentSelectionCandidates([previous, current, later], current.id);

    expect(result.latestConversationNodeId).toBe(previous.id);
    expect(result.nodes[0]?.id).toBe(previous.id);
  });

  it("skips invalid descendants and uses the next closest legal node", () => {
    const legalPrevious = node("legal-previous", "chat-1", 10);
    const current = node("current", "chat-1", 30);
    const descendantWithOlderTimestamp = node("descendant", "chat-1", 20, {
      parentId: current.id,
      updatedAt: 200,
    });

    const result = getParentSelectionCandidates(
      [legalPrevious, current, descendantWithOlderTimestamp],
      current.id,
    );

    expect(result.latestConversationNodeId).toBe(legalPrevious.id);
    expect(result.nodes.map(({ id }) => id)).toEqual([legalPrevious.id]);
  });

  it("keeps update-time ordering and omits the marker without a same-chat previous node", () => {
    const olderOtherChat = node("older-other-chat", "chat-2", 10, { updatedAt: 40 });
    const newerOtherChat = node("newer-other-chat", "chat-3", 20, { updatedAt: 50 });
    const current = node("current", "chat-1", 30);

    const result = getParentSelectionCandidates(
      [olderOtherChat, newerOtherChat, current],
      current.id,
    );

    expect(result.latestConversationNodeId).toBeUndefined();
    expect(result.nodes.map(({ id }) => id)).toEqual([
      newerOtherChat.id,
      olderOtherChat.id,
    ]);
  });
});
