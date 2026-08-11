import { describe, expect, it } from "vitest";
import {
  AI_PROVIDERS,
  createDefaultAIProfiles,
  normalizeProviderBaseUrl,
  providerPermissionPattern,
  validateAndNormalizeProviderProfile,
} from "../ai/providers";

describe("AI provider registry", () => {
  it("defines every supported provider with independent defaults", () => {
    expect(AI_PROVIDERS.map((provider) => provider.id)).toEqual([
      "bailian",
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "openrouter",
      "custom-openai",
    ]);
    const profiles = createDefaultAIProfiles();
    expect(profiles.bailian.model).toBe("qwen-flash");
    expect(profiles.anthropic.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(profiles["custom-openai"]).toEqual({ apiKey: "", baseUrl: "", model: "" });
  });

  it("normalizes HTTPS URLs and builds a domain-only permission pattern", () => {
    expect(normalizeProviderBaseUrl("custom-openai", "https://gateway.example.com:8443/v1/"))
      .toBe("https://gateway.example.com:8443/v1");
    expect(providerPermissionPattern("custom-openai", {
      apiKey: "key",
      baseUrl: "https://gateway.example.com:8443/v1",
      model: "model",
    })).toBe("https://gateway.example.com/*");
  });

  it("rejects insecure, credential-bearing, and non-official URLs", () => {
    expect(() => normalizeProviderBaseUrl("custom-openai", "http://gateway.example.com/v1"))
      .toThrow("HTTPS");
    expect(() => normalizeProviderBaseUrl("custom-openai", "https://user:pass@gateway.example.com/v1"))
      .toThrow("用户名或密码");
    expect(() => normalizeProviderBaseUrl("openai", "https://example.com/v1"))
      .toThrow("官方 API 地址");
    expect(() => normalizeProviderBaseUrl("gemini", "https://generativelanguage.googleapis.com/v1?key=secret"))
      .toThrow("查询参数");
  });

  it("requires a key and model before a provider can be used", () => {
    expect(() => validateAndNormalizeProviderProfile("openai", {
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-luna",
    })).toThrow("API Key 未填写");
    expect(() => validateAndNormalizeProviderProfile("custom-openai", {
      apiKey: "key",
      baseUrl: "https://gateway.example.com/v1",
      model: "",
    })).toThrow("Model ID 未填写");
  });
});
