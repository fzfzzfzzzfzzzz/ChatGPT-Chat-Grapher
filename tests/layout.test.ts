import { describe, expect, it } from "vitest";
import { questionsToFlow } from "../graph/layout";
import type { QuestionNode } from "../types/domain";

describe("questionsToFlow", () => {
  it("converts a 100-question forest to nodes and parent edges", () => {
    const now = Date.now();
    const questions: QuestionNode[] = Array.from({ length: 100 }, (_, index) => ({
      id: `node-${index}`,
      projectId: "project",
      parentId: index > 1 ? `node-${Math.floor((index - 2) / 3)}` : null,
      question: `Question ${index + 1}`,
      summary: `Summary ${index + 1}`,
      status: index % 5 === 0 ? "resolved" : "pending",
      chatId: `chat-${Math.floor(index / 10)}`,
      messageId: `message-${index}`,
      createdAt: now + index,
      updatedAt: now + index,
    }));

    const startedAt = performance.now();
    const result = questionsToFlow(questions, "node-99");
    const elapsed = performance.now() - startedAt;

    expect(result.nodes).toHaveLength(100);
    expect(result.edges).toHaveLength(98);
    expect(new Set(result.nodes.map((node) => node.id)).size).toBe(100);
    expect(elapsed).toBeLessThan(500);
  });
});
