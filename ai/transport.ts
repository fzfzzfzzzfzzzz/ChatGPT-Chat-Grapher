import {
  getAIProviderDefinition,
  getAIProviderProfile,
  validateAndNormalizeProviderProfile,
} from "./providers";
import { getAISettings } from "../settings/storage";
import type { AIProviderId, AIProviderProfile } from "../types/domain";

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type AnthropicMessagesResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export type StructuredAIRequest = {
  system: string;
  user: string;
  maxOutputTokens?: number;
};

export type StructuredAIConfig = {
  providerId: AIProviderId;
  profile: AIProviderProfile;
  timeoutMs: number;
};

export type StructuredAIResponse = {
  content: string;
  providerId: AIProviderId;
  model: string;
};

export type StructuredAIErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_RESPONSE"
  | "CANCELLED";

export class StructuredAIError extends Error {
  constructor(
    readonly code: StructuredAIErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StructuredAIError";
  }
}

/**
 * Explicit user actions use the configured provider even when automatic parent
 * recommendation is disabled. API keys never leave the background context.
 */
export async function requestStructuredAI(
  request: StructuredAIRequest,
  signal?: AbortSignal,
): Promise<StructuredAIResponse> {
  const settings = await getAISettings();
  const profile = getAIProviderProfile(settings.profiles, settings.activeProvider);
  return requestStructuredAIWithConfig(request, {
    providerId: settings.activeProvider,
    profile,
    timeoutMs: settings.timeoutMs,
  }, signal);
}

export async function requestStructuredAIWithConfig(
  request: StructuredAIRequest,
  config: StructuredAIConfig,
  externalSignal?: AbortSignal,
): Promise<StructuredAIResponse> {
  const provider = getAIProviderDefinition(config.providerId);
  let profile: AIProviderProfile;
  try {
    profile = validateAndNormalizeProviderProfile(config.providerId, config.profile);
  } catch (error) {
    throw new StructuredAIError(
      "NOT_CONFIGURED",
      error instanceof Error ? error.message : `${provider.label} 尚未配置。`,
    );
  }

  if (externalSignal?.aborted) {
    throw new StructuredAIError("CANCELLED", "总结任务已取消。");
  }
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort("cancelled");
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort("timeout"), normalizeTimeout(config.timeoutMs));

  try {
    const content = provider.transport === "anthropic-messages"
      ? await requestAnthropic(request, profile, provider.label, controller.signal)
      : await requestOpenAICompatible(
          request,
          profile,
          provider.label,
          provider.supportsJsonResponseFormat,
          controller.signal,
        );
    return { content, providerId: config.providerId, model: profile.model };
  } catch (error) {
    if (error instanceof StructuredAIError) throw error;
    if (isAbortError(error)) {
      if (externalSignal?.aborted || controller.signal.reason === "cancelled") {
        throw new StructuredAIError("CANCELLED", "总结任务已取消。");
      }
      throw new StructuredAIError("TIMEOUT", `${provider.label} 生成超时，请重试。`);
    }
    throw new StructuredAIError("NETWORK", `${provider.label} 网络请求失败。`);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

async function requestOpenAICompatible(
  request: StructuredAIRequest,
  profile: AIProviderProfile,
  providerLabel: string,
  supportsJsonResponseFormat: boolean,
  signal: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: profile.model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    max_tokens: normalizeMaxOutputTokens(request.maxOutputTokens),
  };
  if (supportsJsonResponseFormat) body.response_format = { type: "json_object" };
  const response = await fetch(joinEndpoint(profile.baseUrl, "chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  await assertSuccessfulResponse(response, providerLabel);
  let payload: OpenAIChatResponse;
  try {
    payload = await response.json() as OpenAIChatResponse;
  } catch {
    throw new StructuredAIError("INVALID_RESPONSE", `${providerLabel} 返回了无法读取的响应。`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new StructuredAIError("INVALID_RESPONSE", `${providerLabel} 未返回总结内容。`);
  }
  return content;
}

async function requestAnthropic(
  request: StructuredAIRequest,
  profile: AIProviderProfile,
  providerLabel: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(joinEndpoint(profile.baseUrl, "messages"), {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": profile.apiKey,
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: normalizeMaxOutputTokens(request.maxOutputTokens),
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    }),
    signal,
  });
  await assertSuccessfulResponse(response, providerLabel);
  let payload: AnthropicMessagesResponse;
  try {
    payload = await response.json() as AnthropicMessagesResponse;
  } catch {
    throw new StructuredAIError("INVALID_RESPONSE", `${providerLabel} 返回了无法读取的响应。`);
  }
  const content = payload.content
    ?.filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  if (!content?.trim()) {
    throw new StructuredAIError("INVALID_RESPONSE", `${providerLabel} 未返回总结内容。`);
  }
  return content;
}

async function assertSuccessfulResponse(response: Response, providerLabel: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new StructuredAIError("AUTH_FAILED", `${providerLabel} API Key 无效或没有模型权限。`);
  }
  if (response.status === 429) {
    throw new StructuredAIError("RATE_LIMITED", `${providerLabel} 请求过于频繁或额度不足。`);
  }
  throw new StructuredAIError("NETWORK", `${providerLabel} 请求失败（HTTP ${response.status}）。`);
}

function joinEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function normalizeTimeout(value: number): number {
  return Number.isFinite(value) ? Math.max(5_000, Math.min(120_000, value)) : 30_000;
}

function normalizeMaxOutputTokens(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(512, Math.min(16_384, value!)) : 8_192;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

