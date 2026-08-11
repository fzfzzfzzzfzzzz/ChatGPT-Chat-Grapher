# Chat Graph

[简体中文](README.zh-CN.md) | [Privacy](PRIVACY.md) | [Changelog](CHANGELOG.md)

[![Release](https://img.shields.io/github/v/release/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher)](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Chat Graph is a local-first Chrome and Firefox extension that turns the questions in long ChatGPT conversations into a navigable question tree or forest. It keeps the current question, its logical parent, unfinished branches, and the original message location within reach without creating a second copy of the conversation.

The current release is **v0.9.0 - Multi-provider AI API**.

## What it does

- Captures questions submitted on ChatGPT and adds one candidate per submission.
- Shows the current question and its logical parent in a persistent floating panel.
- Builds a question graph from selected messages or from all user questions in the current conversation.
- Opens the full graph in the Chrome Side Panel or Firefox Sidebar.
- Searches questions and summaries across conversations in the current project.
- Jumps from a graph node back to its original ChatGPT message.
- Tracks pending and resolved questions, supports multiple roots, and protects against parent cycles.
- Persists projects and graph state locally with Dexie and IndexedDB.
- Optionally uses an AI provider to summarize questions and recommend logical parent nodes.

Chat Graph stores discussion structure, not a second chat history. Node content is intentionally limited to `question`, `summary`, and `status`; Assistant responses are not stored.

## Install

### Chrome

1. Download `chatgpt-discussion-map-0.9.0-chrome.zip` from the [latest release](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/releases/latest).
2. Extract the ZIP to a folder you plan to keep.
3. Open `chrome://extensions/` and enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.
5. Open or refresh [ChatGPT](https://chatgpt.com/).

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
- Open a node menu to inspect it, change its parent or status, locate the original message, or delete it.

AI is optional. Without an AI provider, captured questions remain available for manual parent selection.

## Optional AI providers

Chat Graph supports Alibaba Cloud Bailian, OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, and custom OpenAI-compatible HTTPS endpoints. Each provider keeps its own API key, base URL, and model setting.

API credentials are stored in extension-local storage. Requests go directly from the extension to the provider selected by the user; this project does not operate a proxy or backend. Provider charges and privacy terms apply.

## Data and privacy

Projects, question nodes, relationships, statuses, message locators, and current focus are stored in the extension's local IndexedDB database. Settings, panel preferences, and API credentials are stored in extension-local storage. There is no account system, analytics service, project server, or cloud synchronization.

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
