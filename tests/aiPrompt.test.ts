import { describe, expect, it } from "vitest";
import {
  buildParentRecommendationInput,
  PARENT_RECOMMENDATION_SYSTEM_PROMPT,
} from "../ai/prompt";
import type { ParentRecommendationInput } from "../types/domain";

function input(overrides: Partial<ParentRecommendationInput> = {}): ParentRecommendationInput {
  return {
    question: "How should this question be organized?",
    fallbackSummary: "Organize one selected question.",
    currentPath: [],
    candidateNodes: [],
    ...overrides,
  };
}

describe("parent recommendation prompt", () => {
  it("includes selected answer context when it is available", () => {
    const payload = JSON.parse(buildParentRecommendationInput(input({
      assistantContext: "The assistant clarified the intended implementation.",
    })));
    expect(payload.assistant_context)
      .toBe("The assistant clarified the intended implementation.");
    expect(PARENT_RECOMMENDATION_SYSTEM_PROMPT).toContain("临时参考");
    expect(PARENT_RECOMMENDATION_SYSTEM_PROMPT).toContain("不要复述或保存回答内容");
  });

  it("omits answer context for normal captures without a completed answer", () => {
    const payload = JSON.parse(buildParentRecommendationInput(input()));
    expect(payload).not.toHaveProperty("assistant_context");
  });
});
