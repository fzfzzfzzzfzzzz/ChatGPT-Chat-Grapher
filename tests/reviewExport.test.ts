import { describe, expect, it } from "vitest";
import {
  buildContinuationContextText,
  buildReviewMarkdown,
  buildReviewMarkdownFilename,
  buildReviewModuleCopyText,
  createReviewMarkdownExport,
} from "../review/export";
import type {
  ReviewEvidence,
  ReviewModuleId,
  ReviewModuleResult,
  ReviewScope,
} from "../types/domain";

function moduleResult(
  moduleId: ReviewModuleId,
  overview: string,
  text: string,
): ReviewModuleResult {
  return {
    moduleId,
    state: "completed",
    generated: {
      overview: "Original model overview",
      items: [{
        id: "generated-item",
        text: "Original model item",
        status: "assistant_suggestion",
        isInference: false,
        evidenceIds: ["evidence-1"],
      }],
    },
    current: {
      overview,
      items: [{
        id: "edited-item",
        text,
        status: "user_decision",
        isInference: true,
        evidenceIds: ["evidence-1", "missing-evidence"],
      }],
    },
    editHistory: [],
    editedAt: 123,
  };
}

const scope: ReviewScope = {
  type: "current_branch",
  chatId: "chat-1",
  anchorNodeId: "node-1",
  rootNodeId: "node-0",
  nodeIds: ["node-0", "node-1"],
  messageSourceIds: ["source-1"],
  messageCount: 1,
  nodeCount: 2,
  includesOtherBranches: false,
  completeness: "partial",
  missingSourceIds: ["node:missing"],
  estimatedTokens: 100,
  sourceSnapshotHash: "hash",
};
const evidence: ReviewEvidence = {
  id: "evidence-1",
  sourceId: "source-1",
  chatId: "chat-1",
  role: "user",
  excerpt: "This is the supporting message.",
  ordinal: 0,
  locator: {
    version: 1,
    chatId: "chat-1",
    role: "user",
    ordinal: 0,
    fingerprint: "fingerprint",
  },
};
const generatedAt = new Date(2026, 7, 24, 12, 0).getTime();

function version() {
  return {
    title: "Edited Review",
    scope,
    moduleOrder: ["next_steps"] as ReviewModuleId[],
    modules: [moduleResult("next_steps", "Edited overview", "Edited action")],
    evidences: [evidence],
    segmented: true,
    segmentCount: 3,
    missingRanges: ["segment-2"],
    generatedAt,
  };
}

describe("Conversation Review Markdown and copy export", () => {
  it("exports the current edited draft with metadata and no evidence by default", () => {
    const markdown = buildReviewMarkdown(version());

    expect(markdown).toContain("# Edited Review");
    expect(markdown).toContain("总结范围：当前分支");
    expect(markdown).toContain("完整性：部分完整");
    expect(markdown).toContain("分段整理（3 段）");
    expect(markdown).toContain("缺失内容：1 项来源、1 个处理分段");
    expect(markdown).not.toContain("node:missing");
    expect(markdown).not.toContain("segment-2");
    expect(markdown).toContain("## 下一步应该做什么");
    expect(markdown).toContain("Edited overview");
    expect(markdown).toContain("Edited action");
    expect(markdown).toContain("[用户决定 · 系统推断]");
    expect(markdown).not.toContain("Original model item");
    expect(markdown).not.toContain("This is the supporting message.");
  });

  it("optionally renders valid evidence and labels unavailable locators", () => {
    const markdown = buildReviewMarkdown(version(), { includeEvidence: true });
    expect(markdown).toContain("依据（用户，消息 1）：This is the supporting message.");
    expect(markdown).toContain("依据：来源不可用");
  });

  it("copies one module without leaking internal ids", () => {
    const copied = buildReviewModuleCopyText(
      version().modules[0]!,
      [evidence],
      { includeEvidence: true },
    );
    expect(copied).toContain("## 下一步应该做什么");
    expect(copied).not.toContain("edited-item");
    expect(copied).not.toContain("source-1");
  });

  it("uses a dedicated continuation module or a compact fallback context", () => {
    const explicit = moduleResult(
      "continuation_context",
      "Known goal and constraints",
      "Continue with implementation",
    );
    expect(buildContinuationContextText([explicit])).toContain("Known goal and constraints");

    const fallback = buildContinuationContextText([
      moduleResult("user_goal", "Build v1", "Keep it local-first"),
      moduleResult("next_steps", "Implement", "Run tests"),
    ]);
    expect(fallback).toContain("不要重复询问已经明确的信息");
    expect(fallback).toContain("我的目标是什么");
    expect(fallback).toContain("下一步应该做什么");
  });

  it("creates safe, recognizable Markdown filenames", () => {
    expect(buildReviewMarkdownFilename("CON", generatedAt))
      .toBe("CON-review-2026-08-24.md");
    expect(buildReviewMarkdownFilename("CON.notes", generatedAt))
      .toBe("review-CON.notes-2026-08-24.md");
    const filename = buildReviewMarkdownFilename("Architecture: API/DB?", generatedAt);
    expect(filename).toBe("Architecture- API-DB--2026-08-24.md");
    expect(filename).not.toMatch(/[<>:"/\\|?*]/);

    const artifact = createReviewMarkdownExport(version());
    expect(artifact.filename).toBe("Edited Review-2026-08-24.md");
    expect(artifact.mimeType).toBe("text/markdown;charset=utf-8");
    expect(artifact.content).toContain("Edited action");
  });
});
