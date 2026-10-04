import type {
  ConversationReviewMessage,
  ReviewBranchCandidate,
  ReviewClaimStatus,
  ReviewEvidence,
  ReviewItem,
  ReviewModuleId,
  ReviewModuleResult,
  ReviewModuleSnapshot,
  ReviewScope,
} from "../types/domain";
import {
  getReviewModule,
  isReviewModuleId,
  orderReviewModuleIds,
} from "./catalog";
import { estimateTextTokens } from "./processing";
import type { ReviewAncestorContext } from "./scope";

const EMPTY_MODULE_OVERVIEW = "本轮未发现相关内容";
const MAX_OVERVIEW_LENGTH = 4_000;
const MAX_ITEM_LENGTH = 8_000;
const MAX_BRANCH_FIELD_LENGTH = 2_000;
export const REVIEW_EVIDENCE_EXCERPT_LIMIT = 240;
export const REVIEW_ANCESTOR_CONTEXT_TOKEN_LIMIT = 3_500;
export const REVIEW_FACT_CONTEXT_TOKEN_LIMIT = 14_000;

export const REVIEW_CLAIM_STATUSES: readonly ReviewClaimStatus[] = [
  "confirmed",
  "user_decision",
  "consensus",
  "assistant_suggestion",
  "tentative",
  "unresolved",
  "deferred",
  "rejected",
];

export type ReviewPromptFact = {
  text: string;
  status?: ReviewClaimStatus;
  sourceIds: string[];
  branchPath?: string[];
  isInference?: boolean;
};

export type BuildReviewPromptInput = {
  selectedModuleIds: readonly ReviewModuleId[];
  messages?: readonly ConversationReviewMessage[];
  facts?: readonly ReviewPromptFact[];
  scope?: Pick<ReviewScope, "type" | "chatId" | "completeness" | "missingSourceIds">;
  ancestorContext?: readonly ReviewAncestorContext[];
};

export type ReviewPrompt = {
  systemPrompt: string;
  userPrompt: string;
};

export type ReviewParseIssueCode =
  | "INVALID_JSON"
  | "INVALID_ROOT"
  | "UNKNOWN_MODULE"
  | "UNSELECTED_MODULE"
  | "DUPLICATE_MODULE"
  | "MISSING_MODULE"
  | "INVALID_MODULE"
  | "UNKNOWN_EVIDENCE"
  | "UNKNOWN_NODE_REFERENCE"
  | "UNSUPPORTED_STATUS_EVIDENCE";

export type ReviewParseIssue = {
  code: ReviewParseIssueCode;
  message: string;
  moduleId?: ReviewModuleId;
  sourceId?: string;
  nodeId?: string;
};

export type ParsedReviewResponse = {
  modules: ReviewModuleResult[];
  evidences: ReviewEvidence[];
  failedModuleIds: ReviewModuleId[];
  issues: ReviewParseIssue[];
};

export type ParsedReviewFacts = {
  facts: ReviewPromptFact[];
  issues: ReviewParseIssue[];
};

export function buildReviewPrompt(input: BuildReviewPromptInput): ReviewPrompt {
  const selectedModuleIds = normalizeSelectedModules(input.selectedModuleIds);
  return {
    systemPrompt: buildReviewSystemPrompt(selectedModuleIds),
    userPrompt: buildReviewUserPrompt({ ...input, selectedModuleIds }),
  };
}

export function buildReviewSystemPrompt(
  selectedModuleIds: readonly ReviewModuleId[],
): string {
  const modules = normalizeSelectedModules(selectedModuleIds).map((id) => {
    const definition = getReviewModule(id);
    return `- ${definition.id}（${definition.label}）：${definition.prompt}`;
  }).join("\n");
  return `你是 Chat Graph 的 Conversation Review 结构化整理器。

必须遵守：
1. 只输出一个 JSON 对象，不要输出 Markdown、代码围栏或解释。
2. 只生成下方列出的模块，moduleId 必须逐字匹配；没有相关内容时 overview 为空字符串且 items 为空数组，禁止编造。
3. 采用对话中时间更晚的有效结论，但多分支冲突必须分别保留并说明分支，不能强行合并。
4. 助手建议不能标为 user_decision 或 consensus，除非用户消息中有明确接受依据。
5. status 只能是 confirmed、user_decision、consensus、assistant_suggestion、tentative、unresolved、deferred、rejected 之一或省略。
6. 每个条目必须给出 evidenceSourceIds。只能引用输入中真实存在的 sourceId；没有直接依据时使用空数组并将 isInference 设为 true。
7. isInference 与 status 相互独立。不要输出完整聊天原文。
8. 只有 suggested_new_branches 模块可返回 branchCandidates；候选必须尚未解决，且不得自动创建节点。

需要生成的模块：
${modules || "（无；返回 modules 空数组）"}

JSON 结构：
{"modules":[{"moduleId":"discussion_overview","overview":"一句概览","items":[{"id":"可选稳定标识","text":"条目","status":"confirmed","isInference":false,"evidenceSourceIds":["真实 sourceId"]}],"branchCandidates":[{"id":"可选稳定标识","title":"分支标题","rationale":"拆分理由","firstQuestion":"第一个问题","sourceNodeId":"可选来源节点"}]}]}`;
}

export function buildReviewUserPrompt(input: BuildReviewPromptInput): string {
  const selectedModuleIds = normalizeSelectedModules(input.selectedModuleIds);
  const payload: Record<string, unknown> = {
    selectedModuleIds,
  };
  if (input.scope) {
    payload.scope = {
      type: input.scope.type,
      chatId: input.scope.chatId,
      completeness: input.scope.completeness,
      missingSourceIds: input.scope.missingSourceIds,
    };
  }
  if (input.ancestorContext?.length) {
    payload.ancestorContext = limitReviewAncestorContext(input.ancestorContext).map((node) => ({
      nodeId: node.id,
      parentId: node.parentId,
      question: node.question,
      summary: node.summary,
      depthFromTarget: node.depthFromTarget,
    }));
  }
  if (input.facts) {
    payload.facts = limitReviewPromptFacts(input.facts);
  } else {
    payload.messages = (input.messages ?? []).map(toPromptMessage);
  }
  return JSON.stringify(payload);
}

export function limitReviewAncestorContext(
  context: readonly ReviewAncestorContext[],
): ReviewAncestorContext[] {
  const candidates = [...context]
    .sort((left, right) => left.depthFromTarget - right.depthFromTarget)
    .map((node) => ({
      ...node,
      question: truncateToTokenBudget(node.question, 600),
      summary: truncateToTokenBudget(node.summary, 300),
    }));
  const result: ReviewAncestorContext[] = [];
  let tokens = 0;
  for (const candidate of candidates) {
    const candidateTokens = estimateTextTokens(JSON.stringify(candidate));
    if (tokens + candidateTokens > REVIEW_ANCESTOR_CONTEXT_TOKEN_LIMIT) continue;
    result.push(candidate);
    tokens += candidateTokens;
  }
  return result;
}

export function estimateReviewAncestorContextTokens(
  context: readonly ReviewAncestorContext[],
): number {
  return estimateTextTokens(JSON.stringify(limitReviewAncestorContext(context)));
}

export function limitReviewPromptFacts(
  facts: readonly ReviewPromptFact[],
): ReviewPromptFact[] {
  const bounded = facts.map((fact, index) => ({
    index,
    fact: {
      ...fact,
      text: truncateToTokenBudget(fact.text, 240),
      sourceIds: [...new Set(fact.sourceIds)].slice(0, 50),
      ...(fact.branchPath
        ? { branchPath: fact.branchPath.slice(0, 30).map((item) => truncateToTokenBudget(item, 40)) }
        : {}),
    },
  }));
  const selected = new Map<number, ReviewPromptFact>();
  let tokens = 0;
  let left = 0;
  let right = bounded.length - 1;
  let takeLatest = true;
  while (left <= right) {
    const candidate = takeLatest ? bounded[right--] : bounded[left++];
    takeLatest = !takeLatest;
    if (!candidate) break;
    const candidateTokens = estimateTextTokens(JSON.stringify(candidate.fact));
    if (tokens + candidateTokens > REVIEW_FACT_CONTEXT_TOKEN_LIMIT) continue;
    selected.set(candidate.index, candidate.fact);
    tokens += candidateTokens;
  }
  return [...selected.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, fact]) => fact);
}

function truncateToTokenBudget(value: string, maxTokens: number): string {
  if (estimateTextTokens(value) <= maxTokens) return value;
  const characters = [...value];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTextTokens(characters.slice(0, middle).join("")) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join("").trimEnd();
}

export function buildReviewFactExtractionPrompt(
  messages: readonly ConversationReviewMessage[],
  segmentIndex: number,
  segmentCount: number,
): ReviewPrompt {
  return {
    systemPrompt: `你是对话事实整理器。只输出 JSON 对象，不要输出 Markdown。
按消息顺序提取后续结构化总结所需的事实、目标、决定、建议、共识、分歧、约束、状态变化、问题和行动。
只能引用输入中真实存在的 sourceId；不要复述完整消息。
status 只能是 confirmed、user_decision、consensus、assistant_suggestion、tentative、unresolved、deferred、rejected 之一或省略。
输出结构：{"facts":[{"text":"精炼事实","status":"confirmed","sourceIds":["sourceId"],"branchPath":["可选节点 id"]}]}`,
    userPrompt: JSON.stringify({
      segmentIndex,
      segmentCount,
      messages: messages.map(toPromptMessage),
    }),
  };
}

export function parseReviewResponse(
  response: string | unknown,
  selectedModuleIds: readonly ReviewModuleId[],
  sourceMessages: readonly ConversationReviewMessage[],
): ParsedReviewResponse {
  const selected = normalizeSelectedModules(selectedModuleIds);
  const selectedSet = new Set<ReviewModuleId>(selected);
  const issues: ReviewParseIssue[] = [];
  const root = parseRoot(response, issues);
  const rawModules = root && Array.isArray(root.modules) ? root.modules : [];
  if (root && !Array.isArray(root.modules)) {
    issues.push({ code: "INVALID_ROOT", message: "响应缺少 modules 数组。" });
  }

  const sourceById = new Map<string, ConversationReviewMessage>();
  for (const message of sourceMessages) {
    if (!sourceById.has(message.sourceId)) sourceById.set(message.sourceId, message);
  }
  const evidencesById = new Map<string, ReviewEvidence>();
  const parsedByModule = new Map<ReviewModuleId, ReviewModuleResult>();
  const allowedNodeIds = new Set<string>();
  for (const message of sourceMessages) {
    if (message.nodeId) allowedNodeIds.add(message.nodeId);
    message.branchPath?.forEach((nodeId) => allowedNodeIds.add(nodeId));
  }

  for (const rawModule of rawModules) {
    if (!isRecord(rawModule)) {
      issues.push({ code: "INVALID_MODULE", message: "忽略了非对象模块。" });
      continue;
    }
    const rawModuleId = rawModule.moduleId;
    if (!isReviewModuleId(rawModuleId)) {
      issues.push({
        code: "UNKNOWN_MODULE",
        message: `忽略未知模块：${String(rawModuleId)}`,
      });
      continue;
    }
    if (!selectedSet.has(rawModuleId)) {
      issues.push({
        code: "UNSELECTED_MODULE",
        message: `忽略未选择模块：${rawModuleId}`,
        moduleId: rawModuleId,
      });
      continue;
    }
    if (parsedByModule.has(rawModuleId)) {
      issues.push({
        code: "DUPLICATE_MODULE",
        message: `忽略重复模块：${rawModuleId}`,
        moduleId: rawModuleId,
      });
      continue;
    }
    const error = cleanString(rawModule.error, MAX_ITEM_LENGTH);
    if (error) {
      parsedByModule.set(rawModuleId, failedModule(rawModuleId, error));
      continue;
    }
    const snapshot = parseModuleSnapshot(
      rawModuleId,
      rawModule,
      sourceById,
      evidencesById,
      allowedNodeIds,
      issues,
    );
    const hasContent = snapshot.items.length > 0
      || Boolean(snapshot.overview && snapshot.overview !== EMPTY_MODULE_OVERVIEW);
    parsedByModule.set(rawModuleId, {
      moduleId: rawModuleId,
      state: hasContent ? "completed" : "empty",
      generated: cloneSnapshot(snapshot),
      current: cloneSnapshot(snapshot),
      editHistory: [],
    });
  }

  const modules = selected.map((moduleId) => {
    const parsed = parsedByModule.get(moduleId);
    if (parsed) return parsed;
    issues.push({
      code: "MISSING_MODULE",
      message: `响应缺少已选择模块：${moduleId}`,
      moduleId,
    });
    return failedModule(moduleId, "模型响应缺少此模块。")
  });
  const failedModuleIds = modules
    .filter(({ state }) => state === "failed")
    .map(({ moduleId }) => moduleId);

  return {
    modules,
    evidences: [...evidencesById.values()].sort(
      (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
    ),
    failedModuleIds,
    issues,
  };
}

export function parseReviewFactsResponse(
  response: string | unknown,
  sourceMessages: readonly ConversationReviewMessage[],
): ParsedReviewFacts {
  const issues: ReviewParseIssue[] = [];
  const root = parseRoot(response, issues);
  if (!root) return { facts: [], issues };
  if (!Array.isArray(root.facts)) {
    issues.push({ code: "INVALID_ROOT", message: "响应缺少 facts 数组。" });
    return { facts: [], issues };
  }
  const sourceIds = new Set(sourceMessages.map(({ sourceId }) => sourceId));
  const facts: ReviewPromptFact[] = [];
  for (const rawFact of root.facts) {
    if (!isRecord(rawFact)) continue;
    const text = cleanString(rawFact.text, MAX_ITEM_LENGTH);
    if (!text) continue;
    const validSourceIds: string[] = [];
    let rejectedEvidence = false;
    const rawSourceIds = Array.isArray(rawFact.sourceIds) ? rawFact.sourceIds : [];
    for (const sourceId of rawSourceIds) {
      if (typeof sourceId !== "string" || !sourceIds.has(sourceId)) {
        rejectedEvidence = true;
        if (typeof sourceId === "string") {
          issues.push({
            code: "UNKNOWN_EVIDENCE",
            message: "事实提取结果引用了不存在的来源。",
            sourceId,
          });
        }
        continue;
      }
      if (!validSourceIds.includes(sourceId)) validSourceIds.push(sourceId);
    }
    const status = parseClaimStatus(rawFact.status);
    const branchPath = Array.isArray(rawFact.branchPath)
      ? rawFact.branchPath.filter((value): value is string =>
        typeof value === "string" && Boolean(value.trim())
      ).map((value) => cleanString(value, 200))
      : [];
    facts.push({
      text,
      ...(status ? { status } : {}),
      sourceIds: validSourceIds,
      ...(branchPath.length ? { branchPath } : {}),
      isInference: rawFact.isInference === true || rejectedEvidence || validSourceIds.length === 0,
    });
  }
  return { facts, issues };
}

function parseModuleSnapshot(
  moduleId: ReviewModuleId,
  rawModule: Record<string, unknown>,
  sourceById: ReadonlyMap<string, ConversationReviewMessage>,
  evidencesById: Map<string, ReviewEvidence>,
  allowedNodeIds: ReadonlySet<string>,
  issues: ReviewParseIssue[],
): ReviewModuleSnapshot {
  const items: ReviewItem[] = [];
  const rawItems = Array.isArray(rawModule.items) ? rawModule.items : [];
  rawItems.forEach((rawItem, itemIndex) => {
    if (!isRecord(rawItem)) return;
    const text = cleanString(rawItem.text, MAX_ITEM_LENGTH);
    if (!text) return;
    const rawSourceIds = Array.isArray(rawItem.evidenceSourceIds)
      ? rawItem.evidenceSourceIds
      : [];
    const evidenceIds: string[] = [];
    let hasUserEvidence = false;
    let hasAssistantEvidence = false;
    let rejectedEvidence = false;
    for (const rawSourceId of rawSourceIds) {
      if (typeof rawSourceId !== "string" || !rawSourceId) {
        rejectedEvidence = true;
        continue;
      }
      const source = sourceById.get(rawSourceId);
      if (!source) {
        rejectedEvidence = true;
        issues.push({
          code: "UNKNOWN_EVIDENCE",
          message: `模块 ${moduleId} 引用了不存在的来源。`,
          moduleId,
          sourceId: rawSourceId,
        });
        continue;
      }
      const evidence = evidenceForMessage(source);
      if (source.role === "user") hasUserEvidence = true;
      else hasAssistantEvidence = true;
      evidencesById.set(evidence.id, evidence);
      if (!evidenceIds.includes(evidence.id)) evidenceIds.push(evidence.id);
    }
    const parsedStatus = parseClaimStatus(rawItem.status);
    const unsupportedDecisionStatus = (
      parsedStatus === "user_decision" || parsedStatus === "consensus"
    ) && !hasUserEvidence;
    const status = unsupportedDecisionStatus
      ? hasAssistantEvidence ? "assistant_suggestion" as const : "tentative" as const
      : parsedStatus;
    if (unsupportedDecisionStatus) {
      issues.push({
        code: "UNSUPPORTED_STATUS_EVIDENCE",
        message: `模块 ${moduleId} 的决定或共识缺少用户依据，已降低状态。`,
        moduleId,
      });
    }
    items.push({
      id: cleanString(rawItem.id, 200) || `${moduleId}-item-${itemIndex + 1}`,
      text,
      ...(status ? { status } : {}),
      isInference: rawItem.isInference === true
        || rejectedEvidence
        || evidenceIds.length === 0
        || unsupportedDecisionStatus,
      evidenceIds,
    });
  });

  const overview = cleanString(rawModule.overview, MAX_OVERVIEW_LENGTH);
  const snapshot: ReviewModuleSnapshot = {
    overview: overview || (items.length ? "" : EMPTY_MODULE_OVERVIEW),
    items,
  };
  if (moduleId === "suggested_new_branches") {
    const branchCandidates = parseBranchCandidates(
      rawModule.branchCandidates,
      allowedNodeIds,
      issues,
    );
    if (branchCandidates.length) snapshot.branchCandidates = branchCandidates;
  }
  return snapshot;
}

function parseBranchCandidates(
  value: unknown,
  allowedNodeIds: ReadonlySet<string>,
  issues: ReviewParseIssue[],
): ReviewBranchCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: ReviewBranchCandidate[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const title = cleanString(entry.title, MAX_BRANCH_FIELD_LENGTH);
    const rationale = cleanString(entry.rationale, MAX_BRANCH_FIELD_LENGTH);
    const firstQuestion = cleanString(entry.firstQuestion, MAX_BRANCH_FIELD_LENGTH);
    if (!title || !rationale || !firstQuestion) return;
    const requestedSourceNodeId = cleanString(entry.sourceNodeId, 200);
    const sourceNodeId = requestedSourceNodeId && allowedNodeIds.has(requestedSourceNodeId)
      ? requestedSourceNodeId
      : "";
    if (requestedSourceNodeId && !sourceNodeId) {
      issues.push({
        code: "UNKNOWN_NODE_REFERENCE",
        message: "新分支候选引用了当前范围之外的节点，已移除该引用。",
        moduleId: "suggested_new_branches",
        nodeId: requestedSourceNodeId,
      });
    }
    candidates.push({
      id: cleanString(entry.id, 200) || `branch-candidate-${index + 1}`,
      title,
      rationale,
      firstQuestion,
      ...(sourceNodeId ? { sourceNodeId } : {}),
    });
  });
  return candidates;
}

function evidenceForMessage(message: ConversationReviewMessage): ReviewEvidence {
  return {
    id: `review-evidence-${hashId(message.sourceId)}`,
    sourceId: message.sourceId,
    chatId: message.chatId,
    role: message.role,
    excerpt: truncateEvidenceExcerpt(message.content),
    ordinal: message.ordinal,
    locator: { ...message.locator },
    ...(message.nodeId ? { nodeId: message.nodeId } : {}),
    ...(message.branchPath ? { branchPath: [...message.branchPath] } : {}),
  };
}

export function truncateEvidenceExcerpt(
  content: string,
  limit = REVIEW_EVIDENCE_EXCERPT_LIMIT,
): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const characters = [...normalized];
  if (characters.length <= limit) return normalized;
  if (limit <= 1) return characters.slice(0, Math.max(0, limit)).join("");
  return `${characters.slice(0, limit - 1).join("")}…`;
}

function failedModule(moduleId: ReviewModuleId, error: string): ReviewModuleResult {
  const snapshot: ReviewModuleSnapshot = { overview: "", items: [] };
  return {
    moduleId,
    state: "failed",
    generated: cloneSnapshot(snapshot),
    current: cloneSnapshot(snapshot),
    editHistory: [],
    error,
  };
}

function cloneSnapshot(snapshot: ReviewModuleSnapshot): ReviewModuleSnapshot {
  return {
    overview: snapshot.overview,
    items: snapshot.items.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds] })),
    ...(snapshot.branchCandidates
      ? { branchCandidates: snapshot.branchCandidates.map((candidate) => ({ ...candidate })) }
      : {}),
  };
}

function parseRoot(
  response: string | unknown,
  issues: ReviewParseIssue[],
): Record<string, unknown> | undefined {
  let value = response;
  if (typeof response === "string") {
    const text = stripJsonFence(response);
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      issues.push({ code: "INVALID_JSON", message: "模型响应不是有效 JSON。" });
      return undefined;
    }
  }
  if (!isRecord(value)) {
    issues.push({ code: "INVALID_ROOT", message: "模型响应根节点必须是对象。" });
    return undefined;
  }
  return value;
}

function stripJsonFence(value: string): string {
  const trimmed = value.replace(/^\uFEFF/, "").trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function parseClaimStatus(value: unknown): ReviewClaimStatus | undefined {
  if (typeof value !== "string") return undefined;
  const aliases: Record<string, ReviewClaimStatus> = {
    confirmed: "confirmed",
    user_decision: "user_decision",
    consensus: "consensus",
    assistant_suggestion: "assistant_suggestion",
    tentative: "tentative",
    unresolved: "unresolved",
    deferred: "deferred",
    rejected: "rejected",
    "已确认": "confirmed",
    "用户决定": "user_decision",
    "双方共识": "consensus",
    "助手建议": "assistant_suggestion",
    "暂定": "tentative",
    "未解决": "unresolved",
    "已延后": "deferred",
    "已否决": "rejected",
  };
  return aliases[value];
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return [...value.trim()].slice(0, maxLength).join("");
}

function normalizeSelectedModules(
  moduleIds: readonly ReviewModuleId[],
): ReviewModuleId[] {
  const safeIds = moduleIds.filter(isReviewModuleId);
  return orderReviewModuleIds([...new Set(safeIds)]);
}

function toPromptMessage(message: ConversationReviewMessage): Record<string, unknown> {
  return {
    sourceId: message.sourceId,
    role: message.role,
    ordinal: message.ordinal,
    ...(message.nodeId ? { nodeId: message.nodeId } : {}),
    ...(message.branchPath?.length ? { branchPath: message.branchPath } : {}),
    content: message.content,
  };
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
