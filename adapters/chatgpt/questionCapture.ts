import type {
  CapturedQuestion,
  MessageLocator,
  QuestionReference,
  ReferenceLocator,
} from "../../types/domain";
import type { LocateQuestionMethod, LocateQuestionResponse } from "../../shared/messages";
import { getConversationMetaFromPage } from "./getConversation";
import { extractQuestionReferences } from "./referenceCapture";
import { CHATGPT_SELECTORS } from "./selectors";

const TURN_CONTAINER_SELECTOR = "section[data-turn-id], article";
const HISTORY_SCAN_DELAY_MS = 100;
const HISTORY_SCAN_MAX_STEPS = 120;
const HISTORY_SCAN_STALL_LIMIT = 3;
const MAX_ASSISTANT_CONTEXT_LENGTH = 6_000;

export function getLatestCapturedQuestion(root: ParentNode = document): CapturedQuestion | undefined {
  return getCapturedQuestions(root).at(-1);
}

export function getCapturedQuestions(root: ParentNode = document): CapturedQuestion[] {
  const messages = getUserMessages(root);
  const meta = getConversationMetaFromPage();
  if (!meta) return [];

  return messages.flatMap((element, ordinal) => {
    const question = messageQuestionText(element);
    if (!question) return [];
    const fingerprint = fingerprintMessageText(question);
    const messageAnchor = `user:${ordinal}:${fingerprint}`;
    const messageLocator = buildMessageLocator(element, ordinal, fingerprint);
    const references = extractQuestionReferences(element, meta.chatId, messageLocator);
    return [{
      question,
      chatId: meta.chatId,
      messageId: messageLocator.messageId || messageLocator.turnId || messageAnchor,
      ...(references.length ? { references } : {}),
      messageAnchor,
      messageLocator,
      ...(meta.conversationTitle ? { conversationTitle: meta.conversationTitle } : {}),
    }];
  });
}

export function getCapturedQuestionFromElement(
  element: HTMLElement,
  root: ParentNode = document,
): CapturedQuestion | undefined {
  const messages = getUserMessages(root);
  const ordinal = messages.indexOf(element);
  const meta = getConversationMetaFromPage();
  if (ordinal < 0 || !meta) return undefined;

  const question = messageQuestionText(element);
  if (!question) return undefined;
  const fingerprint = fingerprintMessageText(question);
  const messageAnchor = `user:${ordinal}:${fingerprint}`;
  const messageLocator = buildMessageLocator(element, ordinal, fingerprint);
  const assistantContext = getAssistantContextForQuestion(element, root);
  const references = extractQuestionReferences(element, meta.chatId, messageLocator);

  return {
    question,
    chatId: meta.chatId,
    messageId: messageLocator.messageId || messageLocator.turnId || messageAnchor,
    ...(assistantContext ? { assistantContext } : {}),
    ...(references.length ? { references } : {}),
    messageAnchor,
    messageLocator,
    ...(meta.conversationTitle ? { conversationTitle: meta.conversationTitle } : {}),
  };
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
    fingerprintMessageText(messageQuestionText(element)) === anchor.fingerprint
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

export async function locateQuestionOnCurrentPage(
  request: {
    chatId: string;
    messageId: string;
    messageAnchor?: string;
    messageLocator?: MessageLocator;
  },
  currentChatId: string | undefined,
  root: ParentNode = document,
): Promise<LocateQuestionResponse> {
  if (!getUserMessages(root).length) {
    return {
      ok: false,
      code: "CONVERSATION_UNAVAILABLE",
      error: "页面没有加载到会话内容。",
    };
  }

  const method = await locateQuestionMessageWithHistory(
    request.messageId,
    request.messageAnchor,
    request.messageLocator,
    root,
  );
  if (method) return { ok: true, method };
  if (currentChatId !== request.chatId) {
    return {
      ok: false,
      code: "WRONG_CONVERSATION",
      error: "当前页面没有找到该问题。",
    };
  }
  return {
    ok: false,
    code: "MESSAGE_NOT_FOUND",
    error: "已扫描当前会话，但没有找到原问题。",
  };
}

export async function locateQuestionReferenceOnCurrentPage(
  reference: QuestionReference & { sourceLocator: ReferenceLocator },
  currentChatId: string | undefined,
  root: ParentNode = document,
): Promise<LocateQuestionResponse> {
  const { sourceLocator } = reference;
  if (!getAuthoredMessages(root, sourceLocator.role).length) {
    return {
      ok: false,
      code: "CONVERSATION_UNAVAILABLE",
      error: sourceLocator.role === "assistant"
        ? "页面没有加载到对应的回答内容。"
        : "页面没有加载到对应的问题内容。",
    };
  }
  const method = await locateReferenceMessageWithHistory(reference, root);
  if (method) return { ok: true, method };
  if (currentChatId !== sourceLocator.chatId) {
    return {
      ok: false,
      code: "WRONG_CONVERSATION",
      error: "当前页面没有找到该引用来源。",
    };
  }
  return {
    ok: false,
    code: "MESSAGE_NOT_FOUND",
    error: "已扫描当前会话，但没有找到引用的原消息。",
  };
}

function locateReferenceMessage(
  reference: QuestionReference & { sourceLocator: ReferenceLocator },
  root: ParentNode,
): LocateQuestionMethod | undefined {
  const { sourceLocator } = reference;
  if (sourceLocator.messageId) {
    const target = findAuthoredMessageByAttribute(
      root,
      sourceLocator.role,
      "data-message-id",
      sourceLocator.messageId,
    );
    if (target) return revealQuestionMessage(target, "messageId");
  }
  if (sourceLocator.turnId) {
    const target = findAuthoredMessageByAttribute(
      root,
      sourceLocator.role,
      "data-turn-id",
      sourceLocator.turnId,
    );
    if (target) return revealQuestionMessage(target, "turnId");
  }
  const messages = getAuthoredMessages(root, sourceLocator.role);
  if (sourceLocator.ordinal !== undefined) {
    const target = messages[sourceLocator.ordinal];
    if (target && matchesReferenceTarget(target, reference)) {
      return revealQuestionMessage(target, "anchor");
    }
  }
  const target = messages.find((message) => matchesReferenceTarget(message, reference));
  return target ? revealQuestionMessage(target, "anchor") : undefined;
}

async function locateReferenceMessageWithHistory(
  reference: QuestionReference & { sourceLocator: ReferenceLocator },
  root: ParentNode,
): Promise<LocateQuestionMethod | undefined> {
  const immediate = locateReferenceMessage(reference, root);
  if (immediate || typeof window === "undefined") return immediate;
  const scrollContainer = findConversationScrollContainer(root);
  if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 1) {
    return undefined;
  }
  const originalScrollTop = scrollContainer.scrollTop;
  const originalScrollableHeight = Math.max(1, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  const originalScrollRatio = originalScrollTop / originalScrollableHeight;
  let located: LocateQuestionMethod | undefined;
  const scan = async (direction: -1 | 1) => {
    let stalledSteps = 0;
    for (let step = 0; step < HISTORY_SCAN_MAX_STEPS; step += 1) {
      const beforeTop = scrollContainer.scrollTop;
      const distance = Math.max(480, Math.floor(scrollContainer.clientHeight * 0.8));
      const scrollableHeight = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      scrollContainer.scrollTop = Math.min(
        scrollableHeight,
        Math.max(0, beforeTop + direction * distance),
      );
      await waitForHistoryRender();
      located = locateReferenceMessage(reference, root);
      if (located) return;
      const afterTop = scrollContainer.scrollTop;
      const latestScrollableHeight = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
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
      const scrollableHeight = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      scrollContainer.scrollTop = Math.round(scrollableHeight * originalScrollRatio);
      await waitForHistoryRender();
      await scan(1);
    }
    return located;
  } finally {
    if (!located) {
      const scrollableHeight = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      scrollContainer.scrollTop = Math.round(scrollableHeight * originalScrollRatio);
    }
  }
}

function matchesReferenceTarget(
  message: HTMLElement,
  reference: QuestionReference & { sourceLocator: ReferenceLocator },
): boolean {
  const text = normalizeMessageText(message.innerText);
  if (reference.type === "assistant_quote") {
    const excerpt = normalizeMessageText(reference.excerpt);
    if (excerpt.length >= 12 && text.includes(excerpt.slice(0, Math.min(120, excerpt.length)))) {
      return true;
    }
  }
  return Boolean(
    reference.sourceLocator.fingerprint &&
    fingerprintMessageText(text) === reference.sourceLocator.fingerprint,
  );
}

function getAuthoredMessages(
  root: ParentNode,
  role: ReferenceLocator["role"],
): HTMLElement[] {
  const selector = role === "assistant"
    ? CHATGPT_SELECTORS.assistantMessage
    : CHATGPT_SELECTORS.userMessage;
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

function findAuthoredMessageByAttribute(
  root: ParentNode,
  role: ReferenceLocator["role"],
  attribute: "data-message-id" | "data-turn-id",
  value: string,
): HTMLElement | undefined {
  const selector = role === "assistant"
    ? CHATGPT_SELECTORS.assistantMessage
    : CHATGPT_SELECTORS.userMessage;
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`));
  const matched = candidates.find((element) => element.getAttribute(attribute) === value);
  if (!matched) return undefined;
  if (matched.matches(selector)) return matched;
  return matched.querySelector<HTMLElement>(selector) ??
    matched.closest<HTMLElement>(selector) ??
    undefined;
}

function getAssistantContextForQuestion(
  selectedQuestion: HTMLElement,
  root: ParentNode,
): string | undefined {
  const authoredMessages = Array.from(root.querySelectorAll<HTMLElement>(
    `${CHATGPT_SELECTORS.userMessage}, ${CHATGPT_SELECTORS.assistantMessage}`,
  ));
  const questionIndex = authoredMessages.indexOf(selectedQuestion);
  if (questionIndex < 0) return undefined;

  const answerParts: string[] = [];
  for (const message of authoredMessages.slice(questionIndex + 1)) {
    if (message.matches(CHATGPT_SELECTORS.userMessage)) break;
    if (!message.matches(CHATGPT_SELECTORS.assistantMessage)) continue;
    const text = normalizeMessageText(message.innerText);
    if (text) answerParts.push(text);
  }
  const answer = answerParts.join("\n\n");
  if (!answer) return undefined;
  if (answer.length <= MAX_ASSISTANT_CONTEXT_LENGTH) return answer;

  const marker = "\n…\n";
  const tailLength = 1_500;
  const headLength = MAX_ASSISTANT_CONTEXT_LENGTH - marker.length - tailLength;
  return `${answer.slice(0, headLength)}${marker}${answer.slice(-tailLength)}`;
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
      ...(captured.references
        ? {
            references: captured.references.map((reference) =>
              reference.sourceLocator?.role === "user"
                ? {
                    ...reference,
                    sourceLocator: {
                      version: 1 as const,
                      chatId: captured.chatId,
                      role: "user" as const,
                      ...(messageLocator.messageId ? { messageId: messageLocator.messageId } : {}),
                      ...(messageLocator.turnId ? { turnId: messageLocator.turnId } : {}),
                      ordinal,
                      fingerprint,
                    },
                  }
                : reference,
            ),
          }
        : {}),
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
    fingerprintMessageText(messageQuestionText(element)) === fingerprint
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
    fingerprintMessageText(messageQuestionText(element)) === anchor.fingerprint
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

function messageQuestionText(element: HTMLElement): string {
  const visibleText = questionTextWithoutReferences(element);
  if (visibleText) return visibleText;
  const labels: string[] = [];
  const seen = new Set<string>();
  const add = (label: string) => {
    const normalized = normalizeMessageText(label);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    labels.push(normalized);
  };
  for (const attachment of Array.from(element.querySelectorAll<HTMLElement>(
    "[data-file-name], [data-filename], a[download]",
  ))) {
    const name = attachment.getAttribute("data-file-name") ??
      attachment.getAttribute("data-filename") ??
      attachment.getAttribute("download");
    if (name) add(`附件：${name}`);
  }
  for (const image of Array.from(element.querySelectorAll<HTMLImageElement>("img"))) {
    if (image.getAttribute("aria-hidden") === "true") continue;
    add(`图片：${image.getAttribute("data-file-name") || image.alt || "未命名图片"}`);
  }
  for (const quote of Array.from(element.querySelectorAll<HTMLElement>(
    'blockquote, [data-testid*="quote" i], [data-quoted-message-id], [data-source-message-id]',
  ))) {
    const excerpt = normalizeMessageText(quote.innerText).slice(0, 80);
    if (excerpt) add(`引用回答：${excerpt}`);
  }
  return labels.join("；");
}

function questionTextWithoutReferences(element: HTMLElement): string {
  const originalText = normalizeMessageText(element.innerText);
  if (typeof element.cloneNode !== "function") return originalText;
  try {
    const clone = element.cloneNode(true) as HTMLElement;
    const referenceSelector = [
      "blockquote",
      "a[download]",
      "[data-file-name]",
      "[data-filename]",
      '[data-testid*="attachment" i]',
      '[data-testid*="quote" i]',
      "[data-quoted-message-id]",
      "[data-source-message-id]",
    ].join(",");
    const references = Array.from(clone.querySelectorAll(referenceSelector));
    if (!references.length) return originalText;
    references.forEach((reference) => reference.remove());
    return normalizeMessageText(clone.innerText || clone.textContent || undefined);
  } catch {
    return originalText;
  }
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
