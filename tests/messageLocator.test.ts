import { describe, expect, it, vi } from "vitest";
import {
  fingerprintMessageText,
  getAllCapturedQuestions,
  getCapturedQuestions,
  locateQuestionMessage,
  locateQuestionMessageWithHistory,
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

  it("scans virtualized history and leaves the view at the located old question", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { href: "https://chatgpt.com/c/chat-virtual" });
    vi.stubGlobal("document", { title: "Virtualized discussion | ChatGPT" });
    let virtualScrollTop = 1600;
    const scrollContainer = {
      scrollHeight: 2000,
      clientHeight: 400,
      parentElement: null,
      get scrollTop() { return virtualScrollTop; },
      set scrollTop(value: number) { virtualScrollTop = Math.max(0, Math.min(1600, value)); },
    } as unknown as Element;
    const containers: HTMLElement[] = [];
    const messages = ["First", "Second", "Third", "Latest"].map((text, index) => {
      const container = {
        dataset: { turnId: `turn-${index}` },
        getAttribute: (name: string) => name === "data-turn-id" ? `turn-${index}` : null,
        querySelector: () => message,
        scrollIntoView: vi.fn(),
        animate: vi.fn(),
      } as unknown as HTMLElement;
      containers.push(container);
      const message = {
        dataset: { messageId: `message-${index}` },
        innerText: text,
        parentElement: scrollContainer,
        getAttribute: (name: string) => name === "data-message-id" ? `message-${index}` : null,
        matches: (selector: string) => selector === '[data-message-author-role="user"]',
        closest: (selector: string) => selector.includes("section") ? container : null,
      } as unknown as HTMLElement;
      return message;
    });
    const currentMessages = () => {
      if (virtualScrollTop > 1000) return messages.slice(2);
      if (virtualScrollTop > 300) return messages.slice(1, 3);
      return messages.slice(0, 2);
    };
    const root = {
      querySelectorAll: (selector: string) => {
        if (selector === '[data-message-author-role="user"]') return currentMessages();
        if (selector === "[data-message-id]") return currentMessages();
        if (selector === "[data-turn-id]") {
          return currentMessages().map((message) =>
            containers[Number(message.dataset.messageId?.split("-")[1])]
          );
        }
        return [];
      },
    } as unknown as ParentNode;
    vi.stubGlobal("window", { setTimeout });
    vi.stubGlobal("getComputedStyle", () => ({ overflowY: "auto" }));

    const pending = locateQuestionMessageWithHistory(
      "message-0",
      `user:0:${fingerprintMessageText("First")}`,
      {
        version: 1,
        messageId: "message-0",
        turnId: "turn-0",
        ordinal: 0,
        fingerprint: fingerprintMessageText("First"),
      },
      root,
    );
    await vi.runAllTimersAsync();

    expect(await pending).toBe("messageId");
    expect(virtualScrollTop).toBeLessThanOrEqual(300);
    expect(containers[0]?.scrollIntoView).toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("collects virtualized history in order and restores the scroll position", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { href: "https://chatgpt.com/c/chat-virtual" });
    vi.stubGlobal("document", { title: "Virtualized discussion | ChatGPT" });
    let virtualScrollTop = 1600;
    const scrollContainer = {
      scrollHeight: 2000,
      clientHeight: 400,
      parentElement: null,
      get scrollTop() { return virtualScrollTop; },
      set scrollTop(value: number) { virtualScrollTop = Math.max(0, Math.min(1600, value)); },
    } as unknown as Element;
    const messages = ["First", "Second", "Third", "Latest"].map((text, index) => {
      const container = {
        dataset: { turnId: `turn-${index}` },
        querySelector: () => message,
      } as unknown as HTMLElement;
      const message = {
        dataset: {},
        innerText: text,
        parentElement: scrollContainer,
        closest: (selector: string) => selector.includes("section") ? container : null,
      } as unknown as HTMLElement;
      return message;
    });
    const root = {
      querySelectorAll: (selector: string) => {
        if (selector !== '[data-message-author-role="user"]') return [];
        if (virtualScrollTop > 1000) return messages.slice(2);
        if (virtualScrollTop > 300) return messages.slice(1, 3);
        return messages.slice(0, 2);
      },
    } as unknown as ParentNode;
    vi.stubGlobal("window", { setTimeout });
    vi.stubGlobal("getComputedStyle", () => ({ overflowY: "auto" }));

    const pending = getAllCapturedQuestions(root);
    await vi.runAllTimersAsync();
    const captured = await pending;

    expect(captured.map((item) => item.question)).toEqual([
      "First",
      "Second",
      "Third",
      "Latest",
    ]);
    expect(captured.map((item) => item.messageLocator?.ordinal)).toEqual([0, 1, 2, 3]);
    expect(scrollContainer.scrollTop).toBe(1600);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
