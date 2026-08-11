import type { CapturedQuestion, MessageLocator } from "../../types/domain";
import type { LocateQuestionMethod } from "../../shared/messages";
import { getConversationMetaFromPage } from "./getConversation";
import { CHATGPT_SELECTORS } from "./selectors";

const TURN_CONTAINER_SELECTOR = "section[data-turn-id], article";
export function getLatestCapturedQuestion(root: ParentNode = document): CapturedQuestion | undefined {
  return getCapturedQuestions(root).at(-1);
}

function getCapturedQuestions(root: ParentNode = document): CapturedQuestion[] {
  const messages = getUserMessages(root);
  const meta = getConversationMetaFromPage();
  if (!meta) return [];

  return messages.flatMap((element, ordinal) => {
    const question = normalizeMessageText(element.innerText);
    if (!question) return [];
    const fingerprint = fingerprintMessageText(question);
    const messageAnchor = `user:${ordinal}:${fingerprint}`;
    const messageLocator = buildMessageLocator(element, ordinal, fingerprint);
    return [{
      question,
      chatId: meta.chatId,
      messageId: messageLocator.messageId || messageLocator.turnId || messageAnchor,
      messageAnchor,
      messageLocator,
      ...(meta.conversationTitle ? { conversationTitle: meta.conversationTitle } : {}),
    }];
  });
}

export function locateQuestionMessage(
  messageId: string,
  messageAnchor?: string,
  messageLocator?: MessageLocator,
  root: ParentNode = document,
): LocateQuestionMethod | undefined {
  const exactMessageId = stableMessageId(messageLocator?.messageId);
  if (exactMessageId) {
    const target = findUserMessageByAttribute(root, "data-message-id", exactMessageId);
    if (target) return revealQuestionMessage(target, "messageId");
  }

  if (messageLocator?.turnId) {
    const target = findUserMessageByAttribute(root, "data-turn-id", messageLocator.turnId);
    if (target) return revealQuestionMessage(target, "turnId");
  }

  const legacyMessageId = stableMessageId(messageId);
  if (legacyMessageId && legacyMessageId !== exactMessageId) {
    const target = findUserMessageByAttribute(root, "data-message-id", legacyMessageId);
    if (target) return revealQuestionMessage(target, "legacyMessageId");
  }

  const anchor = locatorAnchor(messageLocator, messageAnchor);
  if (!anchor) return undefined;
  const messages = getUserMessages(root);
  const target = messages.find((element, index) =>
    index === anchor.ordinal &&
    fingerprintMessageText(normalizeMessageText(element.innerText)) === anchor.fingerprint
  );
  return target ? revealQuestionMessage(target, "anchor") : undefined;
}

export function watchForRefinedMessageLocator(
  captured: CapturedQuestion,
  onRefined: (messageLocator: MessageLocator) => void,
  root: ParentNode = document,
  timeoutMs = 10_000,
): () => void {
  if (captured.messageLocator?.messageId) return () => undefined;
  const anchor = locatorAnchor(captured.messageLocator, captured.messageAnchor);
  if (!anchor) return () => undefined;
  const element = findAnchoredUserMessage(root, anchor.ordinal, anchor.fingerprint);
  if (!element) return () => undefined;
  const container = getTurnContainer(element) ?? element;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    observer.disconnect();
    clearTimeout(timeout);
  };
  const check = () => {
    const next = buildMessageLocator(element, anchor.ordinal, anchor.fingerprint);
    if (!next.messageId) return;
    finish();
    onRefined(next);
  };
  const observer = new MutationObserver(check);
  const timeout = window.setTimeout(finish, timeoutMs);
  observer.observe(container, {
    attributes: true,
    attributeFilter: ["data-message-id", "data-turn-id"],
    childList: true,
    subtree: true,
  });
  check();
  return finish;
}

export function fingerprintMessageText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildMessageLocator(
  element: HTMLElement,
  ordinal: number,
  fingerprint: string,
): MessageLocator {
  const container = getTurnContainer(element);
  const ownMessageId = element.dataset.messageId;
  const nestedMessageId = container
    ?.querySelector<HTMLElement>('[data-message-author-role="user"][data-message-id]')
    ?.dataset.messageId;
  const messageId = stableMessageId(ownMessageId || nestedMessageId);
  const turnId = container?.dataset.turnId;
  return {
    version: 1,
    ordinal,
    fingerprint,
    ...(messageId ? { messageId } : {}),
    ...(turnId ? { turnId } : {}),
  };
}

function stableMessageId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.includes("placeholder") || normalized.startsWith("user:")) {
    return undefined;
  }
  return normalized;
}

function getUserMessages(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.userMessage));
}

function getTurnContainer(element: HTMLElement): HTMLElement | undefined {
  return element.closest<HTMLElement>(TURN_CONTAINER_SELECTOR) ??
    element.closest<HTMLElement>("[data-message-id]") ??
    undefined;
}

function findUserMessageByAttribute(
  root: ParentNode,
  attribute: "data-message-id" | "data-turn-id",
  value: string,
): HTMLElement | undefined {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`));
  const matched = candidates.find((element) => element.getAttribute(attribute) === value);
  if (!matched) return undefined;
  if (matched.matches(CHATGPT_SELECTORS.userMessage)) return matched;
  return matched.querySelector<HTMLElement>(CHATGPT_SELECTORS.userMessage) ??
    matched.closest<HTMLElement>(CHATGPT_SELECTORS.userMessage) ??
    undefined;
}

function findAnchoredUserMessage(
  root: ParentNode,
  ordinal: number,
  fingerprint: string,
): HTMLElement | undefined {
  return getUserMessages(root).find((element, index) =>
    index === ordinal &&
    fingerprintMessageText(normalizeMessageText(element.innerText)) === fingerprint
  );
}

function locatorAnchor(
  locator?: MessageLocator,
  messageAnchor?: string,
): { ordinal: number; fingerprint: string } | undefined {
  if (locator && Number.isInteger(locator.ordinal) && locator.ordinal >= 0 && locator.fingerprint) {
    return { ordinal: locator.ordinal, fingerprint: locator.fingerprint };
  }
  const parts = messageAnchor?.split(":");
  if (parts?.[0] !== "user") return undefined;
  const ordinal = Number(parts[1]);
  const fingerprint = parts[2];
  return Number.isInteger(ordinal) && ordinal >= 0 && fingerprint
    ? { ordinal, fingerprint }
    : undefined;
}

function normalizeMessageText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function revealQuestionMessage(
  target: HTMLElement,
  method: LocateQuestionMethod,
): LocateQuestionMethod {
  const highlight = target.closest<HTMLElement>(TURN_CONTAINER_SELECTOR) ?? target;
  highlight.scrollIntoView({ behavior: "smooth", block: "center" });
  highlight.animate(
    [
      { outline: "0 solid rgba(37, 99, 235, 0)", backgroundColor: "transparent" },
      { outline: "4px solid rgba(37, 99, 235, .35)", backgroundColor: "rgba(219, 234, 254, .45)" },
      { outline: "0 solid rgba(37, 99, 235, 0)", backgroundColor: "transparent" },
    ],
    { duration: 1800, easing: "ease-out" },
  );
  return method;
}
