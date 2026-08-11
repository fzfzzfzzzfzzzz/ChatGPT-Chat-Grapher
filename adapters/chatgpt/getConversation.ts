import { browser } from "wxt/browser";
import type { ConversationMeta } from "../../types/domain";

const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

export function getConversationId(value: string | URL): string | undefined {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    if (!CHATGPT_HOSTS.has(url.hostname)) return undefined;
    const segments = url.pathname.split("/").filter(Boolean);
    const conversationMarker = segments.lastIndexOf("c");
    return conversationMarker >= 0 ? segments[conversationMarker + 1] : undefined;
  } catch {
    return undefined;
  }
}

export function isChatConversationUrl(value: string | URL): boolean {
  return Boolean(getConversationId(value));
}

function cleanTitle(title: string | undefined): string | undefined {
  const cleaned = title?.replace(/\s*[|–—-]\s*(ChatGPT|OpenAI)\s*$/i, "").trim();
  if (!cleaned || /^(ChatGPT|OpenAI)$/i.test(cleaned)) return undefined;
  return cleaned;
}

function metaFromUrl(value: string, title?: string): ConversationMeta | undefined {
  const url = new URL(value);
  const chatId = getConversationId(url);
  if (!chatId) return undefined;
  url.hash = "";
  url.search = "";
  const conversationTitle = cleanTitle(title);
  return {
    chatId,
    conversationUrl: url.toString(),
    ...(conversationTitle ? { conversationTitle } : {}),
  };
}

export async function getActiveConversation(): Promise<ConversationMeta | undefined> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.url ? metaFromUrl(tab.url, tab.title) : undefined;
  } catch {
    return undefined;
  }
}

export function getConversationMetaFromPage(): ConversationMeta | undefined {
  try {
    return metaFromUrl(location.href, document.title);
  } catch {
    return undefined;
  }
}

export function conversationUrlForChat(chatId: string): string {
  return `https://chatgpt.com/c/${encodeURIComponent(chatId)}`;
}
