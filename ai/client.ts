import {
  getAIProviderDefinition,
  getAIProviderProfile,
  validateAndNormalizeProviderProfile,
} from "./providers";
import {
  PARENT_RECOMMENDATION_SYSTEM_PROMPT,
  buildParentRecommendationInput,
} from "./prompt";
import { parseParentRecommendation } from "./schemas";
import { getAISettings } from "../settings/storage";
import type {
  AIProviderId,
  AIProviderProfile,
  AISettings,
  ParentRecommendation,
  ParentRecommendationInput,
} from "../types/domain";

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type AnthropicMessagesResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export type AIRequestConfig = {
  providerId: AIProviderId;
  profile: AIProviderProfile;
  timeoutMs: number;
};

export async function recommendParent(
  input: ParentRecommendationInput,
): Promise<ParentRecommendation> {
  const settings = await getAISettings();
  if (!settings.enabled) throw new Error("AI 父节点推荐未启用。");
  return recommendParentWithConfig(input, activeAIRequestConfig(settings));
}

export async function recommendParentWithConfig(
  input: ParentRecommendationInput,
  config: AIRequestConfig,
  requireCompleteResponse = false,
): Promise<ParentRecommendation> {
  const provider = getAIProviderDefinition(config.providerId);
  const profile = validateAndNormalizeProviderProfile(config.providerId, config.profile);
  const timeoutMs = normalizeTimeout(config.timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const content = provider.transport === "anthropic-messages"
      ? await requestAnthropic(input, profile, provider.label, controller.signal)
      : await requestOpenAICompatible(
          input,
          profile,
          provider.label,
          provider.supportsJsonResponseFormat,
          controller.signal,
        );
    try {
      const recommendation = parseParentRecommendation(content);
      if (
        requireCompleteResponse &&
        (!recommendation.summary.trim() ||
          (!recommendation.candidates.length && recommendation.noParentConfidence <= 0))
      ) {
        throw new Error("Incomplete recommendation");
      }
      return { ...recommendation, model: profile.model };
    } catch {
      throw new Error(`${provider.label} 返回的推荐格式无效。`);
    }
  } catch (error) {
    if (isAbortError(error)) throw new Error(`${provider.label} 分析超时，请重试。`);
    if (error instanceof AIProviderError) throw new Error(error.message);
    if (error instanceof Error && error.message.startsWith(provider.label)) throw error;
    throw new Error(`${provider.label} 网络请求失败。`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function testAIProvider(config: AIRequestConfig): Promise<ParentRecommendation> {
  return recommendParentWithConfig({
    question: "这个最小测试问题应该归到哪个父问题？",
    fallbackSummary: "测试 AI 父节点推荐连接",
    currentPath: [{ id: "test-parent", question: "如何配置 AI 父节点推荐？", summary: "配置 AI 服务" }],
    candidateNodes: [{
      id: "test-parent",
      question: "如何配置 AI 父节点推荐？",
      summary: "配置 AI 服务",
      status: "pending",
    }],
  }, config, true);
}

export function activeAIRequestConfig(settings: AISettings): AIRequestConfig {
  return {
    providerId: settings.activeProvider,
    profile: getAIProviderProfile(settings.profiles, settings.activeProvider),
    timeoutMs: settings.timeoutMs,
  };
}

async function requestOpenAICompatible(
  input: ParentRecommendationInput,
  profile: AIProviderProfile,
  providerLabel: string,
  supportsJsonResponseFormat: boolean,
  signal: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: profile.model,
    messages: [
      { role: "system", content: PARENT_RECOMMENDATION_SYSTEM_PROMPT },
      { role: "user", content: buildParentRecommendationInput(input) },
    ],
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
    payload = (await response.json()) as OpenAIChatResponse;
  } catch {
    throw new AIProviderError(`${providerLabel} 返回了无法读取的响应。`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new AIProviderError(`${providerLabel} 未返回分析内容。`);
  return content;
}

async function requestAnthropic(
  input: ParentRecommendationInput,
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
      max_tokens: 1024,
      system: PARENT_RECOMMENDATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildParentRecommendationInput(input) }],
    }),
    signal,
  });
  await assertSuccessfulResponse(response, providerLabel);

  let payload: AnthropicMessagesResponse;
  try {
    payload = (await response.json()) as AnthropicMessagesResponse;
  } catch {
    throw new AIProviderError(`${providerLabel} 返回了无法读取的响应。`);
  }
  const content = payload.content
    ?.filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  if (!content?.trim()) throw new AIProviderError(`${providerLabel} 未返回分析内容。`);
  return content;
}

async function assertSuccessfulResponse(response: Response, providerLabel: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new AIProviderError(`${providerLabel} API Key 无效或没有模型权限。`);
  }
  if (response.status === 429) {
    throw new AIProviderError(`${providerLabel} 请求过于频繁或额度不足，请稍后重试。`);
  }
  throw new AIProviderError(`${providerLabel} 请求失败（HTTP ${response.status}）。`);
}

function joinEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function normalizeTimeout(value: number): number {
  return Number.isFinite(value) ? Math.max(5_000, Math.min(120_000, value)) : 30_000;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

class AIProviderError extends Error {}
