import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  query: vi.fn(),
  sendMessage: vi.fn(),
  executeScript: vi.fn(),
  getManifest: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    tabs: {
      query: browserMocks.query,
      sendMessage: browserMocks.sendMessage,
    },
    scripting: {
      executeScript: browserMocks.executeScript,
    },
    runtime: {
      getManifest: browserMocks.getManifest,
    },
  },
}));

import {
  FLOATING_PANEL_OPEN_ERROR,
  FLOATING_PANEL_PAGE_ERROR,
  openFloatingPanelInActiveTab,
} from "../platform/floatingPanel";

describe("openFloatingPanelInActiveTab", () => {
  beforeEach(() => {
    browserMocks.query.mockReset();
    browserMocks.sendMessage.mockReset();
    browserMocks.executeScript.mockReset();
    browserMocks.getManifest.mockReset();
    browserMocks.getManifest.mockReturnValue({
      content_scripts: [{
        matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
        js: ["content-scripts/chatgpt.js"],
      }],
    });
  });

  it("opens the panel directly when the active ChatGPT content script is ready", async () => {
    browserMocks.query.mockResolvedValue([{ id: 42, url: "https://chatgpt.com/c/example" }]);
    browserMocks.sendMessage
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce(undefined);

    await openFloatingPanelInActiveTab();

    expect(browserMocks.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(browserMocks.sendMessage.mock.calls).toEqual([
      [42, { type: "PING_CHAT_GRAPH_CONTENT_SCRIPT" }],
      [42, { type: "OPEN_FLOATING_PANEL" }],
    ]);
    expect(browserMocks.executeScript).not.toHaveBeenCalled();
  });

  it("injects the manifest content script before opening an already-loaded ChatGPT page", async () => {
    let injected = false;
    browserMocks.query.mockResolvedValue([{ id: 42, url: "https://chatgpt.com/" }]);
    browserMocks.executeScript.mockImplementation(async () => {
      injected = true;
      return [];
    });
    browserMocks.sendMessage.mockImplementation(async (_tabId, message: { type: string }) => {
      if (message.type === "PING_CHAT_GRAPH_CONTENT_SCRIPT") {
        if (!injected) throw new Error("No receiving end");
        return { ready: true };
      }
      return undefined;
    });

    await openFloatingPanelInActiveTab();

    expect(browserMocks.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ["content-scripts/chatgpt.js"],
    });
    expect(browserMocks.sendMessage).toHaveBeenLastCalledWith(42, { type: "OPEN_FLOATING_PANEL" });
  });

  it("waits for an injected content script that is still mounting", async () => {
    browserMocks.query.mockResolvedValue([{ id: 42, url: "https://chat.openai.com/c/example" }]);
    browserMocks.sendMessage
      .mockResolvedValueOnce({ ready: false })
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce(undefined);

    await openFloatingPanelInActiveTab();

    expect(browserMocks.executeScript).not.toHaveBeenCalled();
    expect(browserMocks.sendMessage).toHaveBeenLastCalledWith(42, { type: "OPEN_FLOATING_PANEL" });
  });

  it("returns a connection error when recovery injection fails", async () => {
    browserMocks.query.mockResolvedValue([{ id: 42, url: "https://chatgpt.com/" }]);
    browserMocks.sendMessage.mockRejectedValue(new Error("No receiving end"));
    browserMocks.executeScript.mockRejectedValue(new Error("Injection failed"));

    await expect(openFloatingPanelInActiveTab()).rejects.toThrow(FLOATING_PANEL_OPEN_ERROR);
  });

  it("asks for ChatGPT when the active tab is not a supported page", async () => {
    browserMocks.query.mockResolvedValue([{ id: 42, url: "https://example.com/" }]);

    await expect(openFloatingPanelInActiveTab()).rejects.toThrow(FLOATING_PANEL_PAGE_ERROR);
    expect(browserMocks.sendMessage).not.toHaveBeenCalled();
    expect(browserMocks.executeScript).not.toHaveBeenCalled();
  });

  it("returns the page error when the active tab has no id", async () => {
    browserMocks.query.mockResolvedValue([]);

    await expect(openFloatingPanelInActiveTab()).rejects.toThrow(FLOATING_PANEL_PAGE_ERROR);
    expect(browserMocks.sendMessage).not.toHaveBeenCalled();
  });
});
