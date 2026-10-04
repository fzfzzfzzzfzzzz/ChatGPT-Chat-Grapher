import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiscussionMapDatabase } from "../db/database";
import { DiscussionService } from "../graph/discussionService";
import type { CapturedQuestion } from "../types/domain";

describe("question reference persistence", () => {
  let database: DiscussionMapDatabase;
  let service: DiscussionService;

  beforeEach(() => {
    database = new DiscussionMapDatabase(`references-${crypto.randomUUID()}`);
    service = new DiscussionService(database);
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it("keeps references when a candidate is promoted and during linear import", async () => {
    const project = await service.createProject("References", "Keep source context");
    const captured = capture("Question with a file", 1);
    const candidate = await service.createCandidate(project.id, captured);
    expect("recommendations" in candidate).toBe(true);
    if (!("recommendations" in candidate)) return;
    const node = await service.promoteCandidate(candidate.id, null, "user");
    expect(node.references).toEqual(captured.references);

    const imported = capture("Question with a quote", 2);
    imported.references = [{
      id: "quote-1",
      type: "assistant_quote",
      excerpt: "Use the existing cache boundary.",
      sourceLocator: { version: 1, chatId: "chat-1", role: "assistant", messageId: "answer-1" },
    }];
    await service.importLinearQuestions(project.id, [imported]);
    expect((await service.nodes.findByMessage(project.id, "chat-1", "message-2"))?.references)
      .toEqual(imported.references);
  });
});

function capture(question: string, index: number): CapturedQuestion {
  return {
    question,
    chatId: "chat-1",
    messageId: `message-${index}`,
    references: [{
      id: `file-${index}`,
      type: "file",
      name: "requirements.pdf",
      sourceLocator: {
        version: 1,
        chatId: "chat-1",
        role: "user",
        messageId: `message-${index}`,
      },
    }],
  };
}
