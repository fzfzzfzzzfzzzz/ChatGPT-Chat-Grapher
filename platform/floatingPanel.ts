import { browser } from "wxt/browser";
import type { ExtensionMessage } from "../shared/messages";

export const FLOATING_PANEL_OPEN_ERROR =
  "请先打开或刷新一个 ChatGPT 页面，然后重试。";

export async function openFloatingPanelInActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error(FLOATING_PANEL_OPEN_ERROR);

  try {
    await browser.tabs.sendMessage(tab.id, {
      type: "OPEN_FLOATING_PANEL",
    } satisfies ExtensionMessage);
  } catch {
    throw new Error(FLOATING_PANEL_OPEN_ERROR);
  }
}
