import { describe, expect, it } from "vitest";
import {
  buildReviewFactExtractionPrompt,
  buildReviewPrompt,
  estimateReviewAncestorContextTokens,
  limitReviewPromptFacts,
  parseReviewFactsResponse,
  parseReviewResponse,
  REVIEW_EVIDENCE_EXCERPT_LIMIT,
  REVIEW_FACT_CONTEXT_TOKEN_LIMIT,
} from "../review/prompt";
import { estimateTextTokens } from "../review/processing";
import type { ConversationReviewMessage } from "../types/domain";

function source(
  sourceId: string,
  role: "user" | "assistant",
  ordinal: number,
  content = `${sourceId} content`,
): ConversationReviewMessage {
  return {
    sourceId,
    chatId: "chat-1",
    role,
    content,
    ordinal,
    locator: {
      version: 1,
      chatId: "chat-1",
      role,
      ordinal,
      fingerprint: `fingerprint-${sourceId}`,
    },
    nodeId: `node-${sourceId}`,
    branchPath: ["root", `node-${sourceId}`],
  };
}

describe("Conversation Review prompts", () => {
  it("bounds ancestor metadata and extracted facts before the final request", () => {
    const ancestorContext = Array.from({ length: 40 }, (_, index) => ({
      id: `node-${index}`,
      parentId: index ? `node-${index - 1}` : null,
      question: "超长问题".repeat(1_000),
      summary: "超长摘要".repeat(1_000),
      chatId: "chat-1",
      updatedAt: index,
      depthFromTarget: index + 1,
    }));
    const facts = Array.from({ length: 200 }, (_, index) => ({
      text: `事实 ${index} ` + "内容".repeat(1_000),
      sourceIds: [`source-${index}`],
    }));
    const prompt = buildReviewPrompt({
      selectedModuleIds: ["discussion_overview"],
      facts,
      ancestorContext,
    });
    const payload = JSON.parse(prompt.userPrompt) as { facts: unknown[]; ancestorContext: unknown[] };

    expect(estimateReviewAncestorContextTokens(ancestorContext)).toBeLessThanOrEqual(3_500);
    expect(estimateTextTokens(JSON.stringify(limitReviewPromptFacts(facts))))
      .toBeLessThanOrEqual(REVIEW_FACT_CONTEXT_TOKEN_LIMIT);
    expect(payload.facts.length).toBeLessThan(facts.length);
    expect(payload.ancestorContext.length).toBeLessThan(ancestorContext.length);
  });

  it("builds a strict selected-module prompt with source ids", () => {
    const message = source("source-1", "user", 0, "I choose option A.");
    const prompt = buildReviewPrompt({
      selectedModuleIds: ["next_steps", "user_decisions"],
      messages: [message],
      scope: {
        type: "current_branch",
        chatId: "chat-1",
        completeness: "complete",
        missingSourceIds: [],
      },
    });
    const payload = JSON.parse(prompt.userPrompt);

    expect(payload.selectedModuleIds).toEqual(["user_decisions", "next_steps"]);
    expect(payload.messages[0]).toEqual(expect.objectContaining({
      sourceId: "source-1",
      content: "I choose option A.",
    }));
    expect(prompt.systemPrompt).toContain("user_decisions");
    expect(prompt.systemPrompt).toContain("next_steps");
    expect(prompt.systemPrompt).not.toContain("technology_stack（当前技术栈）");
    expect(prompt.systemPrompt).toContain("只能引用输入中真实存在的 sourceId");
  });

  it("builds a segment fact-extraction request without adding other messages", () => {
    const prompt = buildReviewFactExtractionPrompt(
      [source("only-source", "assistant", 5)],
      2,
      4,
    );
    const payload = JSON.parse(prompt.userPrompt);
    expect(payload.segmentIndex).toBe(2);
    expect(payload.segmentCount).toBe(4);
    expect(payload.messages.map(({ sourceId }: { sourceId: string }) => sourceId))
      .toEqual(["only-source"]);
  });
});

describe("Conversation Review response parser", () => {
  it("keeps selected modules in canonical order and validates all evidence", () => {
    const longContent = "证".repeat(300);
    const messages = [
      source("source-1", "user", 0, longContent),
      source("source-2", "assistant", 1),
    ];
    const parsed = parseReviewResponse({
      modules: [
        {
          moduleId: "next_steps",
          overview: "Continue implementation.",
          items: [{
            text: "Implement tests",
            status: "助手建议",
            isInference: false,
            evidenceSourceIds: ["source-2"],
          }],
        },
        {
          moduleId: "user_decisions",
          overview: "Option A was chosen.",
          items: [{
            id: "decision-1",
            text: "Use option A",
            status: "user_decision",
            isInference: false,
            evidenceSourceIds: ["source-1", "invented-source"],
          }],
        },
        { moduleId: "technology_stack", overview: "ignored", items: [] },
        { moduleId: "unknown_module", overview: "ignored", items: [] },
      ],
    }, ["next_steps", "user_decisions"], messages);

    expect(parsed.modules.map(({ moduleId }) => moduleId)).toEqual([
      "user_decisions",
      "next_steps",
    ]);
    expect(parsed.modules[0]?.current.items[0]).toEqual(expect.objectContaining({
      status: "user_decision",
      isInference: true,
      evidenceIds: [expect.stringMatching(/^review-evidence-/)],
    }));
    expect(parsed.modules[1]?.current.items[0]?.status).toBe("assistant_suggestion");
    expect(parsed.evidences).toHaveLength(2);
    expect(parsed.evidences[0]?.excerpt.length).toBe(REVIEW_EVIDENCE_EXCERPT_LIMIT);
    expect(parsed.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "UNKNOWN_EVIDENCE",
      "UNSELECTED_MODULE",
      "UNKNOWN_MODULE",
    ]));
  });

  it("marks empty modules and fails every selected module omitted by the model", () => {
    const parsed = parseReviewResponse(JSON.stringify({
      modules: [{ moduleId: "consensus", overview: "", items: [] }],
    }), ["consensus", "next_steps"], []);

    expect(parsed.modules[0]).toEqual(expect.objectContaining({ state: "empty" }));
    expect(parsed.modules[0]?.current.overview).toBe("本轮未发现相关内容");
    expect(parsed.modules[1]).toEqual(expect.objectContaining({
      moduleId: "next_steps",
      state: "failed",
    }));
    expect(parsed.failedModuleIds).toEqual(["next_steps"]);
  });

  it("downgrades decision or consensus states that have no user evidence", () => {
    const assistant = source("assistant-only", "assistant", 1);
    const parsed = parseReviewResponse({
      modules: [{
        moduleId: "user_decisions",
        overview: "",
        items: [
          {
            text: "Use the assistant's option",
            status: "user_decision",
            isInference: false,
            evidenceSourceIds: ["assistant-only"],
          },
          {
            text: "Everyone agrees",
            status: "consensus",
            isInference: false,
            evidenceSourceIds: [],
          },
        ],
      }],
    }, ["user_decisions"], [assistant]);

    expect(parsed.modules[0]?.current.items).toEqual([
      expect.objectContaining({ status: "assistant_suggestion", isInference: true }),
      expect.objectContaining({ status: "tentative", isInference: true }),
    ]);
    expect(parsed.issues.filter(({ code }) => code === "UNSUPPORTED_STATUS_EVIDENCE"))
      .toHaveLength(2);
  });

  it("removes branch source nodes outside the captured graph allowlist", () => {
    const parsed = parseReviewResponse({
      modules: [{
        moduleId: "suggested_new_branches",
        overview: "Two candidates",
        items: [],
        branchCandidates: [
          {
            title: "Allowed",
            rationale: "Worth exploring",
            firstQuestion: "What next?",
            sourceNodeId: "root",
          },
          {
            title: "Unknown",
            rationale: "Worth exploring",
            firstQuestion: "What next?",
            sourceNodeId: "invented-node",
          },
        ],
      }],
    }, ["suggested_new_branches"], [source("source-1", "user", 0)]);

    expect(parsed.modules[0]?.current.branchCandidates).toEqual([
      expect.objectContaining({ title: "Allowed", sourceNodeId: "root" }),
      expect.not.objectContaining({ sourceNodeId: "invented-node" }),
    ]);
    expect(parsed.issues).toContainEqual(expect.objectContaining({
      code: "UNKNOWN_NODE_REFERENCE",
      nodeId: "invented-node",
    }));
  });

  it("turns invalid JSON into isolated failed module results", () => {
    const parsed = parseReviewResponse("not json", ["user_goal", "next_steps"], []);
    expect(parsed.modules.every(({ state }) => state === "failed")).toBe(true);
    expect(parsed.issues[0]?.code).toBe("INVALID_JSON");
  });

  it("validates fact extraction source ids before facts are reused", () => {
    const parsed = parseReviewFactsResponse({
      facts: [{
        text: "User selected A",
        status: "user_decision",
        sourceIds: ["source-1", "ghost"],
        branchPath: ["root"],
      }],
    }, [source("source-1", "user", 0)]);

    expect(parsed.facts).toEqual([expect.objectContaining({
      sourceIds: ["source-1"],
      isInference: true,
      status: "user_decision",
    })]);
    expect(parsed.issues[0]).toEqual(expect.objectContaining({
      code: "UNKNOWN_EVIDENCE",
      sourceId: "ghost",
    }));
  });
});
