import {
  MAX_ASSISTANT_QUOTE_LENGTH,
  MAX_QUESTION_REFERENCES,
  MAX_REFERENCE_NAME_LENGTH,
  THUMBNAIL_MAX_EDGE,
  clampReferenceText,
  isAllowedThumbnailDataUrl,
} from "../../shared/questionReferences";
import type {
  MessageLocator,
  QuestionReference,
  ReferenceLocator,
} from "../../types/domain";
import { CHATGPT_SELECTORS } from "./selectors";

const REFERENCE_CANDIDATE_SELECTOR = [
  "img",
  "blockquote",
  "a[download]",
  "[data-file-name]",
  "[data-filename]",
  '[data-testid*="attachment" i]',
  '[data-testid*="file" i]',
  '[data-testid*="quote" i]',
  '[data-testid*="citation" i]',
  "[data-quoted-message-id]",
  "[data-source-message-id]",
  '[aria-label*="attachment" i]',
  '[aria-label*="file" i]',
  '[aria-label*="quote" i]',
  '[aria-label*="附件"]',
  '[aria-label*="引用"]',
].join(",");

const QUOTE_SELECTOR = [
  "blockquote",
  '[data-testid*="quote" i]',
  '[data-testid*="citation" i]',
  "[data-quoted-message-id]",
  "[data-source-message-id]",
  '[aria-label*="quote" i]',
  '[aria-label*="引用"]',
].join(",");

const FILE_NAME_PATTERN = /(?:^|[\\/\s])([^\\/\s]{1,200}\.(?:pdf|docx?|xlsx?|pptx?|txt|md|csv|json|zip|rar|7z|tar|gz|mp3|wav|mp4|mov|avi|webm|png|jpe?g|gif|webp|svg))(?:$|\s)/i;

export function extractQuestionReferences(
  message: HTMLElement,
  chatId: string,
  messageLocator: MessageLocator,
): QuestionReference[] {
  try {
    const userLocator = referenceLocator(chatId, "user", messageLocator);
    const candidates = Array.from(message.querySelectorAll<HTMLElement>(REFERENCE_CANDIDATE_SELECTOR));
    const references: QuestionReference[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      if (references.length >= MAX_QUESTION_REFERENCES) break;
      const reference = candidate.matches(QUOTE_SELECTOR)
        ? extractAssistantQuote(candidate, chatId)
        : candidate instanceof HTMLImageElement
          ? extractImage(candidate, userLocator)
          : extractFile(candidate, userLocator);
      if (!reference) continue;
      const identity = referenceIdentity(reference);
      if (seen.has(identity)) continue;
      seen.add(identity);
      references.push(reference);
    }
    return references;
  } catch {
    return [];
  }
}

function extractFile(
  element: HTMLElement,
  sourceLocator: ReferenceLocator,
): QuestionReference | undefined {
  if (element.querySelector("img") && !explicitFileName(element)) return undefined;
  const name = clampReferenceText(
    explicitFileName(element) ?? fileNameFromText(element.innerText) ?? "",
    MAX_REFERENCE_NAME_LENGTH,
  );
  if (!name) return undefined;
  const mimeType = firstAttribute(element, ["data-mime-type", "data-file-type", "type"]);
  const sizeValue = firstAttribute(element, ["data-file-size", "data-size"]);
  const size = sizeValue ? Number(sizeValue) : undefined;
  return {
    id: referenceId("file", name, sourceLocator.messageId ?? sourceLocator.turnId),
    type: "file",
    name,
    ...(mimeType ? { mimeType } : {}),
    ...(size !== undefined && Number.isFinite(size) && size >= 0 ? { size } : {}),
    sourceLocator,
  };
}

function extractImage(
  image: HTMLImageElement,
  sourceLocator: ReferenceLocator,
): QuestionReference | undefined {
  if (isDecorativeImage(image)) return undefined;
  const name = clampReferenceText(
    firstAttribute(image, ["data-file-name", "data-filename"]) ??
      firstAttribute(image.parentElement, ["data-file-name", "data-filename"]) ?? "",
    MAX_REFERENCE_NAME_LENGTH,
  );
  const alt = clampReferenceText(image.alt ?? "", MAX_REFERENCE_NAME_LENGTH);
  const thumbnailDataUrl = createThumbnailDataUrl(image);
  if (!name && !alt && !thumbnailDataUrl) return undefined;
  const label = name || alt || "image";
  return {
    id: referenceId("image", label, sourceLocator.messageId ?? sourceLocator.turnId),
    type: "image",
    ...(name ? { name } : {}),
    ...(alt ? { alt } : {}),
    ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
    sourceLocator,
  };
}

function extractAssistantQuote(
  element: HTMLElement,
  chatId: string,
): QuestionReference | undefined {
  const excerpt = clampReferenceText(element.innerText ?? "", MAX_ASSISTANT_QUOTE_LENGTH);
  if (!excerpt) return undefined;
  const source = findAssistantSource(element, excerpt);
  const sourceLocator: ReferenceLocator = {
    version: 1,
    chatId,
    role: "assistant",
    ...(source.messageId ? { messageId: source.messageId } : {}),
    ...(source.turnId ? { turnId: source.turnId } : {}),
    ...(source.ordinal !== undefined ? { ordinal: source.ordinal } : {}),
    fingerprint: fingerprintText(source.text || excerpt),
  };
  return {
    id: referenceId("assistant_quote", excerpt, sourceLocator.messageId ?? sourceLocator.turnId),
    type: "assistant_quote",
    excerpt,
    sourceLocator,
  };
}

function findAssistantSource(
  quote: HTMLElement,
  excerpt: string,
): { messageId?: string; turnId?: string; ordinal?: number; text?: string } {
  const messageId = firstAttribute(quote, [
    "data-source-message-id",
    "data-quoted-message-id",
    "data-message-id",
  ]) ?? firstDescendantAttribute(quote, [
    "data-source-message-id",
    "data-quoted-message-id",
    "data-message-id",
  ]);
  const turnId = firstAttribute(quote, ["data-source-turn-id", "data-quoted-turn-id", "data-turn-id"]) ??
    firstDescendantAttribute(quote, ["data-source-turn-id", "data-quoted-turn-id", "data-turn-id"]);
  const root = quote.ownerDocument;
  const messages = Array.from(root.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.assistantMessage));
  const matchedIndex = messages.findIndex((message) => {
    const container = message.closest<HTMLElement>("section[data-turn-id], article") ?? message;
    if (messageId && (
      message.dataset.messageId === messageId ||
      container.dataset.messageId === messageId ||
      container.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId === messageId
    )) return true;
    if (turnId && container.dataset.turnId === turnId) return true;
    const text = normalizeText(message.innerText);
    const needle = excerpt.slice(0, Math.min(80, excerpt.length));
    return needle.length >= 16 && text.includes(needle);
  });
  if (matchedIndex < 0) {
    return {
      ...(messageId ? { messageId } : {}),
      ...(turnId ? { turnId } : {}),
    };
  }
  const matched = messages[matchedIndex]!;
  const container = matched.closest<HTMLElement>("section[data-turn-id], article") ?? matched;
  const matchedMessageId = messageId ?? matched.dataset.messageId ??
    container.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId;
  const matchedTurnId = turnId ?? container.dataset.turnId;
  return {
    ...(matchedMessageId ? { messageId: matchedMessageId } : {}),
    ...(matchedTurnId ? { turnId: matchedTurnId } : {}),
    ordinal: matchedIndex,
    text: normalizeText(matched.innerText),
  };
}

function referenceLocator(
  chatId: string,
  role: ReferenceLocator["role"],
  locator: MessageLocator,
): ReferenceLocator {
  return {
    version: 1,
    chatId,
    role,
    ...(locator.messageId ? { messageId: locator.messageId } : {}),
    ...(locator.turnId ? { turnId: locator.turnId } : {}),
    ordinal: locator.ordinal,
    fingerprint: locator.fingerprint,
  };
}

function explicitFileName(element: Element | null): string | undefined {
  if (!element) return undefined;
  const value = firstAttribute(element, ["data-file-name", "data-filename", "download"]);
  if (value) return fileNameFromText(value) ?? value.trim();
  return fileNameFromText(element.getAttribute("aria-label") ?? undefined);
}

function fileNameFromText(value: string | undefined): string | undefined {
  const normalized = normalizeText(value);
  return normalized.match(FILE_NAME_PATTERN)?.[1];
}

function firstAttribute(element: Element | null, names: string[]): string | undefined {
  if (!element) return undefined;
  for (const name of names) {
    const value = element.getAttribute(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function firstDescendantAttribute(element: Element, names: string[]): string | undefined {
  for (const name of names) {
    const value = element.querySelector<HTMLElement>(`[${name}]`)?.getAttribute(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function isDecorativeImage(image: HTMLImageElement): boolean {
  if (image.getAttribute("role") === "presentation" || image.getAttribute("aria-hidden") === "true") {
    return true;
  }
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  return Boolean(width && height && width <= 32 && height <= 32 && !image.alt);
}

function createThumbnailDataUrl(image: HTMLImageElement): string | undefined {
  try {
    if (image.src.startsWith("data:image/") && isAllowedThumbnailDataUrl(image.src)) return image.src;
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return undefined;
    const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL("image/webp", 0.76);
    if (isAllowedThumbnailDataUrl(webp)) return webp;
    const jpeg = canvas.toDataURL("image/jpeg", 0.76);
    return isAllowedThumbnailDataUrl(jpeg) ? jpeg : undefined;
  } catch {
    return undefined;
  }
}

function referenceIdentity(reference: QuestionReference): string {
  if (reference.type === "file") return `file:${reference.name.toLocaleLowerCase()}`;
  if (reference.type === "image") {
    return `image:${(reference.name || reference.alt || reference.thumbnailDataUrl || reference.id).toLocaleLowerCase()}`;
  }
  return `assistant_quote:${reference.excerpt.toLocaleLowerCase()}`;
}

function referenceId(type: QuestionReference["type"], value: string, source?: string): string {
  return `ref-${type}-${fingerprintText(`${source ?? ""}:${value}`)}`;
}

function fingerprintText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
