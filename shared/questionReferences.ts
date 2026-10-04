import type { QuestionReference, ReferenceLocator } from "../types/domain";

export const MAX_QUESTION_REFERENCES = 20;
export const MAX_ASSISTANT_QUOTE_LENGTH = 500;
export const MAX_REFERENCE_NAME_LENGTH = 240;
export const MAX_THUMBNAIL_DATA_URL_LENGTH = 280_000;
export const THUMBNAIL_MAX_EDGE = 320;

const ALLOWED_THUMBNAIL_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/webp;base64,",
] as const;

export type QuestionReferenceCounts = {
  files: number;
  images: number;
  assistantQuotes: number;
  total: number;
};

export function countQuestionReferences(
  references: readonly QuestionReference[] | undefined,
): QuestionReferenceCounts {
  const counts: QuestionReferenceCounts = {
    files: 0,
    images: 0,
    assistantQuotes: 0,
    total: 0,
  };
  for (const reference of references ?? []) {
    counts.total += 1;
    if (reference.type === "file") counts.files += 1;
    else if (reference.type === "image") counts.images += 1;
    else counts.assistantQuotes += 1;
  }
  return counts;
}

export function formatReferenceCounts(
  references: readonly QuestionReference[] | undefined,
): string {
  return formatReferenceCountSummary(countQuestionReferences(references));
}

export function formatReferenceCountSummary(
  counts: QuestionReferenceCounts | undefined,
): string {
  if (!counts) return "";
  return [
    counts.files ? `附件 ${counts.files}` : "",
    counts.images ? `图片 ${counts.images}` : "",
    counts.assistantQuotes ? `回答引用 ${counts.assistantQuotes}` : "",
  ].filter(Boolean).join(" · ");
}

export function isAllowedThumbnailDataUrl(value: string): boolean {
  return value.length <= MAX_THUMBNAIL_DATA_URL_LENGTH &&
    ALLOWED_THUMBNAIL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function clampReferenceText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function sanitizeQuestionReferences(value: unknown): QuestionReference[] {
  if (!Array.isArray(value)) return [];
  const sanitized: QuestionReference[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_QUESTION_REFERENCES)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string"
      ? clampReferenceText(record.id, MAX_REFERENCE_NAME_LENGTH)
      : "";
    if (!id || seen.has(id)) continue;
    const sourceLocator = sanitizeReferenceLocator(record.sourceLocator);
    let reference: QuestionReference | undefined;
    if (record.type === "file" && typeof record.name === "string") {
      const name = clampReferenceText(record.name, MAX_REFERENCE_NAME_LENGTH);
      if (!name) continue;
      reference = {
        id,
        type: "file",
        name,
        ...(typeof record.mimeType === "string" && record.mimeType.trim()
          ? { mimeType: clampReferenceText(record.mimeType, 120) }
          : {}),
        ...(typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0
          ? { size: record.size }
          : {}),
        ...(sourceLocator ? { sourceLocator } : {}),
      };
    } else if (record.type === "image") {
      const name = typeof record.name === "string"
        ? clampReferenceText(record.name, MAX_REFERENCE_NAME_LENGTH)
        : "";
      const alt = typeof record.alt === "string"
        ? clampReferenceText(record.alt, MAX_REFERENCE_NAME_LENGTH)
        : "";
      const thumbnailDataUrl = typeof record.thumbnailDataUrl === "string" &&
        isAllowedThumbnailDataUrl(record.thumbnailDataUrl)
        ? record.thumbnailDataUrl
        : undefined;
      if (!name && !alt && !thumbnailDataUrl) continue;
      reference = {
        id,
        type: "image",
        ...(name ? { name } : {}),
        ...(alt ? { alt } : {}),
        ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
        ...(sourceLocator ? { sourceLocator } : {}),
      };
    } else if (record.type === "assistant_quote" && typeof record.excerpt === "string") {
      const excerpt = clampReferenceText(record.excerpt, MAX_ASSISTANT_QUOTE_LENGTH);
      if (!excerpt) continue;
      reference = {
        id,
        type: "assistant_quote",
        excerpt,
        ...(sourceLocator ? { sourceLocator } : {}),
      };
    }
    if (!reference) continue;
    seen.add(id);
    sanitized.push(reference);
  }
  return sanitized;
}

function sanitizeReferenceLocator(value: unknown): ReferenceLocator | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.chatId !== "string" ||
    !record.chatId.trim() ||
    (record.role !== "user" && record.role !== "assistant")
  ) return undefined;
  const locator: ReferenceLocator = {
    version: 1,
    chatId: clampReferenceText(record.chatId, MAX_REFERENCE_NAME_LENGTH),
    role: record.role,
  };
  if (typeof record.messageId === "string" && record.messageId.trim()) {
    locator.messageId = clampReferenceText(record.messageId, MAX_REFERENCE_NAME_LENGTH);
  }
  if (typeof record.turnId === "string" && record.turnId.trim()) {
    locator.turnId = clampReferenceText(record.turnId, MAX_REFERENCE_NAME_LENGTH);
  }
  if (typeof record.ordinal === "number" && Number.isSafeInteger(record.ordinal) && record.ordinal >= 0) {
    locator.ordinal = record.ordinal;
  }
  if (typeof record.fingerprint === "string" && record.fingerprint.trim()) {
    locator.fingerprint = clampReferenceText(record.fingerprint, MAX_REFERENCE_NAME_LENGTH);
  }
  return locator;
}
