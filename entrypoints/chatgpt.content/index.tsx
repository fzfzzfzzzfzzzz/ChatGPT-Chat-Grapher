import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  getLatestCapturedQuestion,
  locateQuestionOnCurrentPage,
  watchForRefinedMessageLocator,
} from "../../adapters/chatgpt/questionCapture";
import { getConversationId } from "../../adapters/chatgpt/getConversation";
import { CHATGPT_SELECTORS } from "../../adapters/chatgpt/selectors";
import type {
  CaptureQuestionResponse,
  ContentScriptReadyResponse,
  ExtensionMessage,
  LocateQuestionResponse,
} from "../../shared/messages";
import { isExtensionMessage } from "../../shared/messages";
import {
  CAPTURE_SERVICE_ENABLED_KEY,
  captureServiceEnabledFromStorage,
} from "../../shared/captureService";
import { FloatingNavigationPanel } from "./FloatingNavigationPanel";
import { FLOATING_PANEL_READY_EVENT } from "./panelLifecycle";
import "./style.css";

export default defineContentScript({
  matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  cssInjectionMode: "ui",
  runAt: "document_idle",

  async main(ctx) {
    let floatingPanelReady = false;
    const handleFloatingPanelReady = () => {
      floatingPanelReady = true;
    };
    const handleContentScriptMessage = (
      rawMessage: unknown,
      _sender: unknown,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (!isExtensionMessage(rawMessage)) return undefined;
      if (rawMessage.type === "PING_CHAT_GRAPH_CONTENT_SCRIPT") {
        sendResponse({ ready: floatingPanelReady } satisfies ContentScriptReadyResponse);
        return undefined;
      }
      if (rawMessage.type === "LOCATE_QUESTION") {
        const currentChatId = getConversationId(location.href);
        void locateQuestionOnCurrentPage(rawMessage, currentChatId).then((response) => {
          sendResponse(response satisfies LocateQuestionResponse);
        }).catch(() => {
          sendResponse({
            ok: false,
            code: "MESSAGE_NOT_FOUND",
            error: "扫描当前页面时未能找到原问题。",
          } satisfies LocateQuestionResponse);
        });
        return true;
      }
      return undefined;
    };
    window.addEventListener(FLOATING_PANEL_READY_EVENT, handleFloatingPanelReady);
    browser.runtime.onMessage.addListener(handleContentScriptMessage);

    const ui = await createShadowRootUi(ctx, {
      name: "discussion-map-badge",
      position: "overlay",
      anchor: "body",
      onMount(container) {
        const host = document.createElement("div");
        container.append(host);
        const root = ReactDOM.createRoot(host);
        root.render(<FloatingNavigationPanel />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();

    const storedCapturePreference = await browser.storage.local
      .get(CAPTURE_SERVICE_ENABLED_KEY)
      .catch(() => ({} as Record<string, unknown>));
    let captureEnabled = captureServiceEnabledFromStorage(
      storedCapturePreference[CAPTURE_SERVICE_ENABLED_KEY],
    );
    let captureArmed = false;
    let lastCaptureKey = "";
    const locatorWatchers = new Set<() => void>();

    const refineLocatorWhenReady = (captured: ReturnType<typeof getLatestCapturedQuestion>) => {
      if (!captured || captured.messageLocator?.messageId || !captured.messageAnchor) return;
      let stop: () => void = () => undefined;
      let refinedSynchronously = false;
      stop = watchForRefinedMessageLocator(captured, (messageLocator) => {
        refinedSynchronously = true;
        locatorWatchers.delete(stop);
        void browser.runtime.sendMessage({
          type: "REFINE_MESSAGE_LOCATOR",
          chatId: captured.chatId,
          messageAnchor: captured.messageAnchor!,
          messageLocator,
        } satisfies ExtensionMessage).catch(() => undefined);
      });
      if (!refinedSynchronously) locatorWatchers.add(stop);
    };

    const armCapture = () => {
      if (!captureEnabled) {
        captureArmed = false;
        return;
      }
      captureArmed = true;
      window.setTimeout(() => void tryCapture(), 120);
    };

    const tryCapture = async () => {
      if (!captureEnabled) {
        captureArmed = false;
        return;
      }
      if (!captureArmed) return;
      const captured = getLatestCapturedQuestion();
      if (!captured) return;
      const key = `${captured.chatId}:${captured.messageId}`;
      if (key === lastCaptureKey) {
        captureArmed = false;
        return;
      }
      captureArmed = false;
      lastCaptureKey = key;
      refineLocatorWhenReady(captured);
      try {
        const response = (await browser.runtime.sendMessage({
          type: "CAPTURE_QUESTION",
          captured,
        } satisfies ExtensionMessage)) as CaptureQuestionResponse;
        if (!response.ok) {
          captureArmed = true;
          lastCaptureKey = "";
        }
      } catch {
        captureArmed = true;
        lastCaptureKey = "";
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing &&
        event.target instanceof Element &&
        event.target.closest(CHATGPT_SELECTORS.composer)
      ) {
        armCapture();
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(CHATGPT_SELECTORS.sendButton)) {
        armCapture();
      }
    };
    const handleSubmit = (event: SubmitEvent) => {
      if (event.target instanceof Element && event.target.querySelector(CHATGPT_SELECTORS.composer)) {
        armCapture();
      }
    };
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);

    const handleStorageChanged = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[CAPTURE_SERVICE_ENABLED_KEY]) return;
      captureEnabled = captureServiceEnabledFromStorage(
        changes[CAPTURE_SERVICE_ENABLED_KEY]?.newValue,
      );
      if (!captureEnabled) captureArmed = false;
    };
    browser.storage.onChanged.addListener(handleStorageChanged);

    const observer = new MutationObserver(() => void tryCapture());
    observer.observe(document.body, { childList: true, subtree: true });

    let previousUrl = location.href;
    ctx.setInterval(() => {
      if (location.href === previousUrl) {
        if (captureArmed) void tryCapture();
        return;
      }
      previousUrl = location.href;
      const chatId = getConversationId(location.href);
      void browser.runtime.sendMessage({
        type: "CHATGPT_LOCATION_CHANGED",
        ...(chatId ? { chatId } : {}),
      } satisfies ExtensionMessage);
      window.dispatchEvent(new Event("chat-graph-location-change"));
      if (captureArmed) window.setTimeout(() => void tryCapture(), 300);
    }, 500);

    ctx.onInvalidated(() => {
      observer.disconnect();
      locatorWatchers.forEach((stop) => stop());
      locatorWatchers.clear();
      document.removeEventListener("keydown", handleKeydown, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
      browser.storage.onChanged.removeListener(handleStorageChanged);
      browser.runtime.onMessage.removeListener(handleContentScriptMessage);
      window.removeEventListener(FLOATING_PANEL_READY_EVENT, handleFloatingPanelReady);
    });
  },
});
