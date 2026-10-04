import { browser } from "wxt/browser";
import type {
  ConversationReviewMessage,
  ReviewCaptureReport,
  ReviewJob,
  ReviewVersion,
} from "../types/domain";
import type {
  ExtensionMessage,
  ReviewJobResponse,
  ReviewSourceUploadResponse,
  StartReviewJobRequest,
} from "../shared/messages";
import { createId } from "../utils/id";

const MAX_UPLOAD_CHARS = 96_000;
const MAX_UPLOAD_MESSAGES = 40;

export async function collectReviewSourceFromActiveTab(
  expectedChatId?: string,
): Promise<ReviewCaptureReport> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !isChatGptUrl(tab.url)) {
    throw new Error("请先打开需要总结的 ChatGPT 来源会话。");
  }
  try {
    const report = await browser.tabs.sendMessage(tab.id, {
      type: "COLLECT_REVIEW_SOURCE",
    } satisfies ExtensionMessage) as ReviewCaptureReport;
    if (!report || !Array.isArray(report.messages)) throw new Error();
    if (expectedChatId && report.chatId !== expectedChatId) {
      throw new ReviewSourceMismatchError(expectedChatId, report.chatId);
    }
    return report;
  } catch (error) {
    if (error instanceof ReviewSourceMismatchError) throw error;
    throw new Error("无法读取来源会话，请刷新 ChatGPT 页面后重试。");
  }
}

export async function requestReviewProviderPermission(): Promise<boolean> {
  const response = await browser.runtime.sendMessage({
    type: "REQUEST_REVIEW_PROVIDER_PERMISSION",
  } satisfies ExtensionMessage) as { ok?: boolean; code?: string; error?: string };
  if (response?.ok === true) return true;
  throw new ReviewRuntimeError(
    response?.code ?? "NOT_AUTHORIZED",
    response?.error ?? "未授予当前 AI 厂商的域名访问权限。",
  );
}

export async function uploadReviewSourceAndStart(
  capture: ReviewCaptureReport,
  request: StartReviewJobRequest,
): Promise<ReviewJobResponse> {
  const uploadId = createId("review-upload");
  const chunks = chunkReviewMessages(capture.messages, uploadId);
  let committed = false;
  try {
    const begin = await browser.runtime.sendMessage({
      type: "BEGIN_REVIEW_SOURCE_UPLOAD",
      uploadId,
      metadata: {
        chatId: capture.chatId,
        ...(capture.conversationTitle ? { conversationTitle: capture.conversationTitle } : {}),
        complete: capture.complete,
        missingSourceIds: [...capture.missingSourceIds],
        ...(capture.stoppedReason ? { stoppedReason: capture.stoppedReason } : {}),
      },
      totalChunks: chunks.length,
    } satisfies ExtensionMessage) as ReviewSourceUploadResponse;
    if (!begin.ok) return begin;

    for (let index = 0; index < chunks.length; index += 1) {
      const response = await browser.runtime.sendMessage({
        type: "APPEND_REVIEW_SOURCE_CHUNK",
        uploadId,
        index,
        messages: chunks[index]!,
      } satisfies ExtensionMessage) as ReviewSourceUploadResponse;
      if (!response.ok) return response;
    }
    const response = await browser.runtime.sendMessage({
      type: "COMMIT_REVIEW_SOURCE_UPLOAD",
      uploadId,
      request,
    } satisfies ExtensionMessage) as ReviewJobResponse;
    committed = response.ok;
    return response;
  } finally {
    if (!committed) {
      await browser.runtime.sendMessage({
        type: "DISCARD_REVIEW_SOURCE_UPLOAD",
        uploadId,
      } satisfies ExtensionMessage).catch(() => undefined);
    }
  }
}

export async function cancelReviewJob(jobId: string): Promise<ReviewJobResponse> {
  return browser.runtime.sendMessage({
    type: "CANCEL_REVIEW_JOB",
    jobId,
  } satisfies ExtensionMessage) as Promise<ReviewJobResponse>;
}

export function listenForReviewJob(
  jobId: string,
  listener: (job: ReviewJob, version?: ReviewVersion) => void,
): () => void {
  const handleMessage = (message: unknown) => {
    if (!message || typeof message !== "object" || !("type" in message)) return;
    const update = message as Extract<ExtensionMessage, { type: "REVIEW_JOB_UPDATED" }>;
    if (update.type !== "REVIEW_JOB_UPDATED" || update.job.id !== jobId) return;
    listener(update.job, update.version);
  };
  browser.runtime.onMessage.addListener(handleMessage);
  return () => browser.runtime.onMessage.removeListener(handleMessage);
}

export function chunkReviewMessages(
  messages: readonly ConversationReviewMessage[],
  uploadId = "review-upload",
): ConversationReviewMessage[][] {
  if (!messages.length) return [[]];
  const chunks: ConversationReviewMessage[][] = [];
  let current: ConversationReviewMessage[] = [];
  for (const message of messages) {
    const singletonSize = serializedAppendSize(uploadId, chunks.length, [message]);
    if (singletonSize > MAX_UPLOAD_CHARS) {
      throw new ReviewUploadSizeError(
        `单条来源消息超过 ${MAX_UPLOAD_CHARS} 字符的上传限制，请缩小总结范围。`,
      );
    }
    const candidate = [...current, message];
    if (
      current.length
      && (
        current.length >= MAX_UPLOAD_MESSAGES
        || serializedAppendSize(uploadId, chunks.length, candidate) > MAX_UPLOAD_CHARS
      )
    ) {
      chunks.push(current);
      current = [];
      // The chunk index is part of the serialized envelope. Recheck the single
      // message with its actual next index in case the digit count crossed a boundary.
      if (serializedAppendSize(uploadId, chunks.length, [message]) > MAX_UPLOAD_CHARS) {
        throw new ReviewUploadSizeError(
          `单条来源消息超过 ${MAX_UPLOAD_CHARS} 字符的上传限制，请缩小总结范围。`,
        );
      }
    }
    current.push(message);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export class ReviewUploadSizeError extends Error {
  readonly code = "SOURCE_TOO_LARGE";

  constructor(message: string) {
    super(message);
    this.name = "ReviewUploadSizeError";
  }
}

export class ReviewRuntimeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReviewRuntimeError";
  }
}

export class ReviewSourceMismatchError extends Error {
  readonly code = "SOURCE_UNAVAILABLE";

  constructor(expectedChatId: string, actualChatId: string) {
    super("当前标签不是目标节点的来源会话，请打开对应的 ChatGPT 会话后重试。");
    this.name = "ReviewSourceMismatchError";
    // Keep identifiers available for diagnostics without ever including message
    // contents in the user-facing error or logs.
    this.expectedChatId = expectedChatId;
    this.actualChatId = actualChatId;
  }

  readonly expectedChatId: string;
  readonly actualChatId: string;
}

function serializedAppendSize(
  uploadId: string,
  index: number,
  messages: readonly ConversationReviewMessage[],
): number {
  return JSON.stringify({
    type: "APPEND_REVIEW_SOURCE_CHUNK",
    uploadId,
    index,
    messages,
  }).length;
}

function isChatGptUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "chatgpt.com" || hostname === "chat.openai.com";
  } catch {
    return false;
  }
}
