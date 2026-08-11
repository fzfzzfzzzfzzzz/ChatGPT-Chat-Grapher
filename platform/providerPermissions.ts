import { browser } from "wxt/browser";
import {
  getAIProviderProfile,
  providerPermissionPattern,
} from "../ai/providers";
import type { AISettings } from "../types/domain";

export async function hasActiveProviderPermission(settings: AISettings): Promise<boolean> {
  try {
    const pattern = activeProviderPermissionPattern(settings);
    return await browser.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

export async function requestActiveProviderPermission(settings: AISettings): Promise<boolean> {
  const pattern = activeProviderPermissionPattern(settings);
  if (settings.activeProvider === "bailian") {
    return browser.permissions.contains({ origins: [pattern] });
  }
  return browser.permissions.request({ origins: [pattern] });
}

export function activeProviderPermissionPattern(settings: AISettings): string {
  const profile = getAIProviderProfile(settings.profiles, settings.activeProvider);
  return providerPermissionPattern(settings.activeProvider, profile);
}
