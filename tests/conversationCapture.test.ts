import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureConversationWindow,
  captureFullConversation,
} from "../adapters/chatgpt/conversationCapture";
import { fingerprintMessageText } from "../adapters/chatgpt/questionCapture";

type FakeMessage = HTMLElement & {
  capturePluginUi?: boolean;
  captureInactive?: boolean;
};

function installConversationPage(chatId = "review-chat") {
  vi.stubGlobal("location", { href: `https://chatgpt.com/c/${chatId}` });
  vi.stubGlobal("document", {
    title: "Review fixture | ChatGPT",
    scrollingElement: null,
  });
}

function message(
  role: "user" | "assistant",
  text: string,
  id: string | undefined,
  turnId: string,
  parentElement?: HTMLElement,
  flags: { pluginUi?: boolean; inactive?: boolean } = {},
): FakeMessage {
  const turn = {
    dataset: { turnId },
    getAttribute: (name: string) => name === "data-turn-id" ? turnId : null,
  } as unknown as HTMLElement;
  const element = {
    dataset: {
      messageAuthorRole: role,
      ...(id ? { messageId: id } : {}),
    },
    innerText: text,
    parentElement: parentElement ?? null,
    capturePluginUi: flags.pluginUi,
    captureInactive: flags.inactive,
    getAttribute(name: string) {
      if (name === "data-message-author-role") return role;
      if (name === "data-message-id") return id ?? null;
      if (name === "aria-hidden") return flags.inactive ? "true" : null;
      return null;
    },
    hasAttribute(name: string) {
      return flags.inactive && name === "hidden";
    },
    closest(selector: string) {
      if (selector.includes("chat-graph") && flags.pluginUi) return element;
      if ((selector.includes("[hidden]") || selector.includes("aria-hidden")) && flags.inactive) {
        return element;
      }
      if (selector.includes("data-turn-id")) return turn;
      return null;
    },
  } as unknown as FakeMessage;
  return element;
}

function rootFor(getMessages: () => FakeMessage[]): ParentNode {
  return {
    querySelectorAll: (selector: string) =>
      selector.includes("data-message-author-role") ? getMessages() : [],
  } as unknown as ParentNode;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("captureConversationWindow", () => {
  it("captures user and assistant messages in DOM order with stable reference locators", () => {
    installConversationPage();
    const messages = [
      message("user", "  Keep Node.js 22, not 20.  ", "message-user-1", "turn-1"),
      message("assistant", "Use TypeScript 7.0.2.", "message-assistant-1", "turn-2"),
      message("user", "No cloud sync", undefined, "turn-3"),
    ];

    const report = captureConversationWindow(rootFor(() => messages));

    expect(report).toMatchObject({
      chatId: "review-chat",
      conversationTitle: "Review fixture",
      complete: true,
      missingSourceIds: [],
    });
    expect(report.messages.map(({ role, content, ordinal }) => ({ role, content, ordinal })))
      .toEqual([
        { role: "user", content: "Keep Node.js 22, not 20.", ordinal: 0 },
        { role: "assistant", content: "Use TypeScript 7.0.2.", ordinal: 1 },
        { role: "user", content: "No cloud sync", ordinal: 2 },
      ]);
    expect(report.messages[0]?.locator).toEqual({
      version: 1,
      chatId: "review-chat",
      role: "user",
      messageId: "message-user-1",
      turnId: "turn-1",
      ordinal: 0,
      fingerprint: fingerprintMessageText("Keep Node.js 22, not 20."),
    });
    expect(report.messages[0]?.sourceId).toContain("user/message:message-user-1");
    expect(report.messages[0]?.sourceId).toContain("ordinal:0");
    expect(report.messages[2]?.sourceId).toContain("turn:turn-3");
  });

  it("excludes extension UI, inactive native alternatives, and empty messages", () => {
    installConversationPage();
    const messages = [
      message("user", "Selected branch", "selected", "turn-selected"),
      message("assistant", "Plugin copy", "plugin", "turn-plugin", undefined, { pluginUi: true }),
      message("assistant", "Inactive regenerated answer", "inactive", "turn-inactive", undefined, {
        inactive: true,
      }),
      message("assistant", "   ", "empty", "turn-empty"),
    ];

    const report = captureConversationWindow(rootFor(() => messages));

    expect(report.messages.map((item) => item.content)).toEqual(["Selected branch"]);
    expect(report.complete).toBe(true);
  });

  it("reports a missing conversation source without inventing branch messages", () => {
    vi.stubGlobal("location", { href: "https://chatgpt.com/" });
    vi.stubGlobal("document", { title: "ChatGPT", scrollingElement: null });

    expect(captureConversationWindow(rootFor(() => []))).toEqual({
      chatId: "",
      messages: [],
      complete: false,
      missingSourceIds: [],
      stoppedReason: "source_unavailable",
    });
  });
});

describe("captureFullConversation", () => {
  it("deduplicates overlapping virtual windows, restores order, and restores scrolling", async () => {
    installConversationPage("virtual-chat");
    let scrollTop = 800;
    const scroller = {
      scrollHeight: 2000,
      clientHeight: 400,
      parentElement: null,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = Math.max(0, Math.min(1600, value));
      },
    } as unknown as HTMLElement;
    const all = ["A", "B", "C", "D", "E", "F"].map((text, index) =>
      message(
        index % 2 === 0 ? "user" : "assistant",
        text,
        `message-${text}`,
        `turn-${text}`,
        scroller,
      )
    );
    const mounted = () => {
      if (scrollTop <= 1) return all.slice(0, 2);
      if (scrollTop <= 800) return all.slice(1, 4);
      if (scrollTop < 1600) return all.slice(3, 5);
      return all.slice(4, 6);
    };
    vi.stubGlobal("getComputedStyle", () => ({ overflowY: "auto" }));

    const report = await captureFullConversation(rootFor(mounted), {
      renderDelayMs: 0,
      maxDurationMs: 1_000,
    });

    expect(report.complete).toBe(true);
    expect(report.stoppedReason).toBeUndefined();
    expect(report.messages.map((item) => item.content)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(report.messages.map((item) => item.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(report.messages.map((item) => item.sourceId)).size).toBe(6);
    expect(report.messages[5]?.locator.ordinal).toBe(5);
    expect(scrollTop).toBe(800);
  });

  it("returns partial ordered data on the scan step limit and restores scrolling", async () => {
    installConversationPage("limited-chat");
    let scrollTop = 800;
    const scroller = {
      scrollHeight: 2000,
      clientHeight: 400,
      parentElement: null,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = Math.max(0, Math.min(1600, value));
      },
    } as unknown as HTMLElement;
    const first = message("user", "Earlier", "earlier", "turn-earlier", scroller);
    const latest = message("assistant", "Latest", "latest", "turn-latest", scroller);
    const mounted = () => scrollTop < 800 ? [first] : [latest];
    vi.stubGlobal("getComputedStyle", () => ({ overflowY: "auto" }));

    const report = await captureFullConversation(rootFor(mounted), {
      renderDelayMs: 0,
      maxSteps: 1,
      maxDurationMs: 1_000,
    });

    expect(report.complete).toBe(false);
    expect(report.stoppedReason).toBe("scan_limit");
    expect(report.messages.map((item) => item.content)).toEqual(["Earlier", "Latest"]);
    expect(report.messages.map((item) => item.ordinal)).toEqual([0, 1]);
    expect(scrollTop).toBe(800);
  });

  it("reports a stalled virtualizer instead of claiming a complete capture", async () => {
    installConversationPage("stalled-chat");
    let scrollTop = 800;
    const scroller = {
      scrollHeight: 2000,
      clientHeight: 400,
      parentElement: null,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(_value: number) {
        // Simulate a virtualizer that refuses programmatic scrolling.
      },
    } as unknown as HTMLElement;
    const mounted = [message("user", "Only mounted row", "only", "turn-only", scroller)];
    vi.stubGlobal("getComputedStyle", () => ({ overflowY: "auto" }));

    const report = await captureFullConversation(rootFor(() => mounted), {
      renderDelayMs: 0,
      stallLimit: 2,
      maxSteps: 10,
      maxDurationMs: 1_000,
    });

    expect(report.complete).toBe(false);
    expect(report.stoppedReason).toBe("virtualization_stalled");
    expect(report.messages).toHaveLength(1);
    expect(scrollTop).toBe(800);
  });
});
