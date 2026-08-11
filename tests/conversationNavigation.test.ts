import { describe, expect, it } from "vitest";
import { selectExistingConversationTab } from "../platform/conversationNavigation";

describe("selectExistingConversationTab", () => {
  const tabs = [
    { id: 1, windowId: 10, active: false, url: "https://chatgpt.com/c/target" },
    { id: 2, windowId: 20, active: true, url: "https://chatgpt.com/c/target" },
    { id: 3, windowId: 10, active: true, url: "https://chatgpt.com/c/other" },
  ];

  it("prefers a matching tab in the source window", () => {
    expect(selectExistingConversationTab(tabs, "target", 10)?.id).toBe(1);
  });

  it("falls back to an active matching tab in another window", () => {
    expect(selectExistingConversationTab(tabs, "target", 30)?.id).toBe(2);
  });

  it("returns undefined when the conversation is not open", () => {
    expect(selectExistingConversationTab(tabs, "missing", 10)).toBeUndefined();
  });
});
