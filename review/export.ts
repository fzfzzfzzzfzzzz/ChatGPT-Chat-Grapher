import type {
  ReviewClaimStatus,
  ReviewEvidence,
  ReviewModuleId,
  ReviewModuleResult,
  ReviewScopeType,
  ReviewVersion,
} from "../types/domain";
import { getReviewModule, orderReviewModuleIds } from "./catalog";

export const REVIEW_SCOPE_LABELS: Readonly<Record<ReviewScopeType, string>> = {
  current_branch: "当前分支",
  conversation: "整个当前对话",
  node_context: "当前节点及其上下文",
};

export const REVIEW_CLAIM_STATUS_LABELS: Readonly<Record<ReviewClaimStatus, string>> = {
  confirmed: "已确认",
  user_decision: "用户决定",
  consensus: "双方共识",
  assistant_suggestion: "助手建议",
  tentative: "暂定",
  unresolved: "未解决",
  deferred: "已延后",
  rejected: "已否决",
};

export type ReviewMarkdownOptions = {
  includeEvidence?: boolean;
  locale?: string;
};

export type ReviewMarkdownExport = {
  filename: string;
  content: string;
  mimeType: "text/markdown;charset=utf-8";
};

export function buildReviewMarkdown(
  version: Pick<
    ReviewVersion,
    | "title"
    | "scope"
    | "moduleOrder"
    | "modules"
    | "evidences"
    | "segmented"
    | "segmentCount"
    | "missingRanges"
    | "generatedAt"
  >,
  options: ReviewMarkdownOptions = {},
): string {
  const locale = options.locale ?? "zh-CN";
  const completeness = version.scope.completeness === "complete" ? "完整" : "部分完整";
  const lines = [
    `# ${sanitizeHeading(version.title) || "对话总结"}`,
    "",
    `- 总结范围：${REVIEW_SCOPE_LABELS[version.scope.type]}`,
    `- 生成时间：${formatReviewDate(version.generatedAt, locale)}`,
    `- 完整性：${completeness}`,
  ];
  if (version.segmented) {
    lines.push(`- 处理方式：分段整理（${version.segmentCount} 段）`);
  }
  if (version.scope.missingSourceIds.length || version.missingRanges.length) {
    const parts = [
      ...(version.scope.missingSourceIds.length
        ? [`${version.scope.missingSourceIds.length} 项来源`]
        : []),
      ...(version.missingRanges.length ? [`${version.missingRanges.length} 个处理分段`] : []),
    ];
    lines.push(`- 缺失内容：${parts.join("、")}（结果可能不完整）`);
  }
  lines.push("");

  const moduleById = new Map(version.modules.map((module) => [module.moduleId, module]));
  const evidenceById = new Map(version.evidences.map((evidence) => [evidence.id, evidence]));
  for (const moduleId of orderedVersionModuleIds(version.moduleOrder, version.modules)) {
    const module = moduleById.get(moduleId);
    if (!module) continue;
    lines.push(...formatReviewModuleMarkdown(module, evidenceById, options.includeEvidence === true));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildReviewCopyText(
  version: Parameters<typeof buildReviewMarkdown>[0],
  options: ReviewMarkdownOptions = {},
): string {
  return buildReviewMarkdown(version, options);
}

export function buildReviewModuleCopyText(
  module: ReviewModuleResult,
  evidences: readonly ReviewEvidence[] = [],
  options: Pick<ReviewMarkdownOptions, "includeEvidence"> = {},
): string {
  const evidenceById = new Map(evidences.map((evidence) => [evidence.id, evidence]));
  return `${formatReviewModuleMarkdown(
    module,
    evidenceById,
    options.includeEvidence === true,
  ).join("\n").trimEnd()}\n`;
}

export function buildContinuationContextText(
  modules: readonly ReviewModuleResult[],
): string {
  const moduleById = new Map(modules.map((module) => [module.moduleId, module]));
  const explicit = moduleById.get("continuation_context");
  if (explicit && hasModuleContent(explicit)) {
    return plainModuleContent(explicit);
  }

  const fallbackIds: readonly ReviewModuleId[] = [
    "user_goal",
    "user_decisions",
    "assumptions_constraints",
    "solution_architecture",
    "technology_stack",
    "unresolved_questions",
    "next_steps",
  ];
  const sections: string[] = [];
  for (const moduleId of fallbackIds) {
    const module = moduleById.get(moduleId);
    if (!module || !hasModuleContent(module)) continue;
    sections.push(`${getReviewModule(moduleId).label}：\n${plainModuleContent(module)}`);
  }
  return sections.length
    ? `请基于以下已知上下文继续讨论，不要重复询问已经明确的信息：\n\n${sections.join("\n\n")}`
    : "本轮没有可用于继续对话的上下文。";
}

export function createReviewMarkdownExport(
  version: Parameters<typeof buildReviewMarkdown>[0],
  options: ReviewMarkdownOptions = {},
): ReviewMarkdownExport {
  return {
    filename: buildReviewMarkdownFilename(version.title, version.generatedAt),
    content: buildReviewMarkdown(version, options),
    mimeType: "text/markdown;charset=utf-8",
  };
}

export function buildReviewMarkdownFilename(title: string, generatedAt: number): string {
  const date = new Date(generatedAt);
  const datePart = Number.isNaN(date.getTime())
    ? "unknown-date"
    : [
      String(date.getFullYear()).padStart(4, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  let base = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/[. ]+$/g, "");
  base = [...base].slice(0, 80).join("").replace(/[. ]+$/g, "");
  if (!base) base = "conversation-review";
  const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (reservedName.test(base)) {
    base = base.includes(".") ? `review-${base}` : `${base}-review`;
  }
  return `${base}-${datePart}.md`;
}

function formatReviewModuleMarkdown(
  module: ReviewModuleResult,
  evidenceById: ReadonlyMap<string, ReviewEvidence>,
  includeEvidence: boolean,
): string[] {
  const lines = [`## ${getReviewModule(module.moduleId).label}`, ""];
  if (module.state === "failed" && !hasModuleContent(module)) {
    lines.push("> 本模块未能生成。", "");
    return lines;
  }
  const snapshot = module.current;
  if (snapshot.overview) lines.push(snapshot.overview, "");
  if (!snapshot.items.length && !snapshot.overview) {
    lines.push("本轮未发现相关内容", "");
  }
  for (const item of snapshot.items) {
    const labels = [
      ...(item.status ? [REVIEW_CLAIM_STATUS_LABELS[item.status]] : []),
      ...(item.isInference ? ["系统推断"] : []),
    ];
    lines.push(`- ${labels.length ? `[${labels.join(" · ")}] ` : ""}${indentMultiline(item.text, "  ")}`);
    if (includeEvidence) {
      for (const evidenceId of item.evidenceIds) {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence) {
          lines.push("  - 依据：来源不可用");
          continue;
        }
        const role = evidence.role === "user" ? "用户" : "助手";
        lines.push(`  - 依据（${role}，消息 ${evidence.ordinal + 1}）：${evidence.excerpt}`);
      }
    }
  }
  if (snapshot.items.length) lines.push("");

  if (snapshot.branchCandidates?.length) {
    lines.push("### 建议的新分支", "");
    for (const candidate of snapshot.branchCandidates) {
      lines.push(
        `- **${candidate.title}**：${candidate.rationale}`,
        `  - 第一个问题：${candidate.firstQuestion}`,
      );
    }
    lines.push("");
  }
  return lines;
}

function plainModuleContent(module: ReviewModuleResult): string {
  const lines: string[] = [];
  const overview = module.current.overview.trim();
  if (overview && overview !== "本轮未发现相关内容") lines.push(overview);
  for (const item of module.current.items) {
    const status = item.status ? `【${REVIEW_CLAIM_STATUS_LABELS[item.status]}】` : "";
    const inference = item.isInference ? "【系统推断】" : "";
    lines.push(`- ${status}${inference}${item.text}`);
  }
  return lines.join("\n");
}

function hasModuleContent(module: ReviewModuleResult): boolean {
  return module.current.items.length > 0
    || Boolean(
      module.current.overview.trim()
      && module.current.overview.trim() !== "本轮未发现相关内容",
    );
}

function orderedVersionModuleIds(
  moduleOrder: readonly ReviewModuleId[],
  modules: readonly ReviewModuleResult[],
): ReviewModuleId[] {
  const available = new Set(modules.map(({ moduleId }) => moduleId));
  const requested = new Set(moduleOrder.filter((id) => available.has(id)));
  for (const module of modules) requested.add(module.moduleId);
  return orderReviewModuleIds([...requested]);
}

function sanitizeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function indentMultiline(value: string, indent: string): string {
  return value.replace(/\r?\n/g, `\n${indent}`);
}

function formatReviewDate(timestamp: number, locale: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
