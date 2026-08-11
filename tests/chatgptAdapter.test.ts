import { describe, expect, it } from "vitest";
import { isChatConversationUrl } from "../adapters/chatgpt/getConversation";

describe("ChatGPT conversation URL detection", () => {
  it.each([
    "https://chatgpt.com/c/1234",
    "https://chat.openai.com/c/1234?model=test",
    "https://chatgpt.com/g/g-example/c/1234",
  ])("accepts a conversation route: %s", (url) => {
    expect(isChatConversationUrl(url)).toBe(true);
  });

  it.each([
    "https://chatgpt.com/",
    "https://chatgpt.com/settings",
    "https://chatgpt.com/c/",
    "https://example.com/c/1234",
    "not a URL",
  ])("rejects a non-conversation route: %s", (url) => {
    expect(isChatConversationUrl(url)).toBe(false);
  });
});
