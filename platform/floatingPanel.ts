import { browser } from "wxt/browser";
import type { ScriptPublicPath } from "wxt/utils/inject-script";
import type {
  ContentScriptReadyResponse,
  ExtensionMessage,
} from "../shared/messages";

export const FLOATING_PANEL_OPEN_ERROR =
  "暂时无法连接当前 ChatGPT 页面，请刷新页面后重试。";
export const FLOATING_PANEL_PAGE_ERROR =
  "请先打开一个 ChatGPT 页面，然后重试。";

const CONTENT_SCRIPT_READY_RETRY_COUNT = 20;
const CONTENT_SCRIPT_READY_RETRY_DELAY_MS = 25;

export async function openFloatingPanelInActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !isChatGptPageUrl(tab.url)) {
    throw new Error(FLOATING_PANEL_PAGE_ERROR);
  }

  try {
    await ensureContentScript(tab.id);
    await browser.tabs.sendMessage(tab.id, {
      type: "OPEN_FLOATING_PANEL",
    } satisfies ExtensionMessage);
  } catch {
    throw new Error(FLOATING_PANEL_OPEN_ERROR);
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  const initialStatus = await pingContentScript(tabId);
  if (initialStatus === "ready") return;
  if (initialStatus === "starting" && await waitForContentScript(tabId)) return;

  await injectContentScript(tabId);
  if (!(await waitForContentScript(tabId))) {
    throw new Error("Content script did not become ready");
  }
}

function isChatGptPageUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com"
    );
  } catch {
    return false;
  }
}

async function pingContentScript(tabId: number): Promise<"ready" | "starting" | "missing"> {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: "PING_CHAT_GRAPH_CONTENT_SCRIPT",
    } satisfies ExtensionMessage) as ContentScriptReadyResponse | undefined;
    return response?.ready ? "ready" : "starting";
  } catch {
    return "missing";
  }
}

async function waitForContentScript(tabId: number): Promise<boolean> {
  for (let attempt = 0; attempt < CONTENT_SCRIPT_READY_RETRY_COUNT; attempt += 1) {
    if (await pingContentScript(tabId) === "ready") return true;
    await delay(CONTENT_SCRIPT_READY_RETRY_DELAY_MS);
  }
  return false;
}

async function injectContentScript(tabId: number): Promise<void> {
  const contentScript = browser.runtime.getManifest().content_scripts?.find((entry) =>
    entry.matches?.some((match) => match.includes("chatgpt.com") || match.includes("chat.openai.com")),
  );
  if (!contentScript?.js?.length) throw new Error("ChatGPT content script is missing from the manifest");
  await browser.scripting.executeScript({
    target: { tabId },
    files: contentScript.js as ScriptPublicPath[],
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
