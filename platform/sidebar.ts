import { browser } from "wxt/browser";

type FirefoxSidebarAction = {
  open(): Promise<void>;
  toggle(): Promise<void>;
};

const OPEN_FIREFOX_SIDEBAR_COMMAND = "open-chat-graph-sidebar";

function getFirefoxSidebarAction(): FirefoxSidebarAction {
  const sidebarAction = (
    browser as typeof browser & { sidebarAction?: FirefoxSidebarAction }
  ).sidebarAction;
  if (!sidebarAction) throw new Error("Firefox sidebarAction API is unavailable.");
  return sidebarAction;
}

export function initializeSidebarBehavior(): void {
  if (import.meta.env.FIREFOX) {
    browser.action.onClicked.addListener(() => {
      void getFirefoxSidebarAction().toggle().catch(() => undefined);
    });
    browser.commands.onCommand.addListener((command) => {
      if (command !== OPEN_FIREFOX_SIDEBAR_COMMAND) return;
      void getFirefoxSidebarAction().open().catch(() => undefined);
    });
    return;
  }

  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);
}

export async function openDiscussionDetail(tabId?: number): Promise<void> {
  if (import.meta.env.FIREFOX) {
    throw new Error("Firefox sidebar must be opened directly from an extension user gesture.");
  }

  if (tabId === undefined) throw new Error("Chrome tab ID is unavailable.");
  await browser.sidePanel.open({ tabId });
}
