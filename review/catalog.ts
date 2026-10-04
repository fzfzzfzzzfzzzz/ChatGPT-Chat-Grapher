import type { ReviewModuleId, ReviewPresetId } from "../types/domain";

export type ReviewModuleGroupId =
  | "common"
  | "decision"
  | "learning"
  | "project"
  | "graph";

export type ReviewModuleDefinition = {
  id: ReviewModuleId;
  label: string;
  group: ReviewModuleGroupId;
  common: boolean;
  prompt: string;
};

export type ReviewModuleGroupDefinition = {
  id: ReviewModuleGroupId;
  label: string;
  moduleIds: readonly ReviewModuleId[];
};

export type BuiltInReviewPresetId = Exclude<ReviewPresetId, "custom">;

export type ReviewPresetDefinition = {
  id: BuiltInReviewPresetId;
  label: string;
  moduleIds: readonly ReviewModuleId[];
};

/**
 * The canonical display and generation order for every Conversation Review module.
 * Keep this list aligned with the product information architecture; callers should
 * not sort module ids alphabetically.
 */
export const REVIEW_MODULES = [
  {
    id: "discussion_overview",
    label: "我们讨论了什么",
    group: "common",
    common: true,
    prompt: "概括本轮讨论的主题、演进过程和主要分支，避免复述逐条消息。",
  },
  {
    id: "user_goal",
    label: "我的目标是什么",
    group: "common",
    common: true,
    prompt: "提炼用户明确表达的目标，并区分目标与助手推测。",
  },
  {
    id: "key_takeaways",
    label: "我获得了什么关键收获",
    group: "common",
    common: true,
    prompt: "提炼对用户最有复用价值的新认识和关键收获。",
  },
  {
    id: "consensus",
    label: "最终达成了什么共识",
    group: "common",
    common: true,
    prompt: "仅列出双方有明确依据的共识，不把助手单方面建议当作共识。",
  },
  {
    id: "user_decisions",
    label: "我最终做出了什么决定",
    group: "common",
    common: true,
    prompt: "仅列出用户明确作出的决定，并采用对话中最新的决定状态。",
  },
  {
    id: "unresolved_questions",
    label: "还有哪些问题没有解决",
    group: "common",
    common: true,
    prompt: "列出仍未得到答案或尚未形成结论的问题。",
  },
  {
    id: "missed_branches",
    label: "哪些讨论分支被遗漏",
    group: "common",
    common: true,
    prompt: "识别被中断、被跳过或值得回访但尚未继续的讨论分支。",
  },
  {
    id: "user_confusions",
    label: "我有哪些地方没搞清楚",
    group: "common",
    common: true,
    prompt: "依据用户追问或明确表述，列出仍然困惑的内容，避免臆测。",
  },
  {
    id: "next_steps",
    label: "下一步应该做什么",
    group: "common",
    common: true,
    prompt: "给出对话已经支持的具体后续动作，区分已决定行动与助手建议。",
  },
  {
    id: "continuation_context",
    label: "下次继续对话的上下文包",
    group: "common",
    common: true,
    prompt: "生成脱离原会话也能理解的精炼上下文，优先保留目标、决定、约束、方案、未解决问题和下一步。",
  },
  {
    id: "considered_options",
    label: "考虑过哪些方案",
    group: "decision",
    common: false,
    prompt: "列出实际讨论过的候选方案以及各自用途。",
  },
  {
    id: "disagreements",
    label: "中间有哪些分歧",
    group: "decision",
    common: false,
    prompt: "保留用户与助手或不同分支之间尚未消解的观点差异。",
  },
  {
    id: "tradeoffs",
    label: "最终选择时做了哪些取舍",
    group: "decision",
    common: false,
    prompt: "说明选择方案时明确讨论的收益、代价和取舍依据。",
  },
  {
    id: "rejected_or_deferred_options",
    label: "哪些方案被否决、暂缓或排除在当前版本外",
    group: "decision",
    common: false,
    prompt: "区分已否决、已延后和仅排除在当前版本外的方案及原因。",
  },
  {
    id: "assumptions_constraints",
    label: "当前结论依赖哪些假设和约束",
    group: "decision",
    common: false,
    prompt: "列出影响结论的已知假设、边界和硬性约束。",
  },
  {
    id: "facts_to_verify",
    label: "哪些信息仍需验证",
    group: "decision",
    common: false,
    prompt: "列出对话中尚未核实、需要外部确认的事实，不自行联网判断。",
  },
  {
    id: "clarified_technical_details",
    label: "哪些技术细节已经解释清楚",
    group: "learning",
    common: false,
    prompt: "总结已有充分解释且用户未继续质疑的技术细节。",
  },
  {
    id: "understanding_changes",
    label: "我的认知发生了什么变化",
    group: "learning",
    common: false,
    prompt: "依据前后消息比较用户理解的变化，缺少直接依据时标记推断。",
  },
  {
    id: "important_terms",
    label: "本轮出现了哪些重要术语",
    group: "learning",
    common: false,
    prompt: "列出理解本轮讨论必需的重要术语及其在本对话中的含义。",
  },
  {
    id: "prerequisite_gaps",
    label: "我还缺少哪些前置知识",
    group: "learning",
    common: false,
    prompt: "根据对话证据指出继续理解主题所需但尚未掌握的前置知识。",
  },
  {
    id: "product_problem",
    label: "产品要解决什么问题",
    group: "project",
    common: false,
    prompt: "描述产品的目标用户、核心问题和预期价值。",
  },
  {
    id: "confirmed_scope",
    label: "当前确认了哪些需求和范围",
    group: "project",
    common: false,
    prompt: "整理已确认需求、范围边界以及明确不做的内容。",
  },
  {
    id: "solution_architecture",
    label: "当前方案和系统架构",
    group: "project",
    common: false,
    prompt: "整理当前方案、主要组件及组件间关系，保留暂定状态。",
  },
  {
    id: "technology_stack",
    label: "当前技术栈",
    group: "project",
    common: false,
    prompt: "列出已采用或正在评估的技术栈，并标明决定状态。",
  },
  {
    id: "business_technical_flow",
    label: "完整业务流程和技术流程",
    group: "project",
    common: false,
    prompt: "按顺序整理已经讨论的业务流程和对应技术数据流。",
  },
  {
    id: "data_interfaces_tools_skills",
    label: "数据、接口、Tools 和 Skills",
    group: "project",
    common: false,
    prompt: "整理涉及的数据、内部或外部接口、工具和技能能力。",
  },
  {
    id: "risks_dependencies",
    label: "风险和依赖",
    group: "project",
    common: false,
    prompt: "列出项目风险、阻塞条件和内外部依赖。",
  },
  {
    id: "progress_release_plan",
    label: "当前进度与版本计划",
    group: "project",
    common: false,
    prompt: "整理已完成、进行中、待完成内容以及版本安排。",
  },
  {
    id: "acceptance_criteria",
    label: "验收标准",
    group: "project",
    common: false,
    prompt: "列出对话中明确形成的可验证验收条件。",
  },
  {
    id: "external_confirmations",
    label: "需要向客户或其他人确认的问题",
    group: "project",
    common: false,
    prompt: "列出需要客户、同事或其他外部角色确认的问题。",
  },
  {
    id: "deliverables",
    label: "本轮产生的产出物",
    group: "project",
    common: false,
    prompt: "列出本轮已经产生或明确约定产生的文档、代码、设计或其他交付物。",
  },
  {
    id: "branch_contribution",
    label: "当前分支对主问题的贡献",
    group: "graph",
    common: false,
    prompt: "说明当前分支为主问题新增、修正或排除了什么。",
  },
  {
    id: "suggested_new_branches",
    label: "哪些问题适合拆成新分支",
    group: "graph",
    common: false,
    prompt: "提出尚未解决且值得独立讨论的分支候选，并给出标题、理由和第一个问题；不得把已解决问题再次建议。",
  },
] as const satisfies readonly ReviewModuleDefinition[];

export const REVIEW_MODULE_ORDER: readonly ReviewModuleId[] = REVIEW_MODULES.map(
  ({ id }) => id,
);

function moduleIdsFor(group: ReviewModuleGroupId): readonly ReviewModuleId[] {
  return REVIEW_MODULES.filter((module) => module.group === group).map(({ id }) => id);
}

export const REVIEW_MODULE_GROUPS = [
  { id: "common", label: "常用内容", moduleIds: moduleIdsFor("common") },
  { id: "decision", label: "决策复盘", moduleIds: moduleIdsFor("decision") },
  { id: "learning", label: "学习与理解", moduleIds: moduleIdsFor("learning") },
  { id: "project", label: "项目落地", moduleIds: moduleIdsFor("project") },
  { id: "graph", label: "对话建图", moduleIds: moduleIdsFor("graph") },
] as const satisfies readonly ReviewModuleGroupDefinition[];

export const REVIEW_PRESETS = [
  {
    id: "general",
    label: "通用复盘",
    moduleIds: [
      "discussion_overview",
      "user_goal",
      "key_takeaways",
      "consensus",
      "user_decisions",
      "unresolved_questions",
      "next_steps",
    ],
  },
  {
    id: "technical_project",
    label: "技术项目",
    moduleIds: [
      "product_problem",
      "confirmed_scope",
      "solution_architecture",
      "technology_stack",
      "business_technical_flow",
      "data_interfaces_tools_skills",
      "risks_dependencies",
      "progress_release_plan",
      "acceptance_criteria",
      "next_steps",
    ],
  },
  {
    id: "learning",
    label: "学习答疑",
    moduleIds: [
      "key_takeaways",
      "user_confusions",
      "clarified_technical_details",
      "understanding_changes",
      "important_terms",
      "prerequisite_gaps",
    ],
  },
  {
    id: "decision",
    label: "决策复盘",
    moduleIds: [
      "considered_options",
      "disagreements",
      "tradeoffs",
      "user_decisions",
      "rejected_or_deferred_options",
      "assumptions_constraints",
      "facts_to_verify",
    ],
  },
  {
    id: "continue_conversation",
    label: "继续对话",
    moduleIds: [
      "user_goal",
      "user_decisions",
      "assumptions_constraints",
      "unresolved_questions",
      "missed_branches",
      "next_steps",
      "continuation_context",
    ],
  },
] as const satisfies readonly ReviewPresetDefinition[];

const moduleById = new Map<ReviewModuleId, ReviewModuleDefinition>(
  REVIEW_MODULES.map((module) => [module.id, module]),
);
const presetById = new Map<BuiltInReviewPresetId, ReviewPresetDefinition>(
  REVIEW_PRESETS.map((preset) => [preset.id, preset]),
);
const moduleIds = new Set<string>(REVIEW_MODULE_ORDER);
const presetIds = new Set<string>([
  ...REVIEW_PRESETS.map(({ id }) => id),
  "custom",
]);

export function isReviewModuleId(value: unknown): value is ReviewModuleId {
  return typeof value === "string" && moduleIds.has(value);
}

export function isReviewPresetId(value: unknown): value is ReviewPresetId {
  return typeof value === "string" && presetIds.has(value);
}

export function getReviewModule(
  id: ReviewModuleId,
): ReviewModuleDefinition {
  // The map is constructed from the exhaustive ReviewModuleId catalog.
  return moduleById.get(id) as ReviewModuleDefinition;
}

export function getReviewPreset(
  id: ReviewPresetId,
): ReviewPresetDefinition | undefined {
  return id === "custom" ? undefined : presetById.get(id);
}

export function modulesForReviewPreset(id: ReviewPresetId): readonly ReviewModuleId[] {
  return getReviewPreset(id)?.moduleIds ?? [];
}

export function identifyReviewPreset(
  selectedModuleIds: readonly ReviewModuleId[],
): ReviewPresetId {
  const selected = new Set(selectedModuleIds);
  const preset = REVIEW_PRESETS.find(({ moduleIds: expected }) =>
    expected.length === selected.size && expected.every((id) => selected.has(id))
  );
  return preset?.id ?? "custom";
}

export function orderReviewModuleIds(
  moduleIdsToOrder: readonly ReviewModuleId[],
): ReviewModuleId[] {
  const selected = new Set(moduleIdsToOrder);
  return REVIEW_MODULE_ORDER.filter((id) => selected.has(id));
}
