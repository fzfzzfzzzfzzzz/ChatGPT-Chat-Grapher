import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FilePlus2,
  GitBranchPlus,
  LoaderCircle,
  RotateCcw,
  Save,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  REVIEW_MODULE_GROUPS,
  REVIEW_MODULES,
  REVIEW_PRESETS,
} from "../review/catalog";
import type {
  ReviewBranchCandidate,
  ReviewEvidence,
  ReviewJob,
  ReviewJobStatus,
  ReviewModuleId,
  ReviewModuleResult,
  ReviewModuleSnapshot,
  ReviewPresetId,
  ReviewScope,
  ReviewScopeType,
  ReviewVersion,
} from "../types/domain";
import { Modal } from "./Modal";

export type ConversationReviewView = "config" | "result";
export type ReviewGraphSaveStrategy = "update" | "new";

export type ReviewGenerateRequest = {
  scopeType: ReviewScopeType;
  presetId: ReviewPresetId;
  moduleIds: ReviewModuleId[];
  allowPartial: boolean;
};

export type ConversationReviewDialogProps = {
  view: ConversationReviewView;
  scope: ReviewScope;
  selectedModuleIds: readonly ReviewModuleId[];
  presetId: ReviewPresetId;
  allowPartial: boolean;
  version?: ReviewVersion;
  job?: ReviewJob;
  dirty?: boolean;
  stale?: boolean;
  hasExistingGraphDocument?: boolean;
  disabledScopeTypes?: Partial<Record<ReviewScopeType, string>>;
  processingHint?: string;
  unavailableEvidenceIds?: readonly string[];
  onClose: () => void;
  onViewChange?: (view: ConversationReviewView) => void;
  onScopeChange: (scopeType: ReviewScopeType) => void;
  onModulesChange: (moduleIds: ReviewModuleId[], presetId: ReviewPresetId) => void;
  onAllowPartialChange: (allow: boolean) => void;
  onGenerate: (request: ReviewGenerateRequest) => void | Promise<void>;
  onOpenSource?: () => void | Promise<void>;
  onOpenSettings?: () => void;
  onCancelJob?: () => void | Promise<void>;
  onRetryAll?: () => void | Promise<void>;
  onRetryModule?: (moduleId: ReviewModuleId) => void | Promise<void>;
  onTitleChange?: (title: string) => void;
  onUpdateModule?: (moduleId: ReviewModuleId, value: ReviewModuleSnapshot) => void;
  onDeleteItem?: (moduleId: ReviewModuleId, itemId: string) => void;
  onUndoModuleEdit?: (moduleId: ReviewModuleId) => void;
  onRestoreModule?: (moduleId: ReviewModuleId) => void;
  onLocateEvidence?: (evidence: ReviewEvidence) => void | Promise<void>;
  onCopyAll?: () => void | Promise<void>;
  onCopyModule?: (moduleId: ReviewModuleId) => void | Promise<void>;
  onCopyContextPackage?: () => void | Promise<void>;
  onExportMarkdown?: (options: { includeEvidence: boolean }) => void | Promise<void>;
  onSaveToGraph?: (strategy: ReviewGraphSaveStrategy) => boolean | void | Promise<boolean | void>;
  graphAnchorNodeId?: string;
  graphAnchorNodeOptions?: readonly { id: string; label: string }[];
  onGraphAnchorChange?: (nodeId: string) => void;
  onFeedback?: (helpful: boolean) => void;
  onModuleFeedback?: (moduleId: ReviewModuleId, feedback: string) => void;
  onCreateBranch?: (candidate: ReviewBranchCandidate) => void | Promise<void>;
  onSaveDraft?: () => void | Promise<void>;
};

const SCOPE_COPY: Record<ReviewScopeType, { label: string; description: string }> = {
  current_branch: {
    label: "当前分支",
    description: "从当前节点沿父节点路径回到逻辑根节点。",
  },
  conversation: {
    label: "整个当前对话",
    description: "包含当前页面可采集的全部消息，并保留分支差异。",
  },
  node_context: {
    label: "当前节点及其上下文",
    description: "聚焦目标节点、直接父节点及必要祖先信息。",
  },
};

const JOB_STATUS_LABELS: Record<ReviewJobStatus, string> = {
  waiting: "等待生成",
  collecting: "正在采集对话",
  organizing: "正在整理对话",
  generating: "正在生成总结",
  completed: "已完成",
  partial: "部分完成",
  cancelled: "已取消",
  failed: "生成失败",
  interrupted: "已中断",
};

const CLAIM_STATUS_LABELS = {
  confirmed: "已确认",
  user_decision: "用户决定",
  consensus: "双方共识",
  assistant_suggestion: "助手建议",
  tentative: "暂定",
  unresolved: "未解决",
  deferred: "已延后",
  rejected: "已否决",
} as const;

const ACTIVE_JOB_STATUSES: readonly ReviewJobStatus[] = [
  "waiting",
  "collecting",
  "organizing",
  "generating",
];

const SCOPE_ORDER: readonly ReviewScopeType[] = [
  "current_branch",
  "conversation",
  "node_context",
];

function isActiveJob(job?: ReviewJob) {
  return job ? ACTIVE_JOB_STATUSES.includes(job.status) : false;
}

function moduleLabel(moduleId: ReviewModuleId) {
  return REVIEW_MODULES.find((item) => item.id === moduleId)?.label ?? moduleId;
}

function snapshotsEqual(left: ReviewModuleSnapshot, right: ReviewModuleSnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getProcessingHint(scope: ReviewScope, moduleCount: number) {
  if (scope.estimatedTokens <= 24_000 && moduleCount <= 10) return "预计单次生成。";
  return "内容较长，将先分段整理，再按模块生成；已完成的模块会提前显示。";
}

function formatGeneratedAt(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function JobProgress({
  job,
  onCancel,
  onRetry,
  onSettings,
  onAdjustScope,
}: {
  job: ReviewJob;
  onCancel?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onSettings?: () => void;
  onAdjustScope?: () => void;
}) {
  const active = isActiveJob(job);
  const maximum = Math.max(job.progress.total, 1);
  const current = Math.min(Math.max(job.progress.current, 0), maximum);

  return (
    <section className={`conversation-review__job conversation-review__job--${job.status}`} aria-live="polite">
      <div className="conversation-review__job-heading">
        <div>
          <strong>{JOB_STATUS_LABELS[job.status]}</strong>
          <p>{job.progress.message}</p>
        </div>
        {active ? <LoaderCircle className="is-spinning" size={18} aria-hidden="true" /> : null}
      </div>
      <progress value={current} max={maximum} aria-label="总结生成进度">
        {current} / {maximum}
      </progress>
      {job.error ? <p className="conversation-review__error" role="alert">{job.error}</p> : null}
      <div className="conversation-review__job-actions">
        {job.errorCode && ["NOT_CONFIGURED", "NOT_AUTHORIZED", "AUTH_FAILED"].includes(job.errorCode) && onSettings ? (
          <button className="button" type="button" onClick={onSettings}>检查 AI 设置</button>
        ) : null}
        {job.errorCode === "SOURCE_TOO_LARGE" && onAdjustScope ? (
          <button className="button" type="button" onClick={onAdjustScope}>缩小总结范围</button>
        ) : null}
        {active && onCancel ? (
          <button className="button" type="button" onClick={() => void onCancel()}>
            取消生成
          </button>
        ) : null}
        {!active && ["partial", "failed", "interrupted", "cancelled"].includes(job.status) && onRetry ? (
          <button className="button" type="button" onClick={() => void onRetry()}>
            <RotateCcw size={14} aria-hidden="true" /> 重试
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ScopePreview({ scope, processingHint }: { scope: ReviewScope; processingHint?: string }) {
  return (
    <section className="conversation-review__scope-preview" aria-label="总结范围预览">
      <dl>
        <div><dt>消息</dt><dd>{scope.messageCount} 条</dd></div>
        <div><dt>节点</dt><dd>{scope.nodeCount} 个</dd></div>
        <div><dt>其他分支</dt><dd>{scope.includesOtherBranches ? "包含" : "不包含"}</dd></div>
        <div><dt>估算长度</dt><dd>约 {scope.estimatedTokens.toLocaleString("zh-CN")} tokens</dd></div>
      </dl>
      <p>{processingHint ?? getProcessingHint(scope, 0)}</p>
      {scope.missingSourceIds.length ? (
        <details className="conversation-review__missing">
          <summary>有 {scope.missingSourceIds.length} 个来源缺失</summary>
          <p>完整生成默认停用。确认后可基于现有内容生成，并在结果中标记缺失。</p>
          <ul>
            {scope.missingSourceIds.slice(0, 5).map((sourceId) => <li key={sourceId}>{sourceId}</li>)}
            {scope.missingSourceIds.length > 5 ? <li>以及其他 {scope.missingSourceIds.length - 5} 项</li> : null}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

type ModuleGroupShape = {
  id: string;
  label: string;
  moduleIds?: readonly ReviewModuleId[];
};

function ReviewConfig({
  scope,
  selectedModuleIds,
  presetId,
  allowPartial,
  job,
  disabledScopeTypes,
  processingHint,
  onScopeChange,
  onModulesChange,
  onAllowPartialChange,
  onGenerate,
  onOpenSource,
  onOpenSettings,
  onCancelJob,
  onRetryAll,
  onDirty,
}: Pick<
  ConversationReviewDialogProps,
  | "scope"
  | "selectedModuleIds"
  | "presetId"
  | "allowPartial"
  | "job"
  | "disabledScopeTypes"
  | "processingHint"
  | "onScopeChange"
  | "onModulesChange"
  | "onAllowPartialChange"
  | "onGenerate"
  | "onOpenSource"
  | "onOpenSettings"
  | "onCancelJob"
  | "onRetryAll"
> & { onDirty: () => void }) {
  const selected = useMemo(() => new Set(selectedModuleIds), [selectedModuleIds]);
  const commonModules = REVIEW_MODULES.filter((module) => module.common);
  const allGroups = REVIEW_MODULE_GROUPS as readonly ModuleGroupShape[];
  const groups = allGroups.filter((group) => group.id !== "common");
  const groupedIds = new Set(allGroups.flatMap((group) => group.moduleIds ?? []));
  const extraModules = REVIEW_MODULES.filter((module) => !module.common && !groupedIds.has(module.id));
  const active = isActiveJob(job);
  const incomplete = scope.completeness === "partial" || scope.missingSourceIds.length > 0;
  const generateDisabled = active || selected.size === 0 || scope.messageCount === 0 || (incomplete && !allowPartial);

  function replaceSelection(ids: readonly ReviewModuleId[], nextPreset: ReviewPresetId) {
    onDirty();
    onModulesChange([...ids], nextPreset);
  }

  function toggleModule(moduleId: ReviewModuleId) {
    const next = new Set(selected);
    if (next.has(moduleId)) next.delete(moduleId);
    else next.add(moduleId);
    replaceSelection(REVIEW_MODULES.map((item) => item.id).filter((id) => next.has(id)), "custom");
  }

  function toggleGroup(moduleIds: readonly ReviewModuleId[], selectAll: boolean) {
    const next = new Set(selected);
    for (const moduleId of moduleIds) {
      if (selectAll) next.add(moduleId);
      else next.delete(moduleId);
    }
    replaceSelection(REVIEW_MODULES.map((item) => item.id).filter((id) => next.has(id)), "custom");
  }

  function renderModuleChecks(moduleIds: readonly ReviewModuleId[]) {
    return (
      <div className="conversation-review__module-grid">
        {moduleIds.map((moduleId) => (
          <label className="conversation-review__module-option" key={moduleId}>
            <input
              type="checkbox"
              checked={selected.has(moduleId)}
              onChange={() => toggleModule(moduleId)}
            />
            <span>{moduleLabel(moduleId)}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="conversation-review conversation-review--config">
      <fieldset className="conversation-review__section">
        <legend>总结范围</legend>
        <div className="conversation-review__scope-options">
          {SCOPE_ORDER.map((scopeType) => {
            const disabledReason = disabledScopeTypes?.[scopeType];
            return (
              <label className="conversation-review__scope-option" key={scopeType} title={disabledReason}>
                <input
                  type="radio"
                  name="conversation-review-scope"
                  value={scopeType}
                  checked={scope.type === scopeType}
                  disabled={Boolean(disabledReason)}
                  onChange={() => {
                    onDirty();
                    onScopeChange(scopeType);
                  }}
                />
                <span>
                  <strong>{SCOPE_COPY[scopeType].label}</strong>
                  <small>{disabledReason ?? SCOPE_COPY[scopeType].description}</small>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <ScopePreview
        scope={scope}
        processingHint={processingHint ?? getProcessingHint(scope, selected.size)}
      />
      {scope.messageCount === 0 && onOpenSource ? (
        <div className="conversation-review__open-source">
          <span>当前无法读取此范围的来源消息。</span>
          <button className="button" type="button" onClick={() => void onOpenSource()}>
            <ExternalLink size={14} aria-hidden="true" /> 打开来源会话
          </button>
        </div>
      ) : null}

      <section className="conversation-review__section" aria-labelledby="review-presets-heading">
        <div className="conversation-review__section-heading">
          <h3 id="review-presets-heading">预设模板</h3>
          {presetId === "custom" ? <span className="conversation-review__tag">自定义</span> : null}
        </div>
        <div className="conversation-review__presets">
          {REVIEW_PRESETS.map((preset) => (
            <button
              className={`button ${presetId === preset.id ? "button--primary" : ""}`}
              type="button"
              key={preset.id}
              aria-pressed={presetId === preset.id}
              onClick={() => replaceSelection(preset.moduleIds, preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="conversation-review__section" aria-labelledby="review-common-heading">
        <div className="conversation-review__section-heading">
          <h3 id="review-common-heading">常用内容</h3>
          <div>
            <button className="button button--text" type="button" onClick={() => toggleGroup(commonModules.map((item) => item.id), true)}>全选</button>
            <button className="button button--text" type="button" onClick={() => toggleGroup(commonModules.map((item) => item.id), false)}>清空</button>
          </div>
        </div>
        {renderModuleChecks(commonModules.map((item) => item.id))}
      </section>

      <details className="conversation-review__more">
        <summary>更多内容</summary>
        {groups.map((group) => {
          const moduleIds = group.moduleIds ?? REVIEW_MODULES
            .filter((module) => !module.common && module.group === group.id)
            .map((module) => module.id);
          if (!moduleIds.length) return null;
          return (
            <section className="conversation-review__module-group" key={group.id} aria-labelledby={`review-group-${group.id}`}>
              <div className="conversation-review__section-heading">
                <h4 id={`review-group-${group.id}`}>{group.label}</h4>
                <div>
                  <button className="button button--text" type="button" onClick={() => toggleGroup(moduleIds, true)}>全选</button>
                  <button className="button button--text" type="button" onClick={() => toggleGroup(moduleIds, false)}>清空</button>
                </div>
              </div>
              {renderModuleChecks(moduleIds)}
            </section>
          );
        })}
        {extraModules.length ? (
          <section className="conversation-review__module-group" aria-labelledby="review-group-extra">
            <div className="conversation-review__section-heading">
              <h4 id="review-group-extra">其他内容</h4>
            </div>
            {renderModuleChecks(extraModules.map((item) => item.id))}
          </section>
        ) : null}
      </details>

      <div className="conversation-review__selection-summary">
        <strong>已选 {selected.size} 项</strong>
        <button className="button button--text" type="button" disabled={!selected.size} onClick={() => replaceSelection([], "custom")}>清空全部</button>
      </div>

      {incomplete ? (
        <label className="check-row conversation-review__partial-confirm">
          <input
            type="checkbox"
            checked={allowPartial}
            onChange={(event) => {
              onDirty();
              onAllowPartialChange(event.target.checked);
            }}
          />
          我已了解来源不完整，仍要生成带缺失标记的部分结果
        </label>
      ) : null}

      {job ? (
        <JobProgress
          job={job}
          {...(onCancelJob ? { onCancel: onCancelJob } : {})}
          {...(onRetryAll ? { onRetry: onRetryAll } : {})}
          {...(onOpenSettings ? { onSettings: onOpenSettings } : {})}
        />
      ) : null}

      <div className="form-actions">
        <button
          className="button button--primary"
          type="button"
          disabled={generateDisabled}
          onClick={() => void onGenerate({
            scopeType: scope.type,
            presetId,
            moduleIds: [...selectedModuleIds],
            allowPartial,
          })}
        >
          {active ? "生成中…" : "生成总结"}
        </button>
      </div>
    </div>
  );
}

function EvidenceDrawer({
  evidences,
  unavailableEvidenceIds,
  onLocate,
  onClose,
}: {
  evidences: ReviewEvidence[];
  unavailableEvidenceIds: ReadonlySet<string>;
  onLocate?: (evidence: ReviewEvidence) => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <aside className="conversation-review__evidence-drawer" role="region" aria-label="原始消息依据">
      <div className="conversation-review__section-heading">
        <h3>原始消息依据</h3>
        <button className="icon-button" type="button" aria-label="关闭依据" onClick={onClose}>×</button>
      </div>
      {evidences.length ? (
        <ol>
          {evidences.map((evidence) => {
            const unavailable = unavailableEvidenceIds.has(evidence.id);
            return (
              <li className="conversation-review__evidence" key={evidence.id}>
                <div>
                  <span>{evidence.role === "user" ? "用户" : "助手"} · 消息 {evidence.ordinal + 1}</span>
                  {evidence.branchPath?.length ? <small>分支：{evidence.branchPath.join(" › ")}</small> : null}
                </div>
                <blockquote>{evidence.excerpt}</blockquote>
                <button
                  className="button"
                  type="button"
                  disabled={unavailable || !onLocate}
                  onClick={() => void onLocate?.(evidence)}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {unavailable ? "来源不可用" : "定位原消息"}
                </button>
              </li>
            );
          })}
        </ol>
      ) : <p>没有可定位的来源；相关内容应视为系统推断。</p>}
    </aside>
  );
}

function ResultModule({
  module,
  snapshot,
  evidences,
  expanded,
  feedback,
  onToggle,
  onChange,
  onDeleteItem,
  onShowEvidence,
  onCopy,
  onRetry,
  onUndo,
  onRestore,
  onFeedbackChange,
  onFeedbackSubmit,
  onCreateBranch,
  readOnly = false,
}: {
  module: ReviewModuleResult;
  snapshot: ReviewModuleSnapshot;
  evidences: Map<string, ReviewEvidence>;
  expanded: boolean;
  feedback: string;
  onToggle: () => void;
  onChange: (snapshot: ReviewModuleSnapshot) => void;
  onDeleteItem?: (itemId: string) => void;
  onShowEvidence: (ids: string[]) => void;
  onCopy?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onUndo?: () => void;
  onRestore?: () => void;
  onFeedbackChange: (feedback: string) => void;
  onFeedbackSubmit?: (feedback: string) => void;
  onCreateBranch?: (candidate: ReviewBranchCandidate) => void | Promise<void>;
  readOnly?: boolean;
}) {
  const edited = Boolean(module.editedAt) || !snapshotsEqual(snapshot, module.generated);
  const canUndo = module.editHistory.length > 0;
  const canRestore = !snapshotsEqual(snapshot, module.generated);

  return (
    <section className={`conversation-review__module conversation-review__module--${module.state}`} aria-labelledby={`review-module-${module.moduleId}`}>
      <header className="conversation-review__module-header">
        <button className="conversation-review__collapse" type="button" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          <span id={`review-module-${module.moduleId}`}>{moduleLabel(module.moduleId)}</span>
        </button>
        <div className="conversation-review__module-badges">
          {edited ? <span className="conversation-review__tag">用户已编辑</span> : null}
          {module.state !== "completed" ? <span className="conversation-review__tag">{module.state === "empty" ? "无相关内容" : module.state === "failed" ? "生成失败" : module.state === "generating" ? "生成中" : "等待生成"}</span> : null}
        </div>
      </header>

      {expanded ? (
        <div className="conversation-review__module-body">
          {module.state === "failed" ? <p role="alert">{module.error ?? "该模块生成失败。"}</p> : null}
          {module.state === "empty" ? <p>本轮未发现相关内容。</p> : null}
          {["queued", "generating"].includes(module.state) ? <p>{module.state === "generating" ? "正在生成此模块…" : "等待生成此模块…"}</p> : null}
          {["completed", "empty", "failed"].includes(module.state) ? (
            <>
              <label className="conversation-review__overview-editor">
                模块概览
                <textarea
                  disabled={readOnly}
                  rows={3}
                  value={snapshot.overview}
                  placeholder={module.state === "empty" ? "本轮未发现相关内容" : "输入模块概览"}
                  onChange={(event) => onChange({ ...snapshot, overview: event.target.value })}
                />
              </label>

              <ol className="conversation-review__items">
                {snapshot.items.map((item) => {
                  const evidenceIds = item.evidenceIds.filter((id) => evidences.has(id));
                  return (
                    <li key={item.id} className="conversation-review__item">
                      <div className="conversation-review__item-tags">
                        {item.status ? <span className={`conversation-review__status conversation-review__status--${item.status}`}>{CLAIM_STATUS_LABELS[item.status]}</span> : null}
                        {item.isInference ? <span className="conversation-review__tag conversation-review__tag--inference">系统推断</span> : null}
                        {item.isUserEdited ? <span className="conversation-review__tag">用户编辑</span> : null}
                      </div>
                      <textarea
                        disabled={readOnly}
                        aria-label={`${moduleLabel(module.moduleId)}条目`}
                        rows={2}
                        value={item.text}
                        onChange={(event) => onChange({
                          ...snapshot,
                          items: snapshot.items.map((candidate) => candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate),
                        })}
                      />
                      <div className="conversation-review__item-actions">
                        <button
                          className="button button--text"
                          type="button"
                          disabled={!evidenceIds.length}
                          onClick={() => onShowEvidence(evidenceIds)}
                        >
                          查看依据{evidenceIds.length ? ` (${evidenceIds.length})` : ""}
                        </button>
                        <button className="icon-button" type="button" disabled={readOnly} aria-label={`删除条目：${item.text}`} onClick={() => onDeleteItem?.(item.id)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {snapshot.branchCandidates?.length ? (
                <div className="conversation-review__branches">
                  <h4>建议的新分支</h4>
                  {snapshot.branchCandidates.map((candidate) => (
                    <article key={candidate.id}>
                      <strong>{candidate.title}</strong>
                      <p>{candidate.rationale}</p>
                      <blockquote>{candidate.firstQuestion}</blockquote>
                      <button className="button" type="button" disabled={readOnly || !onCreateBranch} onClick={() => void onCreateBranch?.(candidate)}>
                        <GitBranchPlus size={14} aria-hidden="true" /> 创建新分支
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="conversation-review__module-actions">
            <button className="button" type="button" disabled={!onCopy} onClick={() => void onCopy?.()}>
              <Clipboard size={14} aria-hidden="true" /> 复制模块
            </button>
            <button className="button" type="button" disabled={readOnly || !onRetry} onClick={() => void onRetry?.()}>
              <RotateCcw size={14} aria-hidden="true" /> 重试模块
            </button>
            <button className="button" type="button" disabled={readOnly || !canUndo || !onUndo} onClick={onUndo}>
              撤销上次编辑
            </button>
            <button className="button" type="button" disabled={readOnly || !canRestore || !onRestore} onClick={onRestore}>
              恢复模型版本
            </button>
          </div>

          <details className="conversation-review__module-feedback">
            <summary>反馈模块问题</summary>
            <label>
              仅保存在本地
              <textarea disabled={readOnly} rows={2} value={feedback} onChange={(event) => onFeedbackChange(event.target.value)} />
            </label>
            <button className="button" type="button" disabled={readOnly || !onFeedbackSubmit || !feedback.trim()} onClick={() => onFeedbackSubmit?.(feedback.trim())}>保存反馈</button>
          </details>
        </div>
      ) : null}
    </section>
  );
}

function ReviewResult({
  version,
  job,
  stale,
  unavailableEvidenceIds,
  title,
  moduleDrafts,
  includeEvidence,
  expandedModules,
  feedbackDrafts,
  onTitleChange,
  onModuleChange,
  onDeleteItem,
  onToggleModule,
  onShowEvidence,
  onIncludeEvidenceChange,
  onFeedbackDraftChange,
  onViewChange,
  onOpenSettings,
  onCancelJob,
  onRetryAll,
  onRetryModule,
  onUndoModuleEdit,
  onRestoreModule,
  onCopyAll,
  onCopyModule,
  onCopyContextPackage,
  onExportMarkdown,
  onSave,
  graphAnchorNodeId,
  graphAnchorNodeOptions,
  onGraphAnchorChange,
  onFeedback,
  onModuleFeedback,
  onCreateBranch,
}: {
  version: ReviewVersion;
  job?: ReviewJob;
  stale: boolean;
  unavailableEvidenceIds: ReadonlySet<string>;
  title: string;
  moduleDrafts: Map<ReviewModuleId, ReviewModuleSnapshot>;
  includeEvidence: boolean;
  expandedModules: ReadonlySet<ReviewModuleId>;
  feedbackDrafts: Partial<Record<ReviewModuleId, string>>;
  onTitleChange: (title: string) => void;
  onModuleChange: (moduleId: ReviewModuleId, snapshot: ReviewModuleSnapshot) => void;
  onDeleteItem: (moduleId: ReviewModuleId, itemId: string) => void;
  onToggleModule: (moduleId: ReviewModuleId) => void;
  onShowEvidence: (ids: string[]) => void;
  onIncludeEvidenceChange: (include: boolean) => void;
  onFeedbackDraftChange: (moduleId: ReviewModuleId, feedback: string) => void;
  onViewChange?: (view: ConversationReviewView) => void;
  onOpenSettings?: () => void;
  onCancelJob?: () => void | Promise<void>;
  onRetryAll?: () => void | Promise<void>;
  onRetryModule?: (moduleId: ReviewModuleId) => void | Promise<void>;
  onUndoModuleEdit?: (moduleId: ReviewModuleId) => void;
  onRestoreModule?: (moduleId: ReviewModuleId) => void;
  onCopyAll?: () => void | Promise<void>;
  onCopyModule?: (moduleId: ReviewModuleId) => void | Promise<void>;
  onCopyContextPackage?: () => void | Promise<void>;
  onExportMarkdown?: (options: { includeEvidence: boolean }) => void | Promise<void>;
  onSave: () => void;
  graphAnchorNodeId?: string;
  graphAnchorNodeOptions?: readonly { id: string; label: string }[];
  onGraphAnchorChange?: (nodeId: string) => void;
  onFeedback?: (helpful: boolean) => void;
  onModuleFeedback?: (moduleId: ReviewModuleId, feedback: string) => void;
  onCreateBranch?: (candidate: ReviewBranchCandidate) => void | Promise<void>;
}) {
  const evidenceMap = useMemo(() => new Map(version.evidences.map((evidence) => [evidence.id, evidence])), [version.evidences]);
  const modulesById = useMemo(() => new Map(version.modules.map((module) => [module.moduleId, module])), [version.modules]);
  const readOnly = isActiveJob(job);

  return (
    <div className="conversation-review conversation-review--result">
      <label className="conversation-review__title-editor">
        总结标题
        <input disabled={readOnly} value={title} maxLength={160} onChange={(event) => onTitleChange(event.target.value)} />
      </label>

      <div className="conversation-review__metadata">
        <span>{SCOPE_COPY[version.scope.type].label}</span>
        <span>{formatGeneratedAt(version.generatedAt)}</span>
        <span>{version.scope.completeness === "complete" ? "来源完整" : "部分来源缺失"}</span>
        {version.segmented ? <span>已分 {version.segmentCount} 段处理</span> : null}
      </div>

      {stale ? <p className="conversation-review__stale" role="status">该范围已有后续消息；当前版本不会自动改写。</p> : null}
      {version.missingRanges.length ? (
        <details className="conversation-review__missing">
          <summary>有 {version.missingRanges.length} 个范围处理失败</summary>
          <ul>{version.missingRanges.map((range) => <li key={range}>{range}</li>)}</ul>
        </details>
      ) : null}
      {job ? (
        <JobProgress
          job={job}
          {...(onCancelJob ? { onCancel: onCancelJob } : {})}
          {...(onRetryAll ? { onRetry: onRetryAll } : {})}
          {...(onOpenSettings ? { onSettings: onOpenSettings } : {})}
          {...(onViewChange ? { onAdjustScope: () => onViewChange("config") } : {})}
        />
      ) : null}

      <div className="conversation-review__toolbar" aria-label="总结操作">
        <button className="button" type="button" disabled={!onViewChange} onClick={() => onViewChange?.("config")}>调整配置</button>
        <button className="button" type="button" disabled={!onCopyAll} onClick={() => void onCopyAll?.()}><Clipboard size={14} aria-hidden="true" /> 复制完整总结</button>
        <button className="button" type="button" disabled={!onCopyContextPackage} onClick={() => void onCopyContextPackage?.()}><FilePlus2 size={14} aria-hidden="true" /> 复制上下文包</button>
        <button className="button" type="button" disabled={!onRetryAll || isActiveJob(job)} onClick={() => void onRetryAll?.()}><RotateCcw size={14} aria-hidden="true" /> 重新生成全部</button>
      </div>

      <div className="conversation-review__modules">
        {version.moduleOrder.map((moduleId) => {
          const module = modulesById.get(moduleId);
          if (!module) return null;
          const snapshot = moduleDrafts.get(moduleId) ?? module.current;
          return (
            <ResultModule
              key={moduleId}
              module={module}
              snapshot={snapshot}
              evidences={evidenceMap}
              expanded={expandedModules.has(moduleId)}
              feedback={feedbackDrafts[moduleId] ?? version.moduleFeedback?.[moduleId] ?? ""}
              onToggle={() => onToggleModule(moduleId)}
              readOnly={readOnly}
              onChange={(next) => onModuleChange(moduleId, next)}
              onDeleteItem={(itemId) => onDeleteItem(moduleId, itemId)}
              onShowEvidence={onShowEvidence}
              {...(onCopyModule ? { onCopy: () => onCopyModule(moduleId) } : {})}
              {...(onRetryModule ? { onRetry: () => onRetryModule(moduleId) } : {})}
              {...(onUndoModuleEdit ? { onUndo: () => onUndoModuleEdit(moduleId) } : {})}
              {...(onRestoreModule ? { onRestore: () => onRestoreModule(moduleId) } : {})}
              onFeedbackChange={(feedback) => onFeedbackDraftChange(moduleId, feedback)}
              {...(onModuleFeedback ? { onFeedbackSubmit: (feedback: string) => onModuleFeedback(moduleId, feedback) } : {})}
              {...(onCreateBranch ? { onCreateBranch } : {})}
            />
          );
        })}
      </div>

      <section className="conversation-review__export" aria-labelledby="review-export-heading">
        <h3 id="review-export-heading">导出与保存</h3>
        {graphAnchorNodeOptions?.length ? (
          <label className="conversation-review__graph-anchor">
            图中连接节点
            <select
              disabled={readOnly}
              value={graphAnchorNodeId ?? ""}
              onChange={(event) => onGraphAnchorChange?.(event.target.value)}
            >
              {graphAnchorNodeOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="check-row">
          <input type="checkbox" checked={includeEvidence} onChange={(event) => onIncludeEvidenceChange(event.target.checked)} />
          Markdown 中保留证据引用
        </label>
        <div className="conversation-review__toolbar">
          <button className="button" type="button" disabled={!onExportMarkdown} onClick={() => void onExportMarkdown?.({ includeEvidence })}>
            <Download size={14} aria-hidden="true" /> 导出 Markdown
          </button>
          <button className="button button--primary" type="button" disabled={readOnly} onClick={onSave}>
            <Save size={14} aria-hidden="true" /> 保存到图
          </button>
        </div>
      </section>

      <section className="conversation-review__feedback" aria-label="总结反馈">
        <span>这份总结有帮助吗？</span>
        <button className="button" type="button" aria-pressed={version.helpful === true} disabled={!onFeedback} onClick={() => onFeedback?.(true)}><ThumbsUp size={14} aria-hidden="true" /> 有帮助</button>
        <button className="button" type="button" aria-pressed={version.helpful === false} disabled={!onFeedback} onClick={() => onFeedback?.(false)}><ThumbsDown size={14} aria-hidden="true" /> 没帮助</button>
      </section>
    </div>
  );
}

function ChoiceDialog({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-copy confirm-copy--primary"><p>{children}</p></div>
      <div className="form-actions">{actions}</div>
    </Modal>
  );
}

export function ConversationReviewDialog(props: ConversationReviewDialogProps) {
  const { version } = props;
  const [localDirty, setLocalDirty] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [choosingSaveStrategy, setChoosingSaveStrategy] = useState(false);
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [title, setTitle] = useState(version?.title ?? "对话总结");
  const [moduleDrafts, setModuleDrafts] = useState<Map<ReviewModuleId, ReviewModuleSnapshot>>(
    () => new Map(version?.modules.map((module) => [module.moduleId, module.current])),
  );
  const [expandedModules, setExpandedModules] = useState<Set<ReviewModuleId>>(
    () => new Set(version?.moduleOrder ?? []),
  );
  const [visibleEvidenceIds, setVisibleEvidenceIds] = useState<string[]>();
  const [feedbackDrafts, setFeedbackDrafts] = useState<Partial<Record<ReviewModuleId, string>>>({});

  useEffect(() => {
    setTitle(version?.title ?? "对话总结");
    setModuleDrafts(new Map(version?.modules.map((module) => [module.moduleId, module.current])));
    setExpandedModules(new Set(version?.moduleOrder ?? []));
    setFeedbackDrafts(version?.moduleFeedback ?? {});
    setVisibleEvidenceIds(undefined);
    setLocalDirty(false);
  }, [version?.id]);

  const unavailableEvidenceIds = useMemo(
    () => new Set(props.unavailableEvidenceIds ?? []),
    [props.unavailableEvidenceIds],
  );
  const hasUnsavedChanges = Boolean(props.dirty) || localDirty;

  function requestClose() {
    if (hasUnsavedChanges) setConfirmingClose(true);
    else props.onClose();
  }

  async function saveDraftAndClose() {
    await props.onSaveDraft?.();
    setLocalDirty(false);
    props.onClose();
  }

  async function saveToGraph(strategy: ReviewGraphSaveStrategy) {
    try {
      const saved = await props.onSaveToGraph?.(strategy);
      if (saved === false) return;
      setChoosingSaveStrategy(false);
      setLocalDirty(false);
    } catch {
      // The controlled owner presents the operation-specific error.
    }
  }

  if (confirmingClose) {
    return (
      <ChoiceDialog
        title="保留未保存的总结？"
        onClose={() => setConfirmingClose(false)}
        actions={(
          <>
            <button className="button" type="button" onClick={() => setConfirmingClose(false)}>继续编辑</button>
            <button className="button button--danger" type="button" onClick={props.onClose}>放弃更改</button>
            <button className="button button--primary" type="button" onClick={() => void saveDraftAndClose()}>保留草稿并关闭</button>
          </>
        )}
      >配置或结果已有改动。活动中的生成任务会在关闭界面后继续。</ChoiceDialog>
    );
  }

  if (choosingSaveStrategy) {
    return (
      <ChoiceDialog
        title="保存总结到图"
        onClose={() => setChoosingSaveStrategy(false)}
        actions={(
          <>
            <button className="button" type="button" onClick={() => setChoosingSaveStrategy(false)}>取消</button>
            <button className="button" type="button" onClick={() => void saveToGraph("new")}>创建独立版本</button>
            <button className="button button--primary" type="button" onClick={() => void saveToGraph("update")}>更新原总结</button>
          </>
        )}
      >同一范围已有保存的总结。请选择保留图中节点的方式。</ChoiceDialog>
    );
  }

  const selectedEvidences = visibleEvidenceIds && version
    ? visibleEvidenceIds.map((id) => version.evidences.find((evidence) => evidence.id === id)).filter((evidence): evidence is ReviewEvidence => Boolean(evidence))
    : [];

  return (
    <Modal
      title={props.view === "config" ? "生成对话总结" : "对话总结"}
      description={props.view === "config" ? "选择范围和内容；对话原文只在生成期间临时使用。" : "核对、编辑、导出或保存这份总结。"}
      onClose={requestClose}
    >
      {props.view === "config" ? (
        <ReviewConfig
          scope={props.scope}
          selectedModuleIds={props.selectedModuleIds}
          presetId={props.presetId}
          allowPartial={props.allowPartial}
          onScopeChange={props.onScopeChange}
          onModulesChange={props.onModulesChange}
          onAllowPartialChange={props.onAllowPartialChange}
          onGenerate={props.onGenerate}
          {...(props.onOpenSource ? { onOpenSource: props.onOpenSource } : {})}
          {...(props.onOpenSettings ? { onOpenSettings: props.onOpenSettings } : {})}
          onDirty={() => setLocalDirty(true)}
          {...(props.job ? { job: props.job } : {})}
          {...(props.disabledScopeTypes ? { disabledScopeTypes: props.disabledScopeTypes } : {})}
          {...(props.processingHint ? { processingHint: props.processingHint } : {})}
          {...(props.onCancelJob ? { onCancelJob: props.onCancelJob } : {})}
          {...(props.onRetryAll ? { onRetryAll: props.onRetryAll } : {})}
        />
      ) : version ? (
        <>
          <ReviewResult
            version={version}
            stale={Boolean(props.stale)}
            unavailableEvidenceIds={unavailableEvidenceIds}
            title={title}
            moduleDrafts={moduleDrafts}
            includeEvidence={includeEvidence}
            expandedModules={expandedModules}
            feedbackDrafts={feedbackDrafts}
            onTitleChange={(nextTitle) => {
              setTitle(nextTitle);
              setLocalDirty(true);
              props.onTitleChange?.(nextTitle);
            }}
            onModuleChange={(moduleId, snapshot) => {
              setModuleDrafts((current) => new Map(current).set(moduleId, snapshot));
              setLocalDirty(true);
              props.onUpdateModule?.(moduleId, snapshot);
            }}
            onDeleteItem={(moduleId, itemId) => {
              const currentModule = moduleDrafts.get(moduleId);
              if (currentModule) {
                const next = { ...currentModule, items: currentModule.items.filter((item) => item.id !== itemId) };
                setModuleDrafts((current) => new Map(current).set(moduleId, next));
              }
              setLocalDirty(true);
              props.onDeleteItem?.(moduleId, itemId);
            }}
            onToggleModule={(moduleId) => setExpandedModules((current) => {
              const next = new Set(current);
              if (next.has(moduleId)) next.delete(moduleId);
              else next.add(moduleId);
              return next;
            })}
            onShowEvidence={setVisibleEvidenceIds}
            onIncludeEvidenceChange={setIncludeEvidence}
            onFeedbackDraftChange={(moduleId, feedback) => setFeedbackDrafts((current) => ({ ...current, [moduleId]: feedback }))}
            onSave={() => {
              if (!props.onSaveToGraph) return;
              if (props.hasExistingGraphDocument) setChoosingSaveStrategy(true);
              else void saveToGraph("new");
            }}
            {...(props.graphAnchorNodeId ? { graphAnchorNodeId: props.graphAnchorNodeId } : {})}
            {...(props.graphAnchorNodeOptions ? { graphAnchorNodeOptions: props.graphAnchorNodeOptions } : {})}
            {...(props.onGraphAnchorChange ? { onGraphAnchorChange: props.onGraphAnchorChange } : {})}
            {...(props.job ? { job: props.job } : {})}
            {...(props.onViewChange ? { onViewChange: props.onViewChange } : {})}
            {...(props.onOpenSettings ? { onOpenSettings: props.onOpenSettings } : {})}
            {...(props.onCancelJob ? { onCancelJob: props.onCancelJob } : {})}
            {...(props.onRetryAll ? { onRetryAll: props.onRetryAll } : {})}
            {...(props.onRetryModule ? { onRetryModule: props.onRetryModule } : {})}
            {...(props.onUndoModuleEdit ? { onUndoModuleEdit: (moduleId: ReviewModuleId) => {
              const module = version.modules.find((item) => item.moduleId === moduleId);
              const previous = module?.editHistory.at(-1);
              if (previous) setModuleDrafts((current) => new Map(current).set(moduleId, previous));
              setLocalDirty(true);
              props.onUndoModuleEdit?.(moduleId);
            } } : {})}
            {...(props.onRestoreModule ? { onRestoreModule: (moduleId: ReviewModuleId) => {
              const module = version.modules.find((item) => item.moduleId === moduleId);
              if (module) setModuleDrafts((current) => new Map(current).set(moduleId, module.generated));
              setLocalDirty(true);
              props.onRestoreModule?.(moduleId);
            } } : {})}
            {...(props.onCopyAll ? { onCopyAll: props.onCopyAll } : {})}
            {...(props.onCopyModule ? { onCopyModule: props.onCopyModule } : {})}
            {...(props.onCopyContextPackage ? { onCopyContextPackage: props.onCopyContextPackage } : {})}
            {...(props.onExportMarkdown ? { onExportMarkdown: props.onExportMarkdown } : {})}
            {...(props.onFeedback ? { onFeedback: props.onFeedback } : {})}
            {...(props.onModuleFeedback ? { onModuleFeedback: props.onModuleFeedback } : {})}
            {...(props.onCreateBranch ? { onCreateBranch: props.onCreateBranch } : {})}
          />
          {visibleEvidenceIds ? (
            <EvidenceDrawer
              evidences={selectedEvidences}
              unavailableEvidenceIds={unavailableEvidenceIds}
              onClose={() => setVisibleEvidenceIds(undefined)}
              {...(props.onLocateEvidence ? { onLocate: props.onLocateEvidence } : {})}
            />
          ) : null}
        </>
      ) : (
        <div className="empty-state" role="status">
          <p>总结结果尚不可用。</p>
          {props.job ? (
            <JobProgress
              job={props.job}
              {...(props.onCancelJob ? { onCancel: props.onCancelJob } : {})}
              {...(props.onRetryAll ? { onRetry: props.onRetryAll } : {})}
              {...(props.onOpenSettings ? { onSettings: props.onOpenSettings } : {})}
              {...(props.onViewChange ? { onAdjustScope: () => props.onViewChange?.("config") } : {})}
            />
          ) : null}
          {props.onViewChange ? <button className="button" type="button" onClick={() => props.onViewChange?.("config")}>返回配置</button> : null}
        </div>
      )}
    </Modal>
  );
}
