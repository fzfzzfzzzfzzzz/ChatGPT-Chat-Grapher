// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/c/chat-1"}

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractQuestionReferences } from "../adapters/chatgpt/referenceCapture";
import {
  getCapturedQuestionFromElement,
  locateQuestionReferenceOnCurrentPage,
} from "../adapters/chatgpt/questionCapture";
import {
  QuestionReferenceBadges,
  QuestionReferenceList,
} from "../components/QuestionReferenceList";
import {
  countQuestionReferences,
  sanitizeQuestionReferences,
} from "../shared/questionReferences";
import type { QuestionReference } from "../types/domain";

const thumbnail = "data:image/png;base64,iVBORw0KGgo=";

describe("question references", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it("extracts files, images, and quoted assistant answers in DOM order", () => {
    document.body.innerHTML = `
      <article data-turn-id="answer-turn">
        <div data-message-author-role="assistant" data-message-id="answer-1">answer</div>
      </article>
      <article data-turn-id="question-turn">
        <div data-message-author-role="user" data-message-id="question-1">
          <div data-testid="file-attachment" data-file-name="requirements.pdf" data-mime-type="application/pdf" data-file-size="2048"></div>
          <img alt="Architecture diagram" src="${thumbnail}">
          <blockquote data-source-message-id="answer-1"></blockquote>
        </div>
      </article>`;
    const assistant = document.querySelector<HTMLElement>('[data-message-author-role="assistant"]')!;
    const quote = document.querySelector<HTMLElement>("blockquote")!;
    Object.defineProperty(assistant, "innerText", { value: "Use a two-layer cache for this design." });
    Object.defineProperty(quote, "innerText", { value: "Use a two-layer cache for this design." });
    const message = document.querySelector<HTMLElement>('[data-message-author-role="user"]')!;
    const references = extractQuestionReferences(message, "chat-1", {
      version: 1,
      messageId: "question-1",
      turnId: "question-turn",
      ordinal: 0,
      fingerprint: "question-fingerprint",
    });

    expect(references.map((reference) => reference.type)).toEqual([
      "file",
      "image",
      "assistant_quote",
    ]);
    expect(references[0]).toMatchObject({
      name: "requirements.pdf",
      mimeType: "application/pdf",
      size: 2048,
    });
    expect(references[1]).toMatchObject({
      alt: "Architecture diagram",
      thumbnailDataUrl: thumbnail,
    });
    expect(references[2]).toMatchObject({
      excerpt: "Use a two-layer cache for this design.",
      sourceLocator: { role: "assistant", messageId: "answer-1" },
    });
    expect(countQuestionReferences(references)).toEqual({
      files: 1,
      images: 1,
      assistantQuotes: 1,
      total: 3,
    });
  });

  it("captures an attachment-only user turn with a generated question label", () => {
    document.body.innerHTML = `
      <article data-turn-id="question-turn">
        <div data-message-author-role="user" data-message-id="question-1">
          <div data-testid="file-attachment" data-file-name="requirements.pdf"></div>
        </div>
      </article>`;
    const message = document.querySelector<HTMLElement>('[data-message-author-role="user"]')!;
    Object.defineProperty(message, "innerText", { value: "" });
    expect(getCapturedQuestionFromElement(message)).toMatchObject({
      question: "附件：requirements.pdf",
      references: [{ type: "file", name: "requirements.pdf" }],
    });
  });

  it("keeps quoted assistant text out of the captured question body", () => {
    document.body.innerHTML = `
      <article data-turn-id="question-turn">
        <div data-message-author-role="user" data-message-id="question-1">
          <p>How should I apply this suggestion?</p>
          <blockquote data-source-message-id="answer-1">Use a two-layer cache.</blockquote>
        </div>
      </article>`;
    const message = document.querySelector<HTMLElement>('[data-message-author-role="user"]')!;
    const quote = document.querySelector<HTMLElement>("blockquote")!;
    Object.defineProperty(message, "innerText", {
      value: "How should I apply this suggestion? Use a two-layer cache.",
    });
    Object.defineProperty(quote, "innerText", { value: "Use a two-layer cache." });
    expect(getCapturedQuestionFromElement(message)).toMatchObject({
      question: "How should I apply this suggestion?",
      references: [{ type: "assistant_quote", excerpt: "Use a two-layer cache." }],
    });
  });

  it("sanitizes unsupported thumbnails and duplicate reference ids", () => {
    expect(sanitizeQuestionReferences([
      { id: "same", type: "image", alt: "Preview", thumbnailDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
      { id: "same", type: "file", name: "notes.txt" },
      { id: "quote", type: "assistant_quote", excerpt: "Referenced answer" },
    ])).toEqual([
      { id: "same", type: "image", alt: "Preview" },
      { id: "quote", type: "assistant_quote", excerpt: "Referenced answer" },
    ]);
  });

  it("locates an assistant reference by its stable message id", async () => {
    document.body.innerHTML = `
      <article data-turn-id="answer-turn">
        <div data-message-author-role="assistant" data-message-id="answer-1">Referenced answer</div>
      </article>`;
    const article = document.querySelector<HTMLElement>("article")!;
    const assistant = document.querySelector<HTMLElement>('[data-message-author-role="assistant"]')!;
    Object.defineProperty(assistant, "innerText", { value: "Referenced answer" });
    article.scrollIntoView = vi.fn();
    article.animate = vi.fn(() => ({}) as Animation);
    const reference: QuestionReference & { sourceLocator: NonNullable<QuestionReference["sourceLocator"]> } = {
      id: "quote-1",
      type: "assistant_quote",
      excerpt: "Referenced answer",
      sourceLocator: {
        version: 1,
        chatId: "chat-1",
        role: "assistant",
        messageId: "answer-1",
      },
    };

    await expect(locateQuestionReferenceOnCurrentPage(reference, "chat-1")).resolves.toEqual({
      ok: true,
      method: "messageId",
    });
    expect(article.scrollIntoView).toHaveBeenCalled();
  });

  it("renders reference cards and requests source navigation", async () => {
    const onLocate = vi.fn(async () => undefined);
    const references: QuestionReference[] = [
      {
        id: "file-1",
        type: "file",
        name: "requirements.pdf",
        size: 2048,
        sourceLocator: { version: 1, chatId: "chat-1", role: "user", messageId: "question-1" },
      },
      { id: "image-1", type: "image", alt: "Architecture diagram", thumbnailDataUrl: thumbnail },
      { id: "quote-1", type: "assistant_quote", excerpt: "Referenced answer" },
    ];
    render(<QuestionReferenceList references={references} onLocate={onLocate} />);

    expect(screen.getByText("requirements.pdf")).toBeDefined();
    expect(screen.getByAltText("Architecture diagram")).toBeDefined();
    expect(screen.getByText("Referenced answer")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "定位引用原文：requirements.pdf" }));
    expect(onLocate).toHaveBeenCalledWith(references[0]);
  });

  it("opens node details from a compact reference badge", async () => {
    const onOpen = vi.fn();
    render(
      <QuestionReferenceBadges
        references={[
          { id: "file-1", type: "file", name: "requirements.pdf" },
          { id: "quote-1", type: "assistant_quote", excerpt: "Referenced answer" },
        ]}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "查看引用内容，共 2 条" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
