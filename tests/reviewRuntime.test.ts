import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationReviewMessage,
  ReviewCaptureReport,
} from "../types/domain";
import type { StartReviewJobRequest } from "../shared/messages";

const browserMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  tabsQuery: vi.fn(),
  tabSendMessage: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    tabs: {
      query: browserMocks.tabsQuery,
      sendMessage: browserMocks.tabSendMessage,
    },
    runtime: {
      sendMessage: browserMocks.sendMessage,
      onMessage: {
        addListener: browserMocks.addListener,
        removeListener: browserMocks.removeListener,
      },
    },
  },
}));

import {
  chunkReviewMessages,
  collectReviewSourceFromActiveTab,
  ReviewUploadSizeError,
  uploadReviewSourceAndStart,
} from "../review/runtime";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("review source upload runtime", () => {
  it("rejects an active ChatGPT tab that is not the requested source conversation", async () => {
    browserMocks.tabsQuery.mockResolvedValue([{ id: 12, url: "https://chatgpt.com/c/current-chat" }]);
    browserMocks.tabSendMessage.mockResolvedValue({
      ...capture(),
      chatId: "current-chat",
    });

    await expect(collectReviewSourceFromActiveTab("target-chat")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      expectedChatId: "target-chat",
      actualChatId: "current-chat",
      message: "当前标签不是目标节点的来源会话，请打开对应的 ChatGPT 会话后重试。",
    });
    expect(browserMocks.tabSendMessage).toHaveBeenCalledWith(12, {
      type: "COLLECT_REVIEW_SOURCE",
    });
  });

  it("accepts the active tab when it matches the requested source conversation", async () => {
    browserMocks.tabsQuery.mockResolvedValue([{ id: 9, url: "https://chatgpt.com/c/chat-1" }]);
    browserMocks.tabSendMessage.mockResolvedValue(capture());

    await expect(collectReviewSourceFromActiveTab("chat-1")).resolves.toEqual(capture());
  });

  it("discards the in-memory upload after an append rejection", async () => {
    browserMocks.sendMessage
      .mockResolvedValueOnce({ ok: true, uploadId: "server-upload" })
      .mockResolvedValueOnce({ ok: false, code: "INVALID_CHUNK", error: "bad chunk" })
      .mockResolvedValueOnce({ ok: true });

    const response = await uploadReviewSourceAndStart(capture(), startRequest());

    expect(response).toEqual({ ok: false, code: "INVALID_CHUNK", error: "bad chunk" });
    expect(messageTypes()).toEqual([
      "BEGIN_REVIEW_SOURCE_UPLOAD",
      "APPEND_REVIEW_SOURCE_CHUNK",
      "DISCARD_REVIEW_SOURCE_UPLOAD",
    ]);
  });

  it("discards after begin or commit failure, but not after a successful commit", async () => {
    browserMocks.sendMessage
      .mockResolvedValueOnce({ ok: false, error: "begin failed" })
      .mockResolvedValueOnce({ ok: true });
    await expect(uploadReviewSourceAndStart(capture(), startRequest())).resolves.toEqual({
      ok: false,
      error: "begin failed",
    });
    expect(messageTypes()).toEqual([
      "BEGIN_REVIEW_SOURCE_UPLOAD",
      "DISCARD_REVIEW_SOURCE_UPLOAD",
    ]);

    vi.clearAllMocks();
    browserMocks.sendMessage
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "commit failed" })
      .mockResolvedValueOnce({ ok: true });
    await uploadReviewSourceAndStart(capture(), startRequest());
    expect(messageTypes()).toEqual([
      "BEGIN_REVIEW_SOURCE_UPLOAD",
      "APPEND_REVIEW_SOURCE_CHUNK",
      "COMMIT_REVIEW_SOURCE_UPLOAD",
      "DISCARD_REVIEW_SOURCE_UPLOAD",
    ]);

    vi.clearAllMocks();
    browserMocks.sendMessage
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, job: { id: "job-1" } });
    await uploadReviewSourceAndStart(capture(), startRequest());
    expect(messageTypes()).toEqual([
      "BEGIN_REVIEW_SOURCE_UPLOAD",
      "APPEND_REVIEW_SOURCE_CHUNK",
      "COMMIT_REVIEW_SOURCE_UPLOAD",
    ]);
  });

  it("discards when transport throws at any point after beginning", async () => {
    browserMocks.sendMessage
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("runtime disconnected"))
      .mockResolvedValueOnce({ ok: true });

    await expect(uploadReviewSourceAndStart(capture(), startRequest())).rejects.toThrow(
      "runtime disconnected",
    );
    expect(messageTypes()).toEqual([
      "BEGIN_REVIEW_SOURCE_UPLOAD",
      "APPEND_REVIEW_SOURCE_CHUNK",
      "DISCARD_REVIEW_SOURCE_UPLOAD",
    ]);
  });

  it("uses the complete serialized append envelope when splitting chunks", () => {
    const uploadId = "upload-with-a-real-id";
    const messages = Array.from({ length: 45 }, (_, index) => sourceMessage(
      index,
      "x".repeat(2_100),
      // This metadata is intentionally substantial; content-only accounting
      // would incorrectly pack too many messages into one chunk.
      Array.from({ length: 20 }, (__, pathIndex) => `branch-${index}-${pathIndex}-${"z".repeat(50)}`),
    ));

    const chunks = chunkReviewMessages(messages, uploadId);

    expect(chunks.flat()).toEqual(messages);
    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
    chunks.forEach((chunk, index) => {
      const serialized = JSON.stringify({
        type: "APPEND_REVIEW_SOURCE_CHUNK",
        uploadId,
        index,
        messages: chunk,
      });
      expect(serialized.length).toBeLessThanOrEqual(96_000);
    });
  });

  it("rejects a single message whose full structured payload exceeds the limit", () => {
    const oversizedContent = "私密原文".repeat(25_000);
    expect(() => chunkReviewMessages([
      sourceMessage(0, oversizedContent),
    ], "upload-id")).toThrowError(ReviewUploadSizeError);
    try {
      chunkReviewMessages([sourceMessage(0, oversizedContent)], "upload-id");
    } catch (error) {
      expect(error).toMatchObject({ code: "SOURCE_TOO_LARGE" });
      expect((error as Error).message).not.toContain(oversizedContent.slice(0, 100));
    }

    const metadataOversized = sourceMessage(0, "short", ["m".repeat(97_000)]);
    expect(() => chunkReviewMessages([metadataOversized], "upload-id")).toThrowError(
      ReviewUploadSizeError,
    );
  });
});

function messageTypes(): unknown[] {
  return browserMocks.sendMessage.mock.calls.map(
    ([message]) => (message as { type?: unknown }).type,
  );
}

function capture(): ReviewCaptureReport {
  return {
    chatId: "chat-1",
    messages: [sourceMessage(0, "请总结")],
    complete: true,
    missingSourceIds: [],
  };
}

function startRequest(): StartReviewJobRequest {
  return {
    projectId: "project-1",
    entrySource: "side_panel",
    scopeType: "conversation",
    moduleIds: ["discussion_overview"],
    presetId: "general",
    allowPartial: false,
  };
}

function sourceMessage(
  index: number,
  content: string,
  branchPath?: string[],
): ConversationReviewMessage {
  return {
    sourceId: `source-${index}`,
    chatId: "chat-1",
    role: "user",
    content,
    ordinal: index,
    locator: {
      version: 1,
      chatId: "chat-1",
      role: "user",
      messageId: `message-${index}`,
      turnId: `turn-${index}`,
      ordinal: index,
      fingerprint: `fingerprint-${index}`,
    },
    ...(branchPath ? { branchPath } : {}),
  };
}
