# Chat Graph

[简体中文](README.zh-CN.md) | [Privacy](PRIVACY.md) | [Changelog](CHANGELOG.md)

[![Release](https://img.shields.io/github/v/release/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher)](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Chat Graph is a local-first Chrome and Firefox extension that turns long ChatGPT conversations into a navigable question tree or forest and editable conversation reviews. It keeps the current question, its logical parent, unfinished branches, review artifacts, and original message locations within reach without creating a second full copy of the conversation.

The current release is **v1.0.0 - Conversation Review**.

## Product preview

<p align="center">
  <img src="release-assets/v0.12.0/icons/chat-graph-icon-128.png" width="96" alt="Chat Graph icon">
</p>

### Conversation Review (v1.0)

![Chat Graph v1.0 Conversation Review result, evidence drawer, planned node, and graph artifact](release-assets/v1.0.0/conversation-review.png)

### Floating panel inside ChatGPT

![Chat Graph floating graph view inside ChatGPT](release-assets/v0.12.0/screenshots/04-floating-panel-in-chatgpt.png)

### Current / Parent and Question Graph

| Current / Parent workspace | Question Graph |
| --- | --- |
| ![Current and Parent workspace](release-assets/v0.12.0/screenshots/01-current-parent.png) | ![Question Graph](release-assets/v0.12.0/screenshots/02-question-graph.png) |

### Local JSON backup

![Local JSON backup settings](release-assets/v0.12.0/screenshots/03-local-backup-settings.png)

## What it does

- Captures questions submitted on ChatGPT and adds one candidate per submission.
- Shows the current question and its logical parent in a persistent floating panel.
- Builds a question graph from selected messages or from all user questions in the current conversation.
- Opens the full graph in the Chrome Side Panel or Firefox Sidebar.
- Searches questions and summaries across conversations in the current project.
- Captures referenced files, images, and Assistant excerpts; graph nodes show reference counts and details show metadata, bounded thumbnails, and short quotes.
- Searches file names, image descriptions, and quoted Assistant excerpts and can locate their source message on the current ChatGPT page.
- Jumps from a graph node back to its original message when that conversation is open on the current ChatGPT page.
- Tracks pending and resolved questions, supports multiple roots, and protects against parent cycles.
- Persists projects and graph state locally with Dexie and IndexedDB.
- Exports all project graphs to a versioned JSON backup and imports backups as non-destructive project copies.
- Optionally uses an AI provider to summarize questions and recommend logical parent nodes.
- Creates structured reviews from the current logical branch, the currently open conversation, or a selected node with its context.
- Offers 33 review modules and five presets, with per-module results, conclusion states, evidence locations, editing, retry, Markdown export, context-package copy, and graph saving.
- Continues an active review job after its dialog closes. If the browser or MV3 worker interrupts the job, Chat Graph records it as interrupted and asks for a fresh source capture before retrying.

Chat Graph stores discussion structure and review artifacts, not a second chat history. Primary question-node content remains `question`, `summary`, and `status`; nodes may carry bounded reference metadata, thumbnails, and short quoted excerpts. Review generation temporarily reads the selected user and Assistant messages and sends them directly to the configured provider. Full message text is kept only in task memory and is released after completion, cancellation, or failure. Persisted reviews contain structured summaries, source locators, and evidence excerpts limited to 240 characters; full Assistant responses and attachment bodies are not stored.

## Install

### Chrome

1. Download `chatgpt-discussion-map-1.0.0-chrome.zip` from the [latest release](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/releases/latest).
2. Extract the ZIP to a folder you plan to keep.
3. Open `chrome://extensions/` and enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.
5. Open [ChatGPT](https://chatgpt.com/). If it was already open, use **Open page panel** from the side panel; no refresh is required.

Chrome does not automatically update manually loaded extensions. For a future release, replace the extracted files, click **Reload** on the extension card, and refresh the ChatGPT tab.

### Firefox testing

1. Download and extract the Firefox ZIP from the [latest release](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/releases/latest).
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on** and choose the extracted `manifest.json`.

Temporary Firefox add-ons must be loaded again after restarting Firefox. Permanent installation requires a package signed by Mozilla Add-ons.

## Use

Open ChatGPT after installing the extension. The floating panel appears on the page and follows ChatGPT single-page navigation.

- Select or create a project before capturing questions.
- Submit a question normally, select one existing question from the page, or import all user questions from the current conversation.
- Switch between the current-question view and the project graph.
- Use the extension toolbar icon to open the full graph. Firefox also supports `Alt+Shift+G`.
- Open a node menu to inspect it, change its parent or status, locate the original message on the current page, or delete it.
- New nodes default to pending; adding children, changing parents, and bulk graph creation never complete nodes automatically. Status changes are manual.
- Start a review from the floating panel, the project toolbar in the Side Panel, or **Review this node** in a graph node menu.
- Choose **Current branch**, **Entire current conversation**, or **Node context**. A preview reports message and node counts, estimated length, processing strategy, and missing sources. Complete generation is blocked when sources are missing unless you explicitly accept a visibly marked partial review.
- Review results can be edited, copied by module or in full, retried, exported as Markdown, copied as a context package, or saved as a purple document artifact in the graph. Suggested branches create planned question nodes and become captured nodes only after the same normalized question is actually sent.

AI is optional. Without an AI provider, captured questions remain available for manual parent selection.

## Optional AI providers

Chat Graph supports Alibaba Cloud Bailian, OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, and custom OpenAI-compatible HTTPS endpoints. Each provider keeps its own API key, base URL, and model setting. Manual review generation validates the selected provider, model, key, and host permission when you invoke it; it remains available when automatic AI parent recommendation is turned off.

API credentials are stored in extension-local storage. Requests go directly from the extension to the provider selected by the user; this project does not operate a proxy or backend. Provider charges and privacy terms apply.

## Data and privacy

Projects, question nodes, relationships, statuses, message locators, current focus, bounded reference data, review documents, immutable generated versions, current edits, local feedback, job metadata, and evidence excerpts of at most 240 characters are stored in the extension's local IndexedDB database. Reference data may include file metadata, image thumbnails, and short Assistant excerpts, but never attachment bodies, original images, or complete user/Assistant messages collected for a review. Settings, panel preferences, and API credentials are stored in extension-local storage. JSON backup schema v3 contains graph and review artifacts, versions, locators, and short evidence excerpts, but never AI settings, API keys, or full review source messages. There is no account system, analytics service, project server, or cloud synchronization.

The word **branch** in v1.0 means a logical Chat Graph ancestor path. It does not model ChatGPT's native edit/regenerate alternative branches, and an inactive native alternative is never represented as if it had been captured.

Uninstalling the extension or clearing its site/extension data deletes the local graph. Read the full [Privacy Policy](PRIVACY.md) before enabling an AI provider.

## Development

Requirements:

- Node.js 22.22.2 or newer
- npm 10 or newer
- Chrome 116+ or Firefox 115+

Install dependencies and start a development build:

```bash
npm install
npm run dev:chrome
# or
npm run dev:firefox
```

Load `.output/chrome-mv3/` from `chrome://extensions/`, or load `.output/firefox-mv3/manifest.json` from Firefox's debugging page. WXT watches and rebuilds the source; extension reloads and ChatGPT page refreshes may still be required for background, manifest, or content-script changes.

Useful commands:

```bash
npm run compile        # TypeScript checks
npm run test           # Automated tests
npm run test:provider  # Live provider test using local .env values
npm run build          # Chrome and Firefox production builds
npm run zip            # Chrome and Firefox release archives
npm run check          # Compile, test, and build both browsers
```

Do not commit `.env` or real API keys. Start from `.env.example` only when running the optional provider test script.

## Project layout

```text
entrypoints/   Background, ChatGPT content script, and side panel
adapters/      ChatGPT capture, conversation identity, and message location
ai/            Provider registry, request clients, prompts, and schemas
graph/         Discussion services, current path, search, and layout
review/        Review catalog, scope planning, parsing, long-conversation strategy, and export
db/            IndexedDB schema, migrations, and repositories
components/    Side-panel and graph UI
settings/      Local AI configuration
tests/         Domain, browser adapter, interaction, and layout tests
docs/          Roadmap, browser notes, PRDs, and release notes
```

See the [roadmap](docs/ROADMAP.md), [browser support notes](docs/BROWSER_SUPPORT.md), and [changelog](CHANGELOG.md) for implementation details and current limitations.

## Contributing

Bug reports and focused feature proposals are welcome in [GitHub Issues](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/issues). Please include the browser version, extension version, reproduction steps, and any relevant console errors, with private conversation content removed.

## License

Chat Graph is available under the [MIT License](LICENSE).
