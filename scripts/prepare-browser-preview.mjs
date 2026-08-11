import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(".output/chrome-mv3");
const sidePanelPath = resolve(outputDirectory, "sidepanel.html");
const previewPath = resolve(outputDirectory, "preview.html");
const html = await readFile(sidePanelPath, "utf8");

const browserMock = String.raw`<script>
  (() => {
    const localState = Object.create(null);
    const event = { addListener() {}, removeListener() {} };
    globalThis.chrome = {
      runtime: {
        id: "discussion-map-preview",
        onMessage: event,
        async sendMessage() { return undefined; },
      },
      storage: {
        local: {
          async get(keys) {
            if (typeof keys === "string") return { [keys]: localState[keys] };
            if (Array.isArray(keys)) {
              return Object.fromEntries(keys.map((key) => [key, localState[key]]));
            }
            return { ...localState };
          },
          async set(values) { Object.assign(localState, values); },
          async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete localState[key];
          },
        },
      },
      permissions: {
        async contains() { return true; },
        async request() { return true; },
      },
      tabs: {
        onActivated: event,
        onUpdated: event,
        async query() {
          return [{
            id: 1,
            active: true,
            url: "https://chatgpt.com/c/local-preview",
            title: "本地验收对话 | ChatGPT",
          }];
        },
        async create({ url }) {
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          return { id: 2, url };
        },
      },
    };
  })();
</script>`;

const previewHtml = html.replace("</head>", `${browserMock}\n  </head>`);
await writeFile(previewPath, previewHtml, "utf8");
console.log(previewPath);
