import { describe, expect, it, vi } from "vitest";
import {
  fingerprintMessageText,
  getCapturedQuestions,
  locateQuestionMessage,
} from "../adapters/chatgpt/questionCapture";
import type { MessageLocator } from "../types/domain";

type FakeMessage = HTMLElement & { container: HTMLElement };

function fixture(texts: string[], ids: Array<string | undefined> = []) {
  const messages = texts.map((text, index) => {
    const container = {
      dataset: { turnId: `turn-${index}` },
      getAttribute: (name: string) => name === "data-turn-id" ? `turn-${index}` : null,
      matches: () => false,
      closest: () => null,
      querySelector: () => message,
      scrollIntoView: vi.fn(),
      animate: vi.fn(),
    } as unknown as HTMLElement;
    const message = {
      dataset: { ...(ids[index] ? { messageId: ids[index] } : {}) },
      innerText: text,
      getAttribute: (name: string) => name === "data-message-id" ? ids[index] ?? null : null,
      matches: (selector: string) => selector === '[data-message-author-role="user"]',
      closest: (selector: string) => selector.includes("section") ? container : null,
      querySelector: () => null,
      scrollIntoView: vi.fn(),
      animate: vi.fn(),
      container,
    } as unknown as FakeMessage;
    return message;
  });
  const containers = messages.map((message) => message.container);
  const root = {
    querySelectorAll: (selector: string) => {
      if (selector === '[data-message-author-role="user"]') return messages;
      if (selector === "[data-message-id]") return messages.filter((message) => message.dataset.messageId);
      if (selector === "[data-turn-id]") return containers;
      return [];
    },
  } as unknown as ParentNode;
  return { root, messages };
}

function locator(overrides: Partial<MessageLocator>): MessageLocator {
  return {
    version: 1,
    ordinal: 0,
    fingerprint: fingerprintMessageText("First question"),
    ...overrides,
  };
}

describe("locateQuestionMessage", () => {
  it("prefers a stable message id", () => {
    const { root } = fixture(["First question"], ["message-1"]);
    expect(locateQuestionMessage("legacy", undefined, locator({ messageId: "message-1" }), root))
      .toBe("messageId");
  });

  it("falls back to a turn id", () => {
    const { root } = fixture(["First question"]);
    expect(locateQuestionMessage("legacy", undefined, locator({ turnId: "turn-0" }), root))
      .toBe("turnId");
  });

  it("supports legacy message ids", () => {
    const { root } = fixture(["First question"], ["legacy"]);
    expect(locateQuestionMessage("legacy", undefined, undefined, root))
      .toBe("legacyMessageId");
  });

  it("uses ordinal plus fingerprint for duplicate text", () => {
    const { root } = fixture(["Repeated", "Repeated"]);
    const fingerprint = fingerprintMessageText("Repeated");
    expect(locateQuestionMessage(
      "user:1:placeholder",
      `user:1:${fingerprint}`,
      { version: 1, ordinal: 1, fingerprint },
      root,
    )).toBe("anchor");
  });

  it("ignores placeholder ids and uses the anchor", () => {
    const { root } = fixture(["First question"], ["placeholder-request-1"]);
    expect(locateQuestionMessage(
      "placeholder-request-1",
      `user:0:${fingerprintMessageText("First question")}`,
      locator({ messageId: "placeholder-request-1" }),
      root,
    )).toBe("anchor");
  });

});

describe("getCapturedQuestions", () => {
  it("captures every user question in page order with stable locators", () => {
    vi.stubGlobal("location", { href: "https://chatgpt.com/c/chat-1" });
    vi.stubGlobal("document", { title: "Imported discussion | ChatGPT" });
    const { root } = fixture(
      ["  First\nquestion  ", "Second question"],
      ["message-1", undefined],
    );

    const captured = getCapturedQuestions(root);

    expect(captured).toHaveLength(2);
    expect(captured.map((item) => item.question)).toEqual([
      "First question",
      "Second question",
    ]);
    expect(captured[0]).toMatchObject({
      chatId: "chat-1",
      messageId: "message-1",
      messageAnchor: `user:0:${fingerprintMessageText("First question")}`,
      messageLocator: {
        version: 1,
        ordinal: 0,
        messageId: "message-1",
      },
    });
    expect(captured[1]?.messageId).toBe("turn-1");
    expect(captured[1]?.messageLocator?.ordinal).toBe(1);
    vi.unstubAllGlobals();
  });

  it("returns no questions outside a loaded conversation", () => {
    vi.stubGlobal("location", { href: "https://chatgpt.com/" });
    vi.stubGlobal("document", { title: "ChatGPT" });
    expect(getCapturedQuestions(fixture(["Question"]).root)).toEqual([]);
    vi.unstubAllGlobals();
  });

});
