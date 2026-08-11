import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import { questionsToFlow } from "../graph/layout";
import type { QuestionNode } from "../types/domain";

describe("questionsToFlow", () => {
  it("places a single child directly to the right of its parent", () => {
    const questions = [
      question("root", null, 1),
      question("first-branch", "root", 2),
      question("lower-parent", "root", 3),
      question("lower-child", "lower-parent", 4),
    ];

    const result = questionsToFlow(questions);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const parent = byId.get("lower-parent")!;
    const child = byId.get("lower-child")!;

    expect(child.position.x).toBe(parent.position.x + 270);
    expect(child.position.y).toBe(parent.position.y);
    expect(child.position.y).toBeGreaterThan(byId.get("first-branch")!.position.y);
  });

  it("centers a parent beside its group of direct child subtrees", () => {
    const questions = [
      question("root", null, 1),
      question("first", "root", 2),
      question("second", "root", 3),
    ];

    const result = questionsToFlow(questions);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const rootY = byId.get("root")!.position.y;
    const firstY = byId.get("first")!.position.y;
    const secondY = byId.get("second")!.position.y;

    expect(rootY).toBe((firstY + secondY) / 2);
  });

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
    expect(result.nodes.every((node) => node.sourcePosition === Position.Right)).toBe(true);
    expect(result.nodes.every((node) => node.targetPosition === Position.Left)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});

function question(id: string, parentId: string | null, createdAt: number): QuestionNode {
  return {
    id,
    projectId: "project",
    parentId,
    question: id,
    summary: id,
    status: "pending",
    chatId: "chat",
    messageId: `message-${id}`,
    createdAt,
    updatedAt: createdAt,
  };
}
