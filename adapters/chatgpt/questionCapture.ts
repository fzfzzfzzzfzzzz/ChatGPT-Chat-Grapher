import type { CapturedQuestion, MessageLocator } from "../../types/domain";
import type { LocateQuestionMethod } from "../../shared/messages";
import { getConversationMetaFromPage } from "./getConversation";
import { CHATGPT_SELECTORS } from "./selectors";

const TURN_CONTAINER_SELECTOR = "section[data-turn-id], article";
const HISTORY_SCAN_DELAY_MS = 100;
const HISTORY_SCAN_MAX_STEPS = 120;
const HISTORY_SCAN_STALL_LIMIT = 3;

export function getLatestCapturedQuestion(root: ParentNode = document): CapturedQuestion | undefined {
  return getCapturedQuestions(root).at(-1);
}

export function getCapturedQuestions(root: ParentNode = document): CapturedQuestion[] {
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

export async function getAllCapturedQuestions(
  root: ParentNode = document,
): Promise<CapturedQuestion[]> {
  let collected = getCapturedQuestions(root);
  if (!collected.length || typeof window === "undefined") return collected;

  const scrollContainer = findConversationScrollContainer(root);
  if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 1) {
    return collected;
  }

  const originalScrollTop = scrollContainer.scrollTop;
  const originalScrollableHeight = Math.max(
    1,
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
  );
  const originalScrollRatio = originalScrollTop / originalScrollableHeight;
  const wasNearBottom = originalScrollableHeight - originalScrollTop < 120;
  const seen = new Set(collected.map(capturedQuestionIdentity));
  let stalledSteps = 0;

  try {
    for (let step = 0; step < HISTORY_SCAN_MAX_STEPS; step += 1) {
      const beforeTop = scrollContainer.scrollTop;
      const distance = Math.max(480, Math.floor(scrollContainer.clientHeight * 0.8));
      scrollContainer.scrollTop = Math.max(0, beforeTop - distance);
      await waitForHistoryRender();

      const currentWindow = getCapturedQuestions(root);
      const unseen = currentWindow.filter((question) => {
        const identity = capturedQuestionIdentity(question);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
      if (unseen.length) collected = [...unseen, ...collected];

      const afterTop = scrollContainer.scrollTop;
      const didNotMove = Math.abs(afterTop - beforeTop) < 1;
      if (!unseen.length && (didNotMove || afterTop <= 1)) stalledSteps += 1;
      else stalledSteps = 0;
      if (stalledSteps >= HISTORY_SCAN_STALL_LIMIT) break;
    }
  } finally {
    const scrollableHeight = Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.clientHeight,
    );
    scrollContainer.scrollTop = wasNearBottom
      ? scrollableHeight
      : Math.round(scrollableHeight * originalScrollRatio);
  }

  return reindexCapturedQuestions(collected);
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

export async function locateQuestionMessageWithHistory(
  messageId: string,
  messageAnchor?: string,
  messageLocator?: MessageLocator,
  root: ParentNode = document,
): Promise<LocateQuestionMethod | undefined> {
  const immediate = locateQuestionMessage(messageId, messageAnchor, messageLocator, root) ??
    locateQuestionByFingerprint(messageAnchor, messageLocator, root);
  if (immediate) return immediate;
  if (typeof window === "undefined") return undefined;

  const scrollContainer = findConversationScrollContainer(root);
  if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 1) {
    return undefined;
  }

  const originalScrollTop = scrollContainer.scrollTop;
  const originalScrollableHeight = Math.max(
    1,
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
  );
  const originalScrollRatio = originalScrollTop / originalScrollableHeight;
  let located: LocateQuestionMethod | undefined;

  const scan = async (direction: -1 | 1) => {
    let stalledSteps = 0;
    for (let step = 0; step < HISTORY_SCAN_MAX_STEPS; step += 1) {
      const beforeTop = scrollContainer.scrollTop;
      const distance = Math.max(480, Math.floor(scrollContainer.clientHeight * 0.8));
      const scrollableHeight = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
      scrollContainer.scrollTop = Math.min(
        scrollableHeight,
        Math.max(0, beforeTop + direction * distance),
      );
      await waitForHistoryRender();

      located = locateQuestionMessage(messageId, messageAnchor, messageLocator, root) ??
        locateQuestionByFingerprint(messageAnchor, messageLocator, root);
      if (located) return;

      const afterTop = scrollContainer.scrollTop;
      const latestScrollableHeight = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
      const atBoundary = direction < 0
        ? afterTop <= 1
        : latestScrollableHeight - afterTop <= 1;
      if (Math.abs(afterTop - beforeTop) < 1 || atBoundary) stalledSteps += 1;
      else stalledSteps = 0;
      if (stalledSteps >= HISTORY_SCAN_STALL_LIMIT) return;
    }
  };

  try {
    await scan(-1);
    if (!located) {
      const scrollableHeight = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
      scrollContainer.scrollTop = Math.round(scrollableHeight * originalScrollRatio);
      await waitForHistoryRender();
      await scan(1);
    }
    return located;
  } finally {
    if (!located) {
      const scrollableHeight = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
      scrollContainer.scrollTop = Math.round(scrollableHeight * originalScrollRatio);
    }
  }
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

function findConversationScrollContainer(root: ParentNode): Element | undefined {
  const latestMessage = getUserMessages(root).at(-1);
  if (!latestMessage) return undefined;
  let current = latestMessage.parentElement;
  while (current) {
    const overflowY = typeof getComputedStyle === "function"
      ? getComputedStyle(current).overflowY
      : "";
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight + 1
    ) return current;
    current = current.parentElement;
  }
  if (root === document) return document.scrollingElement ?? undefined;
  return undefined;
}

function capturedQuestionIdentity(captured: CapturedQuestion): string {
  const messageId = stableMessageId(captured.messageLocator?.messageId) ??
    stableMessageId(captured.messageId);
  if (messageId) return `message:${messageId}`;
  if (captured.messageLocator?.turnId) return `turn:${captured.messageLocator.turnId}`;
  return `fallback:${fingerprintMessageText(captured.question)}`;
}

function reindexCapturedQuestions(questions: CapturedQuestion[]): CapturedQuestion[] {
  return questions.map((captured, ordinal) => {
    const fingerprint = fingerprintMessageText(captured.question);
    const messageAnchor = `user:${ordinal}:${fingerprint}`;
    const messageLocator: MessageLocator = {
      version: 1,
      ordinal,
      fingerprint,
      ...(captured.messageLocator?.messageId
        ? { messageId: captured.messageLocator.messageId }
        : {}),
      ...(captured.messageLocator?.turnId ? { turnId: captured.messageLocator.turnId } : {}),
    };
    return {
      ...captured,
      messageId: messageLocator.messageId || messageLocator.turnId || messageAnchor,
      messageAnchor,
      messageLocator,
    };
  });
}

function waitForHistoryRender(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, HISTORY_SCAN_DELAY_MS));
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

function locateQuestionByFingerprint(
  messageAnchor: string | undefined,
  messageLocator: MessageLocator | undefined,
  root: ParentNode,
): LocateQuestionMethod | undefined {
  const anchor = locatorAnchor(messageLocator, messageAnchor);
  if (!anchor) return undefined;
  const target = getUserMessages(root).find((element) =>
    fingerprintMessageText(normalizeMessageText(element.innerText)) === anchor.fingerprint
  );
  return target ? revealQuestionMessage(target, "anchor") : undefined;
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
