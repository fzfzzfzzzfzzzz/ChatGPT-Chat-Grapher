import { describe, expect, it } from "vitest";
import {
  getReviewModule,
  getReviewPreset,
  identifyReviewPreset,
  isReviewModuleId,
  isReviewPresetId,
  modulesForReviewPreset,
  orderReviewModuleIds,
  REVIEW_MODULE_GROUPS,
  REVIEW_MODULE_ORDER,
  REVIEW_MODULES,
  REVIEW_PRESETS,
} from "../review/catalog";

describe("Conversation Review catalog", () => {
  it("defines all 33 modules once in the canonical PRD order", () => {
    expect(REVIEW_MODULES).toHaveLength(33);
    expect(new Set(REVIEW_MODULE_ORDER).size).toBe(33);
    expect(REVIEW_MODULES.slice(0, 10).every(({ common }) => common)).toBe(true);
    expect(REVIEW_MODULES.slice(10).every(({ common }) => !common)).toBe(true);
    expect(REVIEW_MODULE_ORDER.slice(0, 3)).toEqual([
      "discussion_overview",
      "user_goal",
      "key_takeaways",
    ]);
    expect(REVIEW_MODULE_ORDER.at(-1)).toBe("suggested_new_branches");
  });

  it("groups every module exactly once without changing order", () => {
    expect(REVIEW_MODULE_GROUPS.map(({ label }) => label)).toEqual([
      "常用内容",
      "决策复盘",
      "学习与理解",
      "项目落地",
      "对话建图",
    ]);
    expect(REVIEW_MODULE_GROUPS.flatMap(({ moduleIds }) => moduleIds))
      .toEqual(REVIEW_MODULE_ORDER);
  });

  it("provides exactly the five built-in presets", () => {
    expect(REVIEW_PRESETS.map(({ id }) => id)).toEqual([
      "general",
      "technical_project",
      "learning",
      "decision",
      "continue_conversation",
    ]);
    expect(modulesForReviewPreset("general")).toEqual([
      "discussion_overview",
      "user_goal",
      "key_takeaways",
      "consensus",
      "user_decisions",
      "unresolved_questions",
      "next_steps",
    ]);
    expect(getReviewPreset("custom")).toBeUndefined();
  });

  it("supports runtime guards, lookups and preset identification", () => {
    expect(isReviewModuleId("technology_stack")).toBe(true);
    expect(isReviewModuleId("made_up")).toBe(false);
    expect(isReviewPresetId("custom")).toBe(true);
    expect(isReviewPresetId("made_up")).toBe(false);
    expect(getReviewModule("technology_stack").label).toBe("当前技术栈");
    expect(identifyReviewPreset([...modulesForReviewPreset("learning")].reverse()))
      .toBe("learning");
    expect(identifyReviewPreset(["user_goal"])).toBe("custom");
    expect(orderReviewModuleIds(["next_steps", "user_goal", "next_steps"]))
      .toEqual(["user_goal", "next_steps"]);
  });
});
