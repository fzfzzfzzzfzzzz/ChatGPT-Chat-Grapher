# Privacy Policy

[简体中文](PRIVACY.zh-CN.md)

Effective date: August 12, 2026

This policy applies to the official Chat Graph source code and release packages published at [fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher).

## Summary

Chat Graph is a local-first browser extension. It has no developer-operated backend, account system, analytics, advertising, or cloud synchronization. Project data remains in the browser profile unless the user explicitly enables an external AI provider.

## Data accessed on ChatGPT

To provide question capture and navigation, the extension runs on `chatgpt.com` and `chat.openai.com` and may read:

- user questions shown in the current ChatGPT conversation;
- conversation and message identifiers needed to return to an original message;
- the Assistant response immediately following a question selected with the page picker.

The selected Assistant response is used only as temporary context for an optional AI request. Chat Graph does not persist Assistant responses.

ChatGPT is a separate service governed by its own terms and privacy policy. This extension is not affiliated with or endorsed by OpenAI.

## Data stored locally

The extension stores the following information in its IndexedDB database:

- project titles and goals;
- captured user questions and generated or fallback summaries;
- parent relationships, question statuses, candidates, and undo events;
- ChatGPT conversation and message identifiers, anchors, and location metadata;
- project focus and timestamps.

The extension stores the following information in browser extension-local storage:

- selected project and capture state;
- floating-panel position, mode, and requested side-panel view;
- AI feature state, selected provider, model, base URL, thresholds, and API keys.

This data is local to the browser profile and is not synchronized through a Chat Graph service. API keys are not separately encrypted by Chat Graph; they receive the protection provided by the browser's extension storage and the local operating-system account.

## Optional AI requests

AI assistance is disabled unless the user configures and enables it. When enabled, Chat Graph sends a request directly from the browser to the provider selected by the user. Supported destinations include Alibaba Cloud Bailian, OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, and a user-specified OpenAI-compatible HTTPS endpoint.

A recommendation request may contain:

- the newly captured question and a fallback summary;
- questions and summaries from the current path;
- up to 30 candidate nodes, including their IDs, questions, summaries, and statuses;
- for a question added with the page picker, a truncated Assistant response used as temporary analysis context;
- the selected model identifier and the API credential required by the provider.

The project maintainer does not receive or proxy these requests. The selected provider may process, retain, or log request data under its own terms and privacy policy. Users should review those terms before enabling AI assistance. Provider usage may also incur charges to the user's account.

When AI assistance is disabled, Chat Graph does not send project or conversation data to an AI provider.

## Browser permissions

Chat Graph uses:

- `storage` to persist local projects, settings, and interface state;
- access to `chatgpt.com` and `chat.openai.com` to capture questions, display the floating panel, and locate original messages;
- access to Alibaba Cloud API hosts for the built-in Bailian integration;
- optional HTTPS host access, requested for the specific host selected by the user, for other built-in or custom AI providers.

Declining an optional provider permission prevents that provider from receiving requests but does not disable manual graph features.

## Sharing and sale

Chat Graph does not sell personal information. It does not send project data to the project maintainer, advertising networks, or analytics services. Data is disclosed to an AI provider only when the user enables and invokes that integration as described above.

## Retention and deletion

Local data remains until the user deletes a node or project, clears the extension's data in the browser, or uninstalls the extension. Clearing an API key from the settings removes the saved credential. Uninstalling the extension or clearing its storage can permanently remove the local graph because Chat Graph currently has no cloud backup or synchronization service.

Deletion from Chat Graph does not delete information already submitted to ChatGPT or an external AI provider. Those services control their own retention.

## Security

Provider requests require HTTPS. Custom provider URLs are validated to use HTTPS, and host permission is requested before a request is made. No method of local storage or network transmission is guaranteed to be completely secure; users should protect their browser profile and avoid using credentials with broader permissions than necessary.

## Changes

Material changes to this policy will be documented in the repository and identified by an updated effective date. The policy included with a release describes the behavior of that release.

## Contact

For privacy questions or security-sensitive reports, open a minimal-disclosure issue at [GitHub Issues](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/issues). Do not include API keys, private prompts, or full conversation content in a public issue.
