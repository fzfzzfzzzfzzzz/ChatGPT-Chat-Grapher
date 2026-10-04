# Privacy Policy

[简体中文](PRIVACY.zh-CN.md)

Effective date: August 24, 2026

This policy applies to the official Chat Graph source code and release packages published at [fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher).

## Summary

Chat Graph is a local-first browser extension. It has no developer-operated backend, account system, analytics, advertising, or cloud synchronization. Project data remains in the browser profile unless the user explicitly enables an external AI provider.

## Data accessed on ChatGPT

To provide question capture, navigation, and user-requested reviews, the extension runs on `chatgpt.com` and `chat.openai.com` and may read:

- user questions shown in the current ChatGPT conversation;
- attachment names, file metadata, images, and quote blocks displayed inside user questions;
- conversation and message identifiers needed to return to an original message;
- the Assistant response immediately following a question selected with the page picker.
- user and Assistant messages in the review scope selected by the user.

The full Assistant response read by the page picker is used only as temporary context for an optional AI request. If a user question contains an Assistant quote, Chat Graph stores at most 500 characters of that quoted excerpt and its source locator, but does not persist the full response.

For a conversation review, Chat Graph may scroll through ChatGPT's virtualized history, collect the selected messages, and restore the prior scroll position. Source message text exists only in task memory while it is collected, organized, and sent to the configured AI provider. It is not written to IndexedDB, extension-local storage, logs, or JSON backups. It is released after the task completes, is cancelled, or fails. If the browser or MV3 worker stops the task, the persisted job is marked interrupted, but the in-memory source text is not recoverable; retry requires a new capture.

ChatGPT is a separate service governed by its own terms and privacy policy. This extension is not affiliated with or endorsed by OpenAI.

## Data stored locally

The extension stores the following information in its IndexedDB database:

- project titles and goals;
- captured user questions and generated or fallback summaries;
- parent relationships, question statuses, candidates, and undo events;
- ChatGPT conversation and message identifiers, anchors, and location metadata;
- referenced-file metadata, bounded image thumbnails, short quoted Assistant excerpts, and their source locators;
- structured review documents, immutable generated versions, the current edited draft, and up to 20 local undo snapshots per version;
- review scope metadata, selected modules, job status and progress, local helpful/not-helpful feedback, and per-module feedback;
- review evidence source locators and excerpts limited to 240 characters;
- project focus and timestamps.

The extension stores the following information in browser extension-local storage:

- selected project and capture state;
- floating-panel position, mode, and requested side-panel view;
- AI feature state, selected provider, model, base URL, thresholds, and API keys.

This data is local to the browser profile and is not synchronized through a Chat Graph service. API keys are not separately encrypted by Chat Graph; they receive the protection provided by the browser's extension storage and the local operating-system account.

When the user selects **Export JSON**, Chat Graph creates a local schema-v3 backup containing the IndexedDB project, graph, review document, review version, locator, reference, thumbnail, and short-excerpt data listed above. The backup does not contain review source messages, AI settings, or API keys. Import reads the selected file locally, supports older v1/v2 backups, and creates new project copies with remapped internal IDs without uploading the file or overwriting existing projects. The user controls where exported files are stored and shared.

## Optional AI requests

No AI request can run unless the user configures a provider. Automatic parent recommendation additionally requires its feature switch; conversation review requires an explicit generate action. Requests go directly from the browser to the provider selected by the user. Supported destinations include Alibaba Cloud Bailian, OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, and a user-specified OpenAI-compatible HTTPS endpoint.

A recommendation request may contain:

- the newly captured question and a fallback summary;
- questions and summaries from the current path;
- up to 30 candidate nodes, including their IDs, questions, summaries, and statuses;
- for a question added with the page picker, a truncated Assistant response used as temporary analysis context;
- the selected model identifier and the API credential required by the provider.

A conversation-review request may contain:

- the user and Assistant message text in the selected review scope, with message/turn identifiers and ordering metadata;
- existing question text or short summaries from relevant Chat Graph nodes;
- the selected review modules, scope, output instructions, and source-ID allowlist;
- for a long conversation, overlapping source chunks followed by extracted facts and batches of up to six requested modules;
- the selected model identifier and the API credential required by the provider.

The complete source text is transmitted only for the review the user explicitly starts. Selecting a range or opening the review interface does not by itself send source text. Closing that interface does not cancel an already-started task; use the task's cancel action to request cancellation.

The project maintainer does not receive or proxy these requests. The selected provider may process, retain, or log request data under its own terms and privacy policy. Users should review those terms before enabling AI assistance. Provider usage may also incur charges to the user's account.

Stored attachment names, image thumbnails, and quoted Assistant excerpts are not included in parent-recommendation requests by default.

The **AI parent recommendation** switch controls automatic parent recommendations only. Turning it off prevents those automatic requests, but a manual conversation review still sends its selected source after the user starts generation and the current provider, model, API key, and host permission pass validation. Without a configured provider, Chat Graph does not generate an AI review or send its source.

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

Local data remains until the user deletes the relevant item or project, clears the extension's data in the browser, or uninstalls the extension. Review version history is not automatically expired and remains until its review document or project is deleted. Deleting a review artifact removes its document and versions. Deleting a source question node does not automatically delete an existing review; its evidence locator remains and may be shown as unavailable if the source can no longer be located. Clearing an API key from the settings removes the saved credential. Uninstalling the extension or clearing its storage can permanently remove the local graph and reviews unless the user has created a JSON backup. Exported backup files remain wherever the user saved them and must be deleted separately.

Deletion from Chat Graph does not delete information already submitted to ChatGPT or an external AI provider. Those services control their own retention.

## Security

Provider requests require HTTPS. Custom provider URLs are validated to use HTTPS, and host permission is requested before a request is made. No method of local storage or network transmission is guaranteed to be completely secure; users should protect their browser profile and avoid using credentials with broader permissions than necessary.

## Changes

Material changes to this policy will be documented in the repository and identified by an updated effective date. The policy included with a release describes the behavior of that release.

## Contact

For privacy questions or security-sensitive reports, open a minimal-disclosure issue at [GitHub Issues](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/issues). Do not include API keys, private prompts, or full conversation content in a public issue.
