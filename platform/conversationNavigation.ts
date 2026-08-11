import { getConversationId } from "../adapters/chatgpt/getConversation";

export type ConversationTabCandidate = {
  id?: number | undefined;
  windowId?: number | undefined;
  active?: boolean | undefined;
  url?: string | undefined;
};

export function selectExistingConversationTab<T extends ConversationTabCandidate>(
  tabs: T[],
  chatId: string,
  sourceWindowId?: number,
): T | undefined {
  const matches = tabs.filter((tab) => tab.url && getConversationId(tab.url) === chatId);
  if (!matches.length) return undefined;
  return matches.find((tab) => tab.windowId === sourceWindowId && tab.active) ??
    matches.find((tab) => tab.windowId === sourceWindowId) ??
    matches.find((tab) => tab.active) ??
    matches[0];
}
