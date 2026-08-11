import { describe, expect, it } from "vitest";
import { searchProjectNodes } from "../graph/nodeSearch";
import type { QuestionNode } from "../types/domain";

function node(
  id: string,
  question: string,
  summary: string,
  updatedAt: number,
): QuestionNode {
  return {
    id,
    projectId: "project",
    parentId: null,
    question,
    summary,
    status: "pending",
    chatId: `chat-${id}`,
    messageId: `message-${id}`,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("searchProjectNodes", () => {
  const nodes = [
    node("old-question", "OAuth callback failed", "Inspect redirects", 10),
    node("summary", "Login issue", "OAuth callback configuration", 30),
    node("new-question", "Fix   OAuth callback", "Latest attempt", 20),
    node("unrelated", "Database migration", "Move schema", 40),
  ];

  it("returns no nodes for an empty query", () => {
    expect(searchProjectNodes(nodes, "   ")).toEqual([]);
  });

  it("normalizes whitespace and case", () => {
    expect(searchProjectNodes(nodes, "oauth CALLBACK").map((item) => item.node.id)).toEqual([
      "new-question",
      "old-question",
      "summary",
    ]);
  });

  it("ranks question matches before summary-only matches and newest first", () => {
    const results = searchProjectNodes(nodes, "callback");
    expect(results.map((item) => [item.node.id, item.field])).toEqual([
      ["new-question", "question"],
      ["old-question", "question"],
      ["summary", "summary"],
    ]);
  });
});
