import { defineConfig } from "wxt";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  targetBrowsers: ["chrome", "firefox"],
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  hooks: {
    build: {
      manifestGenerated(wxt, manifest) {
        if (wxt.config.browser !== "firefox") return;
        for (const resource of manifest.web_accessible_resources ?? []) {
          if (typeof resource !== "string") delete resource.use_dynamic_url;
        }
      },
    },
  },
  manifest: ({ browser }) => ({
    name: "Chat Graph",
    description: "Navigate ChatGPT question graphs and create local, evidence-linked Conversation Reviews.",
    version: packageJson.version,
    ...(browser === "chrome"
      ? { minimum_chrome_version: "116" }
      : {
          browser_specific_settings: {
            gecko: {
              id: "{f5db17fc-3b44-4e1c-b267-8b54ee7e1be4}",
              strict_min_version: "115.0",
              data_collection_permissions: { required: ["websiteContent"] },
            },
          },
        }),
    permissions: ["storage", "scripting"],
    ...(browser === "chrome"
      ? { optional_host_permissions: ["https://*/*"] }
      : { optional_permissions: ["https://*/*"] }),
    host_permissions: [
      "https://chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://*.aliyuncs.com/*",
    ],
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
    action: {
      default_title: "Open Chat Graph",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
      },
    },
    ...(browser === "firefox"
      ? {
          commands: {
            "open-chat-graph-sidebar": {
              suggested_key: { default: "Alt+Shift+G" },
              description: "Open the Chat Graph sidebar",
            },
          },
        }
      : {}),
  }),
});
