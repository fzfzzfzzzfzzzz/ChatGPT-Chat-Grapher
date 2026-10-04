import type {
  ConversationReviewMessage,
  ReferenceLocator,
  ReviewCaptureReport,
} from "../../types/domain";
import { getConversationMetaFromPage } from "./getConversation";
import { fingerprintMessageText } from "./questionCapture";
import { CHATGPT_SELECTORS } from "./selectors";

const AUTHORED_MESSAGE_SELECTOR = [
  CHATGPT_SELECTORS.userMessage,
  CHATGPT_SELECTORS.assistantMessage,
].join(", ");
const TURN_CONTAINER_SELECTOR = "section[data-turn-id], article[data-turn-id], [data-turn-id]";
const PLUGIN_UI_SELECTOR = [
  ".chat-graph-panel",
  "[data-chat-graph-ui]",
  "[data-chat-graph-root]",
  "[data-chat-graph-ignore-capture]",
].join(", ");
const INACTIVE_CONTENT_SELECTOR = [
  "[hidden]",
  "[aria-hidden=\"true\"]",
  "[inert]",
  "[data-state=\"inactive\"]",
  "[data-visible=\"false\"]",
  "[data-is-visible=\"false\"]",
].join(", ");

const DEFAULT_RENDER_DELAY_MS = 100;
const DEFAULT_MAX_STEPS = 120;
const DEFAULT_MAX_DURATION_MS = 12_000;
const DEFAULT_STALL_LIMIT = 3;

export type ConversationCaptureOptions = {
  /** Maximum scroll mutations across both scan directions. */
  maxSteps?: number;
  /** Wall-clock budget for the full scan. */
  maxDurationMs?: number;
  /** Delay after each scroll mutation so virtualized rows can render. */
  renderDelayMs?: number;
  /** Consecutive no-progress attempts before treating virtualization as stalled. */
  stallLimit?: number;
};

type CapturedRecord = {
  identity: string;
  role: ReferenceLocator["role"];
  content: string;
  messageId?: string;
  turnId?: string;
  fingerprint: string;
};

type ScanOutcome = "boundary" | "scan_limit" | "virtualization_stalled";

/**
 * Capture only the messages currently mounted in the conversation DOM.
 *
 * This is intentionally synchronous so callers can render a fast scope preview.
 * A scrollable conversation is reported as incomplete until
 * {@link captureFullConversation} has verified both virtualized boundaries.
 */
export function captureConversationWindow(
  root: ParentNode = document,
): ReviewCaptureReport {
  const meta = getConversationMetaFromPage();
  if (!meta) return sourceUnavailableReport();

  const records = captureMountedRecords(root);
  if (!records.length) return sourceUnavailableReport(meta.chatId, meta.conversationTitle);

  const scrollContainer = findConversationScrollContainer(root, records.length);
  const complete = !isScrollable(scrollContainer);
  return buildReport(
    meta.chatId,
    meta.conversationTitle,
    records,
    complete,
  );
}

/**
 * Scan upward and downward through ChatGPT's mounted conversation windows.
 * Only the active DOM branch is inspected; alternate native branches that are
 * not mounted/visible are neither collected nor reported as captured.
 */
export async function captureFullConversation(
  root: ParentNode = document,
  options: ConversationCaptureOptions = {},
): Promise<ReviewCaptureReport> {
  const meta = getConversationMetaFromPage();
  if (!meta) return sourceUnavailableReport();

  const initial = captureMountedRecords(root);
  if (!initial.length) return sourceUnavailableReport(meta.chatId, meta.conversationTitle);

  const scrollContainer = findConversationScrollContainer(root, initial.length);
  if (!isScrollable(scrollContainer)) {
    return buildReport(meta.chatId, meta.conversationTitle, initial, true);
  }

  const maxSteps = nonNegativeInteger(options.maxSteps, DEFAULT_MAX_STEPS);
  const maxDurationMs = nonNegativeNumber(options.maxDurationMs, DEFAULT_MAX_DURATION_MS);
  const renderDelayMs = nonNegativeNumber(options.renderDelayMs, DEFAULT_RENDER_DELAY_MS);
  const stallLimit = positiveInteger(options.stallLimit, DEFAULT_STALL_LIMIT);
  const startedAt = Date.now();
  let steps = 0;

  const recordsByIdentity = new Map(initial.map((record) => [record.identity, record]));
  let orderedIdentities = initial.map((record) => record.identity);

  const originalScrollTop = scrollContainer.scrollTop;
  const originalScrollableHeight = Math.max(
    1,
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
  );
  const originalRatio = originalScrollTop / originalScrollableHeight;
  const wasNearBottom = originalScrollableHeight - originalScrollTop <= 120;

  const budgetExhausted = () =>
    steps >= maxSteps || Date.now() - startedAt >= maxDurationMs;

  const collectMountedWindow = (direction: -1 | 1): boolean => {
    const mounted = captureMountedRecords(root);
    let changed = false;
    for (const record of mounted) {
      const previous = recordsByIdentity.get(record.identity);
      if (!previous || previous.content !== record.content) changed = true;
      recordsByIdentity.set(record.identity, preferRecord(record, previous));
    }
    const nextOrder = mergeMountedOrder(
      orderedIdentities,
      mounted.map((record) => record.identity),
      direction,
    );
    if (nextOrder.length !== orderedIdentities.length) changed = true;
    orderedIdentities = nextOrder;
    return changed;
  };

  const scan = async (direction: -1 | 1): Promise<ScanOutcome> => {
    let stalledSteps = 0;
    while (!budgetExhausted()) {
      const beforeTop = scrollContainer.scrollTop;
      const beforeScrollableHeight = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
      const distance = Math.max(480, Math.floor(scrollContainer.clientHeight * 0.8));
      const target = Math.min(
        beforeScrollableHeight,
        Math.max(0, beforeTop + direction * distance),
      );
      scrollContainer.scrollTop = target;
      steps += 1;
      await waitForRender(renderDelayMs);

      const changed = collectMountedWindow(direction);
      const afterTop = scrollContainer.scrollTop;
      const afterScrollableHeight = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
      const atBoundary = direction < 0
        ? afterTop <= 1
        : afterScrollableHeight - afterTop <= 1;
      const moved = Math.abs(afterTop - beforeTop) >= 1 ||
        Math.abs(afterScrollableHeight - beforeScrollableHeight) >= 1;

      // A boundary is trusted only after one render pass finds no additional
      // rows there. This gives lazy history loading a chance to extend the list.
      if (atBoundary && !changed) return "boundary";

      if (!changed && !moved) stalledSteps += 1;
      else stalledSteps = 0;
      if (stalledSteps >= stallLimit) return "virtualization_stalled";
    }
    return "scan_limit";
  };

  let upward: ScanOutcome = "scan_limit";
  let downward: ScanOutcome = "scan_limit";
  try {
    upward = await scan(-1);

    if (!budgetExhausted()) {
      restoreScrollPosition(
        scrollContainer,
        originalRatio,
        wasNearBottom,
      );
      await waitForRender(renderDelayMs);
      collectMountedWindow(1);
      downward = await scan(1);
    }
  } finally {
    restoreScrollPosition(scrollContainer, originalRatio, wasNearBottom);
  }

  const records = orderedIdentities.flatMap((identity) => {
    const record = recordsByIdentity.get(identity);
    return record ? [record] : [];
  });
  const complete = upward === "boundary" && downward === "boundary";
  const stoppedReason = complete
    ? undefined
    : upward === "scan_limit" || downward === "scan_limit"
      ? "scan_limit" as const
      : "virtualization_stalled" as const;

  return buildReport(
    meta.chatId,
    meta.conversationTitle,
    records,
    complete,
    stoppedReason,
  );
}

/** Semantic alias used by review UI code that describes the operation as history capture. */
export const captureConversationHistory = captureFullConversation;

function captureMountedRecords(root: ParentNode): CapturedRecord[] {
  const authored = Array.from(root.querySelectorAll<HTMLElement>(AUTHORED_MESSAGE_SELECTOR));
  const fallbackOccurrences = new Map<string, number>();

  return authored.flatMap((element) => {
    if (!isCapturableMessage(element)) return [];
    const role = messageRole(element);
    if (!role) return [];
    const content = messageText(element);
    if (!content) return [];

    const fingerprint = fingerprintMessageText(content);
    const messageId = stableDomId(element.dataset?.messageId) ??
      stableDomId(element.getAttribute?.("data-message-id") ?? undefined);
    const turn = closestElement(element, TURN_CONTAINER_SELECTOR);
    const turnId = stableDomId(turn?.dataset?.turnId) ??
      stableDomId(turn?.getAttribute("data-turn-id") ?? undefined);
    const fallbackBase = `${role}:fingerprint:${fingerprint}`;
    const occurrence = fallbackOccurrences.get(fallbackBase) ?? 0;
    fallbackOccurrences.set(fallbackBase, occurrence + 1);
    const identity = messageId
      ? `${role}:message:${messageId}`
      : turnId
        ? `${role}:turn:${turnId}`
        : `${fallbackBase}:occurrence:${occurrence}`;

    return [{
      identity,
      role,
      content,
      fingerprint,
      ...(messageId ? { messageId } : {}),
      ...(turnId ? { turnId } : {}),
    }];
  });
}

function buildReport(
  chatId: string,
  conversationTitle: string | undefined,
  records: CapturedRecord[],
  complete: boolean,
  stoppedReason?: ReviewCaptureReport["stoppedReason"],
): ReviewCaptureReport {
  const messages = records.map((record, ordinal) => toReviewMessage(record, chatId, ordinal));
  return {
    chatId,
    ...(conversationTitle ? { conversationTitle } : {}),
    messages,
    complete,
    missingSourceIds: [],
    ...(stoppedReason ? { stoppedReason } : {}),
  };
}

function sourceUnavailableReport(
  chatId = "",
  conversationTitle?: string,
): ReviewCaptureReport {
  return {
    chatId,
    ...(conversationTitle ? { conversationTitle } : {}),
    messages: [],
    complete: false,
    missingSourceIds: [],
    stoppedReason: "source_unavailable",
  };
}

function toReviewMessage(
  record: CapturedRecord,
  chatId: string,
  ordinal: number,
): ConversationReviewMessage {
  const locator: ReferenceLocator = {
    version: 1,
    chatId,
    role: record.role,
    ordinal,
    fingerprint: record.fingerprint,
    ...(record.messageId ? { messageId: record.messageId } : {}),
    ...(record.turnId ? { turnId: record.turnId } : {}),
  };
  return {
    sourceId: buildSourceId(locator),
    chatId,
    role: record.role,
    content: record.content,
    ordinal,
    locator,
  };
}

function buildSourceId(locator: ReferenceLocator): string {
  const parts = [
    locator.role,
    locator.messageId ? `message:${encodeURIComponent(locator.messageId)}` : undefined,
    locator.turnId ? `turn:${encodeURIComponent(locator.turnId)}` : undefined,
    `ordinal:${locator.ordinal ?? 0}`,
    `fingerprint:${locator.fingerprint ?? ""}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join("/");
}

function messageRole(element: HTMLElement): ReferenceLocator["role"] | undefined {
  const value = element.dataset?.messageAuthorRole ??
    element.getAttribute?.("data-message-author-role") ??
    undefined;
  if (value === "user" || value === "assistant") return value;
  try {
    if (element.matches(CHATGPT_SELECTORS.userMessage)) return "user";
    if (element.matches(CHATGPT_SELECTORS.assistantMessage)) return "assistant";
  } catch {
    // Non-browser test doubles may expose only attributes.
  }
  return undefined;
}

function isCapturableMessage(element: HTMLElement): boolean {
  if (closestElement(element, PLUGIN_UI_SELECTOR)) return false;
  if (closestElement(element, INACTIVE_CONTENT_SELECTOR)) return false;
  let current: HTMLElement | null = element;
  while (current) {
    if (hasInactiveStyle(current)) return false;
    current = current.parentElement;
  }
  return true;
}

function hasInactiveStyle(element: HTMLElement): boolean {
  if (element.style?.display === "none" || element.style?.visibility === "hidden") return true;
  try {
    if (typeof getComputedStyle !== "function") return false;
    const style = getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function messageText(element: HTMLElement): string {
  let source = element;
  try {
    if (typeof element.cloneNode === "function") {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll?.(PLUGIN_UI_SELECTOR).forEach((node) => node.remove());
      source = clone;
    }
  } catch {
    source = element;
  }
  return normalizeMessageText(source.innerText || source.textContent || undefined);
}

function normalizeMessageText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function stableDomId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.includes("placeholder")) return undefined;
  return normalized;
}

function closestElement(element: HTMLElement, selector: string): HTMLElement | undefined {
  try {
    return element.closest<HTMLElement>(selector) ?? undefined;
  } catch {
    return undefined;
  }
}

function preferRecord(next: CapturedRecord, previous: CapturedRecord | undefined): CapturedRecord {
  if (!previous) return next;
  return {
    ...next,
    ...(next.messageId || !previous.messageId ? {} : { messageId: previous.messageId }),
    ...(next.turnId || !previous.turnId ? {} : { turnId: previous.turnId }),
  };
}

/** Merge a virtualized DOM window into the known order around any overlap. */
function mergeMountedOrder(
  existing: string[],
  mounted: string[],
  direction: -1 | 1,
): string[] {
  if (!mounted.length) return existing;
  const uniqueMounted = mounted.filter((identity, index) => mounted.indexOf(identity) === index);
  const existingSet = new Set(existing);
  if (!uniqueMounted.some((identity) => existingSet.has(identity))) {
    return direction < 0
      ? [...uniqueMounted, ...existing]
      : [...existing, ...uniqueMounted];
  }

  const result = [...existing];
  for (let index = 0; index < uniqueMounted.length; index += 1) {
    const identity = uniqueMounted[index]!;
    if (result.includes(identity)) continue;

    const previousKnown = uniqueMounted.slice(0, index).reverse()
      .find((candidate) => result.includes(candidate));
    const nextKnown = uniqueMounted.slice(index + 1)
      .find((candidate) => result.includes(candidate));
    if (previousKnown) {
      result.splice(result.indexOf(previousKnown) + 1, 0, identity);
    } else if (nextKnown) {
      result.splice(result.indexOf(nextKnown), 0, identity);
    } else if (direction < 0) {
      result.unshift(identity);
    } else {
      result.push(identity);
    }
  }
  return result;
}

function findConversationScrollContainer(
  root: ParentNode,
  mountedMessageCount: number,
): Element | undefined {
  if (!mountedMessageCount) return undefined;
  const latestMessage = Array.from(
    root.querySelectorAll<HTMLElement>(AUTHORED_MESSAGE_SELECTOR),
  ).filter(isCapturableMessage).at(-1);
  let current = latestMessage?.parentElement;
  let scrollableFallback: Element | undefined;
  while (current) {
    if (current.scrollHeight > current.clientHeight + 1) {
      scrollableFallback ??= current;
      const overflowY = elementOverflowY(current);
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        return current;
      }
    }
    current = current.parentElement;
  }

  if (typeof document !== "undefined" && root === document) {
    const documentScroller = document.scrollingElement;
    if (documentScroller) return documentScroller;
  }
  return scrollableFallback;
}

function elementOverflowY(element: Element): string {
  try {
    if (typeof getComputedStyle === "function") return getComputedStyle(element).overflowY;
  } catch {
    // A detached/testing DOM may not support computed styles; the height fallback remains valid.
  }
  return (element as HTMLElement).style?.overflowY ?? "";
}

function isScrollable(element: Element | undefined): element is Element {
  return Boolean(element && element.scrollHeight > element.clientHeight + 1);
}

function restoreScrollPosition(
  scrollContainer: Element,
  originalRatio: number,
  wasNearBottom: boolean,
): void {
  const scrollableHeight = Math.max(
    0,
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
  );
  scrollContainer.scrollTop = wasNearBottom
    ? scrollableHeight
    : Math.round(scrollableHeight * originalRatio);
}

function waitForRender(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(resolve, delayMs);
      return;
    }
    setTimeout(resolve, delayMs);
  });
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const normalized = nonNegativeInteger(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}
