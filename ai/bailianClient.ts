import type { ParentRecommendation, ParentRecommendationInput } from "../types/domain";
import { getAISettings } from "../settings/storage";
import {
  PARENT_RECOMMENDATION_SYSTEM_PROMPT,
  buildParentRecommendationInput,
} from "./prompt";
import { parseParentRecommendation } from "./schemas";

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function recommendParentWithBailian(
  input: ParentRecommendationInput,
): Promise<ParentRecommendation> {
  const settings = await getAISettings();
  if (!settings.enabled) throw new Error("AI is disabled.");
  if (!settings.apiKey.trim()) throw new Error("Bailian API key is missing.");
  if (!settings.model.trim()) throw new Error("Model ID is missing.");

  const baseUrl = validateBailianBaseUrl(settings.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.05,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PARENT_RECOMMENDATION_SYSTEM_PROMPT },
          { role: "user", content: buildParentRecommendationInput(input) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("百炼 API Key 无效。");
      if (response.status === 429) throw new Error("百炼请求过于频繁，请稍后重试。");
      throw new Error(`百炼请求失败（HTTP ${response.status}）。`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("百炼未返回分析内容。");
    const recommendation = parseParentRecommendation(content);
    return { ...recommendation, model: settings.model };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("百炼分析超时，请重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateBailianBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || !url.hostname.endsWith(".aliyuncs.com")) {
    throw new Error("仅允许使用阿里云官方 HTTPS 百炼地址。");
  }
  return url.toString().replace(/\/+$/, "");
}
