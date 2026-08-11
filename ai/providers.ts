import type {
  AIProviderDefinition,
  AIProviderId,
  AIProviderProfile,
} from "../types/domain";

export const AI_PROVIDER_IDS = [
  "bailian",
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "openrouter",
  "custom-openai",
] as const satisfies readonly AIProviderId[];

export const AI_PROVIDERS: readonly AIProviderDefinition[] = [
  {
    id: "bailian",
    label: "阿里云百炼",
    transport: "openai-chat",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-flash",
    suggestedModels: ["qwen-flash", "qwen-plus", "qwen-max"],
    editableBaseUrl: false,
    supportsJsonResponseFormat: true,
    allowedHostnameSuffix: ".aliyuncs.com",
  },
  {
    id: "openai",
    label: "OpenAI",
    transport: "openai-chat",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    suggestedModels: ["gpt-5.6-luna", "gpt-5.6-terra"],
    editableBaseUrl: false,
    supportsJsonResponseFormat: true,
    allowedHostname: "api.openai.com",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    transport: "anthropic-messages",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    suggestedModels: ["claude-haiku-4-5", "claude-sonnet-5"],
    editableBaseUrl: false,
    supportsJsonResponseFormat: false,
    allowedHostname: "api.anthropic.com",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    transport: "openai-chat",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash-lite",
    suggestedModels: ["gemini-3.5-flash-lite", "gemini-3.6-flash"],
    editableBaseUrl: false,
    supportsJsonResponseFormat: true,
    allowedHostname: "generativelanguage.googleapis.com",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    transport: "openai-chat",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    suggestedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
    editableBaseUrl: false,
    supportsJsonResponseFormat: true,
    allowedHostname: "api.deepseek.com",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    transport: "openai-chat",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "~openai/gpt-latest",
    suggestedModels: ["~openai/gpt-latest", "openai/gpt-5.6-luna"],
    editableBaseUrl: false,
    supportsJsonResponseFormat: false,
    allowedHostname: "openrouter.ai",
  },
  {
    id: "custom-openai",
    label: "自定义 OpenAI 兼容服务",
    transport: "openai-chat",
    defaultBaseUrl: "",
    defaultModel: "",
    suggestedModels: [],
    editableBaseUrl: true,
    supportsJsonResponseFormat: false,
  },
];

const PROVIDER_BY_ID = new Map(AI_PROVIDERS.map((provider) => [provider.id, provider]));

export function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === "string" && PROVIDER_BY_ID.has(value as AIProviderId);
}

export function getAIProviderDefinition(id: AIProviderId): AIProviderDefinition {
  return PROVIDER_BY_ID.get(id)!;
}

export function createDefaultAIProfiles(): Record<AIProviderId, AIProviderProfile> {
  return Object.fromEntries(
    AI_PROVIDERS.map((provider) => [provider.id, {
      apiKey: "",
      baseUrl: provider.defaultBaseUrl,
      model: provider.defaultModel,
    }]),
  ) as Record<AIProviderId, AIProviderProfile>;
}

export function getAIProviderProfile(
  profiles: Partial<Record<AIProviderId, AIProviderProfile>>,
  id: AIProviderId,
): AIProviderProfile {
  const defaults = createDefaultAIProfiles()[id];
  const profile = profiles[id];
  return {
    apiKey: typeof profile?.apiKey === "string" ? profile.apiKey : defaults.apiKey,
    baseUrl: typeof profile?.baseUrl === "string" ? profile.baseUrl : defaults.baseUrl,
    model: typeof profile?.model === "string" ? profile.model : defaults.model,
  };
}

export function validateAndNormalizeProviderProfile(
  providerId: AIProviderId,
  profile: AIProviderProfile,
): AIProviderProfile {
  const provider = getAIProviderDefinition(providerId);
  const apiKey = profile.apiKey.trim();
  const model = profile.model.trim();
  if (!apiKey) throw new Error(`${provider.label} API Key 未填写。`);
  if (!model) throw new Error(`${provider.label} Model ID 未填写。`);
  return {
    apiKey,
    baseUrl: normalizeProviderBaseUrl(providerId, profile.baseUrl),
    model,
  };
}

export function normalizeProviderBaseUrl(providerId: AIProviderId, value: string): string {
  const provider = getAIProviderDefinition(providerId);
  const input = value.trim();
  if (!input) throw new Error(`${provider.label} Base URL 未填写。`);

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${provider.label} Base URL 不是有效网址。`);
  }
  if (url.protocol !== "https:") throw new Error(`${provider.label} Base URL 必须使用 HTTPS。`);
  if (url.username || url.password) throw new Error("Base URL 不能包含用户名或密码。");
  if (url.search || url.hash) throw new Error("Base URL 不能包含查询参数或片段。");

  const hostname = url.hostname.toLowerCase();
  if (provider.allowedHostname && hostname !== provider.allowedHostname) {
    throw new Error(`${provider.label} 只能使用官方 API 地址。`);
  }
  if (provider.allowedHostnameSuffix && !hostname.endsWith(provider.allowedHostnameSuffix)) {
    throw new Error(`${provider.label} 只能使用官方 API 地址。`);
  }

  return url.toString().replace(/\/+$/, "");
}

export function providerPermissionPattern(providerId: AIProviderId, profile: AIProviderProfile): string {
  const normalized = normalizeProviderBaseUrl(providerId, profile.baseUrl);
  const url = new URL(normalized);
  return `${url.protocol}//${url.hostname}/*`;
}
