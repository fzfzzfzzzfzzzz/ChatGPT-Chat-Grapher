import { browser } from "wxt/browser";
import {
  AI_PROVIDER_IDS,
  createDefaultAIProfiles,
  getAIProviderDefinition,
  isAIProviderId,
} from "../ai/providers";
import type { AISettings } from "../types/domain";

export const AI_SETTINGS_KEY = "aiSettings";

export const DEFAULT_AI_SETTINGS: AISettings = {
  schemaVersion: 2,
  enabled: false,
  activeProvider: "bailian",
  profiles: createDefaultAIProfiles(),
  timeoutMs: 30_000,
  highConfidence: 0.85,
  mediumConfidence: 0.6,
};

export async function getAISettings(): Promise<AISettings> {
  const stored = await browser.storage.local.get(AI_SETTINGS_KEY);
  const raw = stored[AI_SETTINGS_KEY];
  const value = normalizeAISettings(raw);
  if (needsMigration(raw)) await saveAISettings(value);
  return value;
}

export function saveAISettings(settings: AISettings): Promise<void> {
  return browser.storage.local.set({ [AI_SETTINGS_KEY]: normalizeAISettings(settings) });
}

export function normalizeAISettings(value: unknown): AISettings {
  const record = asRecord(value) ?? {};
  const profiles = createDefaultAIProfiles();

  if (record.schemaVersion === 2) {
    const storedProfiles = asRecord(record.profiles) ?? {};
    for (const id of AI_PROVIDER_IDS) {
      const profile = asRecord(storedProfiles[id]);
      if (!profile) continue;
      profiles[id] = {
        apiKey: stringValue(profile.apiKey, profiles[id].apiKey),
        baseUrl: stringValue(profile.baseUrl, profiles[id].baseUrl),
        model: stringValue(profile.model, profiles[id].model),
      };
    }
  } else {
    profiles.bailian = {
      apiKey: stringValue(record.apiKey, ""),
      baseUrl: stringValue(record.baseUrl, getAIProviderDefinition("bailian").defaultBaseUrl),
      model: stringValue(record.model, getAIProviderDefinition("bailian").defaultModel),
    };
  }

  return {
    schemaVersion: 2,
    enabled: typeof record.enabled === "boolean" ? record.enabled : false,
    activeProvider: isAIProviderId(record.activeProvider) ? record.activeProvider : "bailian",
    profiles,
    timeoutMs: clampTimeout(numberValue(record.timeoutMs), 30_000),
    highConfidence: clampThreshold(numberValue(record.highConfidence), 0.85),
    mediumConfidence: clampThreshold(numberValue(record.mediumConfidence), 0.6),
  };
}

function needsMigration(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(record && record.schemaVersion !== 2);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function clampThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function clampTimeout(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(5_000, Math.min(120_000, value)) : fallback;
}
