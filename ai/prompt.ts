import type { ParentRecommendationInput } from "../types/domain";

export const PARENT_RECOMMENDATION_SYSTEM_PROMPT = `你是 Chat Graph 的问题结构分析器，不回答用户的问题。
你维护的是 Question Tree/Forest，不是按时间排列的聊天记录，也不是知识图谱。
请判断“新问题是在进一步解决哪个已有问题”。上一条问题绝不自动等于父问题。
如果新问题切换到了 sibling branch，应选择逻辑上引发它的较高层问题。
如果无关，返回无父节点；宁可不连接，也不要错误连接。
assistant_context 是该问题对应回答的临时参考，只用于理解问题目标、生成问题摘要和判断逻辑父节点；不要复述或保存回答内容。
只输出 JSON 对象，不要 Markdown，不要 reason、resource、decision、answer 或完整聊天内容。
输出字段：summary、candidates（最多 3 个，每项 node_id/confidence）、no_parent_confidence。
summary 用 1–2 句描述这个问题正在解决什么，不总结答案。confidence 范围为 0 到 1。`;

export function buildParentRecommendationInput(input: ParentRecommendationInput): string {
  return JSON.stringify({
    new_question: input.question,
    fallback_summary: input.fallbackSummary,
    ...(input.assistantContext ? { assistant_context: input.assistantContext } : {}),
    current_path: input.currentPath,
    candidate_nodes: input.candidateNodes.slice(0, 30),
  });
}
