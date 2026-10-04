import { describe, expect, it } from "vitest";
import {
  isConversationReviewMessage,
  isReviewSourceUploadMetadata,
} from "../shared/messages";

describe("review source upload message guards", () => {
  it("accepts the bounded capture metadata emitted by the collector", () => {
    expect(isReviewSourceUploadMetadata({
      chatId: "chat-1",
      conversationTitle: "一次短对话",
      complete: false,
      missingSourceIds: ["source-3"],
      stoppedReason: "virtualization_stalled",
    })).toBe(true);
  });

  it("rejects malformed or extensible capture metadata", () => {
    expect(isReviewSourceUploadMetadata({
      chatId: "   ",
      complete: true,
      missingSourceIds: [],
    })).toBe(false);
    expect(isReviewSourceUploadMetadata({
      chatId: "chat-1",
      complete: "yes",
      missingSourceIds: [],
    })).toBe(false);
    expect(isReviewSourceUploadMetadata({
      chatId: "chat-1",
      complete: true,
      missingSourceIds: [],
      rawConversation: "must never enter the upload store",
    })).toBe(false);
    expect(isReviewSourceUploadMetadata({
      chatId: "chat-1",
      complete: false,
      missingSourceIds: [],
      stoppedReason: "unknown_reason",
    })).toBe(false);
  });

  it("accepts a source message only when its locator matches its role and chat", () => {
    expect(isConversationReviewMessage(sourceMessage())).toBe(true);
    expect(isConversationReviewMessage(sourceMessage({
      locator: {
        ...sourceMessage().locator,
        chatId: "another-chat",
      },
    }))).toBe(false);
    expect(isConversationReviewMessage(sourceMessage({
      locator: {
        ...sourceMessage().locator,
        role: "assistant",
      },
    }))).toBe(false);
  });

  it("rejects invalid ordinals, oversized identifiers, and unknown payload fields", () => {
    expect(isConversationReviewMessage(sourceMessage({ ordinal: -1 }))).toBe(false);
    expect(isConversationReviewMessage(sourceMessage({ sourceId: "x".repeat(2_049) }))).toBe(false);
    expect(isConversationReviewMessage({
      ...sourceMessage(),
      fullPrompt: "must not cross the message boundary",
    })).toBe(false);
    expect(isConversationReviewMessage({
      ...sourceMessage(),
      locator: {
        ...sourceMessage().locator,
        privateMetadata: "not part of the locator protocol",
      },
    })).toBe(false);
  });
});

function sourceMessage(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "source-1",
    chatId: "chat-1",
    role: "user",
    content: "请总结这段对话",
    ordinal: 0,
    locator: {
      version: 1,
      chatId: "chat-1",
      role: "user",
      messageId: "message-1",
      turnId: "turn-1",
      ordinal: 0,
      fingerprint: "fingerprint-1",
    },
    ...overrides,
  };
}
