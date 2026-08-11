import { browser } from "wxt/browser";
import type { AISettings } from "../types/domain";

export const AI_SETTINGS_KEY = "aiSettings";

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  apiKey: "",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen-flash",
  timeoutMs: 30_000,
  highConfidence: 0.85,
  mediumConfidence: 0.6,
};

export async function getAISettings(): Promise<AISettings> {
  const stored = await browser.storage.local.get(AI_SETTINGS_KEY);
  const value = { ...DEFAULT_AI_SETTINGS, ...asRecord(stored[AI_SETTINGS_KEY]) } as AISettings;
  return {
    ...value,
    highConfidence: clampThreshold(value.highConfidence, 0.85),
    mediumConfidence: clampThreshold(value.mediumConfidence, 0.6),
  };
}

export function saveAISettings(settings: AISettings): Promise<void> {
  return browser.storage.local.set({ [AI_SETTINGS_KEY]: settings });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function clampThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}
