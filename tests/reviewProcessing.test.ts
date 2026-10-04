import { describe, expect, it } from "vitest";
import {
  batchReviewModules,
  estimateTextTokens,
  planReviewProcessing,
  REVIEW_CHUNK_MESSAGE_OVERLAP,
} from "../review/processing";
import type { ConversationReviewMessage, ReviewModuleId } from "../types/domain";
import { REVIEW_MODULE_ORDER } from "../review/catalog";

function message(index: number, content: string): ConversationReviewMessage {
  const role = index % 2 ? "assistant" as const : "user" as const;
  return {
    sourceId: `source-${index}`,
    chatId: "chat-1",
    role,
    content,
    ordinal: index,
    locator: {
      version: 1,
      chatId: "chat-1",
      role,
      ordinal: index,
      fingerprint: `fingerprint-${index}`,
    },
  };
}

describe("Conversation Review processing plan", () => {
  it("estimates CJK text more densely than same-length ASCII text", () => {
    expect(estimateTextTokens("这是中文测试文本")).toBeGreaterThan(
      estimateTextTokens("abcdefgh"),
    );
    expect(estimateTextTokens("")).toBe(0);
  });

  it("uses one direct request below 24k tokens and at most ten modules", () => {
    const plan = planReviewProcessing({
      messages: [message(0, "Short question"), message(1, "Short answer")],
      selectedModuleIds: ["discussion_overview", "next_steps"],
    });

    expect(plan.strategy).toBe("direct");
    expect(plan.usesFactExtraction).toBe(false);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.moduleBatches).toEqual([["discussion_overview", "next_steps"]]);
  });

  it("includes bounded ancestor metadata in the direct-request budget", () => {
    const withoutContext = planReviewProcessing({
      messages: [message(0, "a".repeat(80_000))],
      selectedModuleIds: ["discussion_overview"],
    });
    const withContext = planReviewProcessing({
      messages: [message(0, "a".repeat(80_000))],
      selectedModuleIds: ["discussion_overview"],
      additionalInputTokens: 4_000,
    });

    expect(withoutContext.strategy).toBe("direct");
    expect(withContext.strategy).toBe("chunked");
  });

  it("routes more than ten modules through fact extraction and batches by six", () => {
    const selected = REVIEW_MODULE_ORDER.slice(0, 11);
    const plan = planReviewProcessing({
      messages: [message(0, "short")],
      selectedModuleIds: selected,
    });

    expect(plan.strategy).toBe("chunked");
    expect(plan.usesFactExtraction).toBe(true);
    expect(plan.moduleBatches.map((batch) => batch.length)).toEqual([6, 5]);
    expect(batchReviewModules([...selected, selected[0]!]).flat()).toEqual(selected);
  });

  it("uses a two-message overlap between adjacent chunks", () => {
    const messages = Array.from(
      { length: 10 },
      (_, index) => message(index, "word ".repeat(1_800)),
    );
    const plan = planReviewProcessing({
      messages,
      selectedModuleIds: ["discussion_overview"],
    });

    expect(plan.strategy).toBe("chunked");
    expect(plan.chunks.length).toBeGreaterThan(1);
    for (let index = 1; index < plan.chunks.length; index += 1) {
      const previous = plan.chunks[index - 1]!;
      const current = plan.chunks[index]!;
      const expectedOverlap = previous.sourceIds.slice(-REVIEW_CHUNK_MESSAGE_OVERLAP);
      expect(current.sourceIds.slice(0, expectedOverlap.length)).toEqual(expectedOverlap);
      expect(current.overlapMessageCount).toBe(REVIEW_CHUNK_MESSAGE_OVERLAP);
      expect(current.startMessageIndex).toBeGreaterThan(previous.startMessageIndex);
    }
  });

  it("blocks rather than silently truncating more than twenty chunks", () => {
    const messages = Array.from(
      { length: 21 },
      (_, index) => message(index, "中".repeat(6_000)),
    );
    const plan = planReviewProcessing({
      messages,
      selectedModuleIds: ["discussion_overview"],
    });

    expect(plan.strategy).toBe("blocked");
    expect(plan.blockedReason).toBe("TOO_MANY_CHUNKS");
    expect(plan.estimatedChunkCount).toBeGreaterThan(20);
    expect(plan.chunks).toEqual([]);
  });

  it("accepts exactly twenty segments while preserving two prior messages", () => {
    const messages = Array.from(
      { length: 20 },
      (_, index) => message(index, "中".repeat(6_000)),
    );
    const plan = planReviewProcessing({
      messages,
      selectedModuleIds: ["discussion_overview"],
    });

    expect(plan.strategy).toBe("chunked");
    expect(plan.estimatedChunkCount).toBe(20);
    expect(plan.chunks).toHaveLength(20);
    expect(plan.chunks[1]?.overlapMessageCount).toBe(1);
    expect(plan.chunks.slice(2).every(({ overlapMessageCount }) =>
      overlapMessageCount === 2
    )).toBe(true);
  });

  it("blocks an indivisible message that exceeds the direct input limit", () => {
    const plan = planReviewProcessing({
      messages: [message(0, "中".repeat(25_000))],
      selectedModuleIds: ["discussion_overview"],
    });

    expect(plan.strategy).toBe("blocked");
    expect(plan.blockedReason).toBe("OVERSIZED_MESSAGE");
    expect(plan.oversizedMessageSourceIds).toEqual(["source-0"]);
  });

  it("deduplicates module ids before creating batches", () => {
    const duplicated = [
      "user_goal",
      "next_steps",
      "user_goal",
    ] as ReviewModuleId[];
    expect(batchReviewModules(duplicated)).toEqual([["user_goal", "next_steps"]]);
  });
});
