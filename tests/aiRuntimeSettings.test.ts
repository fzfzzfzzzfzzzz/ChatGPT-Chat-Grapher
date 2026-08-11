import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  permissionsContains: vi.fn(),
  permissionsRequest: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: browserMocks.storageGet,
        set: browserMocks.storageSet,
      },
    },
    permissions: {
      contains: browserMocks.permissionsContains,
      request: browserMocks.permissionsRequest,
    },
  },
}));

import { requestActiveProviderPermission } from "../platform/providerPermissions";
import { getAISettings, normalizeAISettings } from "../settings/storage";

beforeEach(() => {
  vi.clearAllMocks();
  browserMocks.storageSet.mockResolvedValue(undefined);
  browserMocks.permissionsContains.mockResolvedValue(true);
  browserMocks.permissionsRequest.mockResolvedValue(true);
});

describe("AI settings persistence and runtime permissions", () => {
  it("persists the v2 migration the first time legacy settings are read", async () => {
    browserMocks.storageGet.mockResolvedValue({
      aiSettings: {
        enabled: true,
        apiKey: "legacy-test-key",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus",
        timeoutMs: 30_000,
        highConfidence: 0.85,
        mediumConfidence: 0.6,
      },
    });

    const settings = await getAISettings();

    expect(settings.schemaVersion).toBe(2);
    expect(settings.profiles.bailian?.apiKey).toBe("legacy-test-key");
    expect(browserMocks.storageSet).toHaveBeenCalledOnce();
    expect(browserMocks.storageSet.mock.calls[0]?.[0]).toMatchObject({
      aiSettings: { schemaVersion: 2, activeProvider: "bailian" },
    });
  });

  it("uses the required Bailian permission without issuing an optional request", async () => {
    const settings = normalizeAISettings({
      schemaVersion: 2,
      enabled: true,
      activeProvider: "bailian",
      profiles: {
        bailian: {
          apiKey: "test-key",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: "qwen-flash",
        },
      },
    });

    await expect(requestActiveProviderPermission(settings)).resolves.toBe(true);
    expect(browserMocks.permissionsContains).toHaveBeenCalledWith({
      origins: ["https://dashscope.aliyuncs.com/*"],
    });
    expect(browserMocks.permissionsRequest).not.toHaveBeenCalled();
  });

  it("requests only the active non-Bailian provider domain", async () => {
    const settings = normalizeAISettings({
      schemaVersion: 2,
      enabled: true,
      activeProvider: "openai",
      profiles: {
        openai: {
          apiKey: "test-key",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5.6-luna",
        },
      },
    });

    await expect(requestActiveProviderPermission(settings)).resolves.toBe(true);
    expect(browserMocks.permissionsRequest).toHaveBeenCalledWith({
      origins: ["https://api.openai.com/*"],
    });
    expect(browserMocks.permissionsContains).not.toHaveBeenCalled();
  });
});
