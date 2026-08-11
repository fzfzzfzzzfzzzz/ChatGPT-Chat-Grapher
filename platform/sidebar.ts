import { browser } from "wxt/browser";

type FirefoxSidebarAction = {
  toggle(): Promise<void>;
};

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
    return;
  }

  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);
}

export async function openDiscussionDetail(tabId?: number): Promise<void> {
  if (import.meta.env.FIREFOX) {
    // Firefox does not carry a user gesture from a content-script click through
    // runtime messaging, so sidebarAction.open() is rejected here. Open the
    // complete Graph surface in an extension tab instead; the toolbar action
    // above still toggles the real Firefox sidebar.
    await browser.tabs.create({
      url: browser.runtime.getURL("/sidepanel.html"),
      active: true,
    });
    return;
  }

  if (tabId === undefined) throw new Error("Chrome tab ID is unavailable.");
  await browser.sidePanel.open({ tabId });
}
