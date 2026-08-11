import { defineConfig } from "wxt";

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
    description: "Keep the current ChatGPT question and its parent visible while you work.",
    version: "0.6.0",
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
    permissions: ["storage"],
    host_permissions: [
      "https://chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://*.aliyuncs.com/*",
    ],
    action: {
      default_title: "Open Chat Graph",
    },
  }),
});
