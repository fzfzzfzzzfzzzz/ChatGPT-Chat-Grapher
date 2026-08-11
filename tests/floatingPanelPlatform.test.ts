import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  query: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    tabs: {
      query: browserMocks.query,
      sendMessage: browserMocks.sendMessage,
    },
  },
}));

import {
  FLOATING_PANEL_OPEN_ERROR,
  openFloatingPanelInActiveTab,
} from "../platform/floatingPanel";

describe("openFloatingPanelInActiveTab", () => {
  beforeEach(() => {
    browserMocks.query.mockReset();
    browserMocks.sendMessage.mockReset();
  });

  it("sends the open command to the active tab", async () => {
    browserMocks.query.mockResolvedValue([{ id: 42 }]);
    browserMocks.sendMessage.mockResolvedValue(undefined);

    await openFloatingPanelInActiveTab();

    expect(browserMocks.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(browserMocks.sendMessage).toHaveBeenCalledWith(42, { type: "OPEN_FLOATING_PANEL" });
  });

  it("returns a useful error when no active content script is available", async () => {
    browserMocks.query.mockResolvedValue([{ id: 42 }]);
    browserMocks.sendMessage.mockRejectedValue(new Error("No receiving end"));

    await expect(openFloatingPanelInActiveTab()).rejects.toThrow(FLOATING_PANEL_OPEN_ERROR);
  });

  it("returns the same error when the active tab has no id", async () => {
    browserMocks.query.mockResolvedValue([]);

    await expect(openFloatingPanelInActiveTab()).rejects.toThrow(FLOATING_PANEL_OPEN_ERROR);
    expect(browserMocks.sendMessage).not.toHaveBeenCalled();
  });
});
