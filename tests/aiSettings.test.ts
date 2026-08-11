import { describe, expect, it } from "vitest";
import { normalizeAISettings } from "../settings/storage";

describe("AI settings migration", () => {
  it("migrates the legacy Bailian fields without losing values", () => {
    const settings = normalizeAISettings({
      enabled: true,
      apiKey: "legacy-secret",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      timeoutMs: 45_000,
      highConfidence: 0.91,
      mediumConfidence: 0.51,
    });

    expect(settings).toMatchObject({
      schemaVersion: 2,
      enabled: true,
      activeProvider: "bailian",
      timeoutMs: 45_000,
      highConfidence: 0.91,
      mediumConfidence: 0.51,
    });
    expect(settings.profiles.bailian).toEqual({
      apiKey: "legacy-secret",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
    });
  });

  it("keeps provider profiles independent and fills missing provider defaults", () => {
    const settings = normalizeAISettings({
      schemaVersion: 2,
      enabled: true,
      activeProvider: "anthropic",
      profiles: {
        openai: { apiKey: "openai-key", baseUrl: "https://api.openai.com/v1", model: "custom-openai-model" },
        anthropic: { apiKey: "anthropic-key", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5" },
      },
      timeoutMs: 500,
      highConfidence: 3,
      mediumConfidence: -1,
    });

    expect(settings.activeProvider).toBe("anthropic");
    expect(settings.profiles.openai?.apiKey).toBe("openai-key");
    expect(settings.profiles.anthropic?.apiKey).toBe("anthropic-key");
    expect(settings.profiles.gemini?.model).toBe("gemini-3.5-flash-lite");
    expect(settings.timeoutMs).toBe(5_000);
    expect(settings.highConfidence).toBe(1);
    expect(settings.mediumConfidence).toBe(0);
  });
});
