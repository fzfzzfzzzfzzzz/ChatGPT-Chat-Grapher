import type { ConversationReviewMessage, ReviewModuleId } from "../types/domain";

export const REVIEW_DIRECT_INPUT_TOKEN_LIMIT = 24_000;
export const REVIEW_CHUNK_TOKEN_TARGET = 10_000;
export const REVIEW_CHUNK_MESSAGE_OVERLAP = 2;
export const REVIEW_MAX_CHUNKS = 20;
export const REVIEW_MODULE_BATCH_SIZE = 6;
export const REVIEW_DIRECT_MODULE_LIMIT = 10;
export const REVIEW_TOKEN_RESERVE_RATIO = 0.15;

export type ReviewMessageChunk = {
  index: number;
  /** Start/end of the actual request, including overlap context. */
  startMessageIndex: number;
  endMessageIndex: number;
  /** Start/end of messages first introduced by this chunk. */
  primaryStartMessageIndex: number;
  primaryEndMessageIndex: number;
  overlapMessageCount: number;
  sourceIds: string[];
  messages: ConversationReviewMessage[];
  estimatedTokens: number;
};

export type ReviewProcessingStrategy = "direct" | "chunked" | "blocked";

export type ReviewProcessingPlan = {
  strategy: ReviewProcessingStrategy;
  estimatedInputTokens: number;
  chunks: ReviewMessageChunk[];
  estimatedChunkCount: number;
  moduleBatches: ReviewModuleId[][];
  usesFactExtraction: boolean;
  blockedReason?: "TOO_MANY_CHUNKS" | "OVERSIZED_MESSAGE";
  oversizedMessageSourceIds: string[];
  limits: {
    directInputTokens: number;
    chunkTokens: number;
    chunkMessageOverlap: number;
    maxChunks: number;
    moduleBatchSize: number;
  };
};

export type PlanReviewProcessingInput = {
  messages: readonly ConversationReviewMessage[];
  selectedModuleIds: readonly ReviewModuleId[];
  /** Bounded non-message context (for example ancestor question summaries). */
  additionalInputTokens?: number;
};

/** A conservative, language-aware estimate suitable for routing, not billing. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  let otherUnicodeCount = 0;
  let asciiNonWhitespaceCount = 0;
  let asciiWordCount = 0;
  let inAsciiWord = false;

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isCjkCodePoint(codePoint)) {
      cjkCount += 1;
      inAsciiWord = false;
    } else if (codePoint > 0x7f) {
      otherUnicodeCount += 1;
      inAsciiWord = false;
    } else if (/\s/.test(character)) {
      inAsciiWord = false;
    } else {
      asciiNonWhitespaceCount += 1;
      if (/[A-Za-z0-9_]/.test(character)) {
        if (!inAsciiWord) asciiWordCount += 1;
        inAsciiWord = true;
      } else {
        inAsciiWord = false;
      }
    }
  }

  const asciiEstimate = Math.max(
    asciiNonWhitespaceCount / 4,
    asciiWordCount * 1.15,
  );
  // Emoji and non-CJK Unicode can span multiple model tokens, so keep them
  // deliberately conservative rather than treating every UTF-16 unit alike.
  return Math.max(1, Math.ceil(cjkCount + otherUnicodeCount * 1.5 + asciiEstimate));
}

export function estimateReviewMessageTokens(message: ConversationReviewMessage): number {
  // Role, source id, branch metadata and JSON delimiters all consume context too.
  const metadata = 18
    + estimateTextTokens(message.sourceId)
    + (message.branchPath?.length ?? 0) * 4;
  return estimateTextTokens(message.content) + metadata;
}

export function estimateReviewMessagesTokens(
  messages: readonly ConversationReviewMessage[],
  reserveRatio = REVIEW_TOKEN_RESERVE_RATIO,
): number {
  const messageTokens = messages.reduce(
    (total, message) => total + estimateReviewMessageTokens(message),
    0,
  );
  return Math.ceil(messageTokens * (1 + reserveRatio));
}

export function planReviewProcessing(
  input: PlanReviewProcessingInput,
): ReviewProcessingPlan {
  const selectedModuleIds = dedupeModuleIds(input.selectedModuleIds);
  const estimatedInputTokens = estimateRequestTokens(
    input.messages,
    selectedModuleIds,
    input.additionalInputTokens ?? 0,
  );
  const moduleBatches = batchModules(selectedModuleIds);
  const limits = {
    directInputTokens: REVIEW_DIRECT_INPUT_TOKEN_LIMIT,
    chunkTokens: REVIEW_CHUNK_TOKEN_TARGET,
    chunkMessageOverlap: REVIEW_CHUNK_MESSAGE_OVERLAP,
    maxChunks: REVIEW_MAX_CHUNKS,
    moduleBatchSize: REVIEW_MODULE_BATCH_SIZE,
  } as const;

  if (
    estimatedInputTokens <= REVIEW_DIRECT_INPUT_TOKEN_LIMIT
    && selectedModuleIds.length <= REVIEW_DIRECT_MODULE_LIMIT
  ) {
    const directChunk = createChunk(
      input.messages,
      0,
      input.messages.length,
      0,
      input.messages.length,
      0,
    );
    return {
      strategy: "direct",
      estimatedInputTokens,
      chunks: input.messages.length ? [directChunk] : [],
      estimatedChunkCount: input.messages.length ? 1 : 0,
      moduleBatches: selectedModuleIds.length ? [selectedModuleIds] : [],
      usesFactExtraction: false,
      oversizedMessageSourceIds: [],
      limits,
    };
  }

  const oversizedMessageSourceIds = input.messages
    .filter((message) =>
      Math.ceil(estimateReviewMessageTokens(message) * (1 + REVIEW_TOKEN_RESERVE_RATIO))
        > REVIEW_DIRECT_INPUT_TOKEN_LIMIT
    )
    .map(({ sourceId }) => sourceId);
  const chunks = createReviewMessageChunks(input.messages);
  const blockedReason = oversizedMessageSourceIds.length
    ? "OVERSIZED_MESSAGE" as const
    : chunks.length > REVIEW_MAX_CHUNKS
      ? "TOO_MANY_CHUNKS" as const
      : undefined;

  if (blockedReason) {
    return {
      strategy: "blocked",
      estimatedInputTokens,
      chunks: [],
      estimatedChunkCount: chunks.length,
      moduleBatches,
      usesFactExtraction: true,
      blockedReason,
      oversizedMessageSourceIds,
      limits,
    };
  }

  return {
    strategy: "chunked",
    estimatedInputTokens,
    chunks,
    estimatedChunkCount: chunks.length,
    moduleBatches,
    usesFactExtraction: true,
    oversizedMessageSourceIds: [],
    limits,
  };
}

export function createReviewMessageChunks(
  messages: readonly ConversationReviewMessage[],
): ReviewMessageChunk[] {
  if (!messages.length) return [];
  const chunks: ReviewMessageChunk[] = [];
  let primaryStart = 0;

  while (primaryStart < messages.length) {
    const requestStart = chunks.length
      ? Math.max(0, primaryStart - REVIEW_CHUNK_MESSAGE_OVERLAP)
      : primaryStart;
    let primaryEnd = primaryStart;
    let tokenTotal = estimateReviewMessagesTokens(
      messages.slice(requestStart, primaryStart),
    );
    while (primaryEnd < messages.length) {
      const message = messages[primaryEnd];
      if (!message) break;
      const nextTokens = Math.ceil(
        estimateReviewMessageTokens(message) * (1 + REVIEW_TOKEN_RESERVE_RATIO),
      );
      if (
        primaryEnd > primaryStart
        && tokenTotal + nextTokens > REVIEW_CHUNK_TOKEN_TARGET
      ) break;
      tokenTotal += nextTokens;
      primaryEnd += 1;
    }
    if (primaryEnd === primaryStart) primaryEnd += 1;
    chunks.push(createChunk(
      messages,
      requestStart,
      primaryEnd,
      primaryStart,
      primaryEnd,
      chunks.length,
    ));
    primaryStart = primaryEnd;
  }
  return chunks;
}

export function batchReviewModules(
  moduleIds: readonly ReviewModuleId[],
): ReviewModuleId[][] {
  return batchModules(dedupeModuleIds(moduleIds));
}

function createChunk(
  messages: readonly ConversationReviewMessage[],
  start: number,
  endExclusive: number,
  primaryStart: number,
  primaryEndExclusive: number,
  index: number,
): ReviewMessageChunk {
  const chunkMessages = messages.slice(start, endExclusive);
  return {
    index,
    startMessageIndex: start,
    endMessageIndex: Math.max(start, endExclusive - 1),
    primaryStartMessageIndex: primaryStart,
    primaryEndMessageIndex: Math.max(primaryStart, primaryEndExclusive - 1),
    overlapMessageCount: Math.max(0, primaryStart - start),
    sourceIds: chunkMessages.map(({ sourceId }) => sourceId),
    messages: chunkMessages,
    estimatedTokens: estimateReviewMessagesTokens(chunkMessages),
  };
}

function estimateRequestTokens(
  messages: readonly ConversationReviewMessage[],
  moduleIds: readonly ReviewModuleId[],
  additionalInputTokens: number,
): number {
  const basePromptTokens = 420;
  const perModuleOutputAndInstructionTokens = 54;
  return estimateReviewMessagesTokens(messages)
    + basePromptTokens
    + moduleIds.length * perModuleOutputAndInstructionTokens
    + Math.ceil(Math.max(0, additionalInputTokens) * (1 + REVIEW_TOKEN_RESERVE_RATIO));
}

function batchModules(moduleIds: readonly ReviewModuleId[]): ReviewModuleId[][] {
  const batches: ReviewModuleId[][] = [];
  for (let index = 0; index < moduleIds.length; index += REVIEW_MODULE_BATCH_SIZE) {
    batches.push(moduleIds.slice(index, index + REVIEW_MODULE_BATCH_SIZE));
  }
  return batches;
}

function dedupeModuleIds(moduleIds: readonly ReviewModuleId[]): ReviewModuleId[] {
  return [...new Set(moduleIds)];
}

function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0x3040 && codePoint <= 0x30ff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
  );
}
