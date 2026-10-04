// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationReviewDialog } from "../components/ConversationReviewDialog";
import { REVIEW_PRESETS } from "../review/catalog";
import type {
  ReviewJob,
  ReviewModuleId,
  ReviewPresetId,
  ReviewScope,
  ReviewVersion,
} from "../types/domain";

function scope(overrides: Partial<ReviewScope> = {}): ReviewScope {
  return {
    type: "current_branch",
    chatId: "chat-1",
    anchorNodeId: "node-2",
    rootNodeId: "node-1",
    nodeIds: ["node-1", "node-2"],
    messageSourceIds: ["source-1", "source-2"],
    messageCount: 2,
    nodeCount: 2,
    includesOtherBranches: false,
    completeness: "complete",
    missingSourceIds: [],
    estimatedTokens: 1_200,
    sourceSnapshotHash: "snapshot-1",
    ...overrides,
  };
}

function version(): ReviewVersion {
  return {
    id: "version-1",
    documentId: "document-1",
    projectId: "project-1",
    version: 1,
    title: "原始总结标题",
    scope: scope(),
    moduleOrder: ["discussion_overview", "suggested_new_branches"],
    modules: [
      {
        moduleId: "discussion_overview",
        state: "completed",
        generated: {
          overview: "模型概览",
          items: [{
            id: "item-1",
            text: "模型结论",
            status: "confirmed",
            isInference: false,
            evidenceIds: ["evidence-1"],
          }],
        },
        current: {
          overview: "编辑后概览",
          items: [{
            id: "item-1",
            text: "编辑后结论",
            status: "confirmed",
            isInference: false,
            evidenceIds: ["evidence-1"],
          }],
        },
        editHistory: [{
          overview: "上一次概览",
          items: [{
            id: "item-1",
            text: "上一次结论",
            status: "confirmed",
            isInference: false,
            evidenceIds: ["evidence-1"],
          }],
        }],
        editedAt: 2,
      },
      {
        moduleId: "suggested_new_branches",
        state: "completed",
        generated: {
          overview: "可以继续探索一个方向",
          items: [],
          branchCandidates: [{
            id: "branch-1",
            title: "性能分支",
            rationale: "当前对话尚未讨论性能边界。",
            firstQuestion: "峰值负载需要支持多少并发？",
            sourceNodeId: "node-2",
          }],
        },
        current: {
          overview: "可以继续探索一个方向",
          items: [],
          branchCandidates: [{
            id: "branch-1",
            title: "性能分支",
            rationale: "当前对话尚未讨论性能边界。",
            firstQuestion: "峰值负载需要支持多少并发？",
            sourceNodeId: "node-2",
          }],
        },
        editHistory: [],
      },
    ],
    evidences: [{
      id: "evidence-1",
      sourceId: "source-1",
      chatId: "chat-1",
      role: "user",
      excerpt: "这是支持该结论的用户原话。",
      ordinal: 0,
      locator: {
        version: 1,
        chatId: "chat-1",
        role: "user",
        messageId: "message-1",
        ordinal: 0,
        fingerprint: "fingerprint-1",
      },
      nodeId: "node-1",
      branchPath: ["根问题", "当前问题"],
    }],
    providerId: "openai",
    model: "gpt-test",
    segmented: false,
    segmentCount: 1,
    missingRanges: [],
    generatedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function job(status: ReviewJob["status"] = "generating"): ReviewJob {
  return {
    id: "job-1",
    projectId: "project-1",
    documentId: "document-1",
    scopeFamilyKey: "family-1",
    scope: scope(),
    selectedModuleIds: ["discussion_overview"],
    presetId: "general",
    status,
    progress: { current: 1, total: 3, message: "正在生成第 1 个模块" },
    moduleStates: { discussion_overview: "generating" },
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
  };
}

describe("ConversationReviewDialog", () => {
  afterEach(cleanup);

  it("offers three scopes, five presets, all modules, custom selection and partial-source confirmation", async () => {
    const onGenerate = vi.fn();
    const onModulesChange = vi.fn();

    function Harness() {
      const [selectedModuleIds, setSelectedModuleIds] = useState<ReviewModuleId[]>(
        [...REVIEW_PRESETS[0].moduleIds],
      );
      const [presetId, setPresetId] = useState<ReviewPresetId>("general");
      const [allowPartial, setAllowPartial] = useState(false);
      return (
        <ConversationReviewDialog
          view="config"
          scope={scope({ completeness: "partial", missingSourceIds: ["missing-1"] })}
          selectedModuleIds={selectedModuleIds}
          presetId={presetId}
          allowPartial={allowPartial}
          onClose={vi.fn()}
          onScopeChange={vi.fn()}
          onModulesChange={(moduleIds, nextPreset) => {
            onModulesChange(moduleIds, nextPreset);
            setSelectedModuleIds(moduleIds);
            setPresetId(nextPreset);
          }}
          onAllowPartialChange={setAllowPartial}
          onGenerate={onGenerate}
        />
      );
    }

    render(<Harness />);

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    for (const preset of REVIEW_PRESETS) {
      expect(screen.getByRole("button", { name: preset.label })).toBeDefined();
    }
    expect((screen.getByRole("button", { name: "生成总结" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByText("更多内容"));
    expect(screen.getAllByRole("checkbox")).toHaveLength(34);
    await userEvent.click(screen.getByRole("checkbox", { name: "考虑过哪些方案" }));
    expect(onModulesChange).toHaveBeenLastCalledWith(expect.arrayContaining(["considered_options"]), "custom");
    expect(screen.getByText("自定义")).toBeDefined();

    await userEvent.click(screen.getByRole("checkbox", { name: /我已了解来源不完整/ }));
    await userEvent.click(screen.getByRole("button", { name: "生成总结" }));
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: "current_branch",
      presetId: "custom",
      allowPartial: true,
    }));
  });

  it("shows persistent job progress and supports cancellation", async () => {
    const onCancelJob = vi.fn();
    render(
      <ConversationReviewDialog
        view="config"
        scope={scope()}
        selectedModuleIds={["discussion_overview"]}
        presetId="general"
        allowPartial={false}
        job={job()}
        onClose={vi.fn()}
        onScopeChange={vi.fn()}
        onModulesChange={vi.fn()}
        onAllowPartialChange={vi.fn()}
        onGenerate={vi.fn()}
        onCancelJob={onCancelJob}
      />,
    );

    expect(screen.getByText("正在生成总结")).toBeDefined();
    expect(screen.getByRole("progressbar", { name: "总结生成进度" }).getAttribute("value")).toBe("1");
    expect((screen.getByRole("button", { name: "生成中…" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "取消生成" }));
    expect(onCancelJob).toHaveBeenCalledOnce();
  });

  it("edits results, opens evidence, retries, copies, exports, saves a version and creates a branch", async () => {
    const onUpdateModule = vi.fn();
    const onDeleteItem = vi.fn();
    const onLocateEvidence = vi.fn();
    const onRetryModule = vi.fn();
    const onCopyAll = vi.fn();
    const onCopyModule = vi.fn();
    const onExportMarkdown = vi.fn();
    const onSaveToGraph = vi.fn();
    const onCreateBranch = vi.fn();
    const onUndoModuleEdit = vi.fn();
    const onRestoreModule = vi.fn();

    render(
      <ConversationReviewDialog
        view="result"
        scope={scope()}
        selectedModuleIds={["discussion_overview", "suggested_new_branches"]}
        presetId="custom"
        allowPartial={false}
        version={version()}
        hasExistingGraphDocument
        onClose={vi.fn()}
        onScopeChange={vi.fn()}
        onModulesChange={vi.fn()}
        onAllowPartialChange={vi.fn()}
        onGenerate={vi.fn()}
        onUpdateModule={onUpdateModule}
        onDeleteItem={onDeleteItem}
        onLocateEvidence={onLocateEvidence}
        onRetryModule={onRetryModule}
        onUndoModuleEdit={onUndoModuleEdit}
        onRestoreModule={onRestoreModule}
        onCopyAll={onCopyAll}
        onCopyModule={onCopyModule}
        onExportMarkdown={onExportMarkdown}
        onSaveToGraph={onSaveToGraph}
        onCreateBranch={onCreateBranch}
      />,
    );

    const overview = screen.getAllByRole("textbox", { name: "模块概览" })[0]!;
    await userEvent.clear(overview);
    await userEvent.type(overview, "新的概览");
    expect(onUpdateModule).toHaveBeenLastCalledWith(
      "discussion_overview",
      expect.objectContaining({ overview: "新的概览" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "查看依据 (1)" }));
    const drawer = screen.getByRole("region", { name: "原始消息依据" });
    expect(within(drawer).getByText("这是支持该结论的用户原话。")).toBeDefined();
    await userEvent.click(within(drawer).getByRole("button", { name: "定位原消息" }));
    expect(onLocateEvidence).toHaveBeenCalledWith(expect.objectContaining({ id: "evidence-1" }));

    await userEvent.click(screen.getByRole("button", { name: "删除条目：编辑后结论" }));
    expect(onDeleteItem).toHaveBeenCalledWith("discussion_overview", "item-1");

    await userEvent.click(screen.getAllByRole("button", { name: "复制模块" })[0]!);
    await userEvent.click(screen.getAllByRole("button", { name: "重试模块" })[0]!);
    await userEvent.click(screen.getAllByRole("button", { name: "撤销上次编辑" })[0]!);
    await userEvent.click(screen.getAllByRole("button", { name: "恢复模型版本" })[0]!);
    expect(onCopyModule).toHaveBeenCalledWith("discussion_overview");
    expect(onRetryModule).toHaveBeenCalledWith("discussion_overview");
    expect(onUndoModuleEdit).toHaveBeenCalledWith("discussion_overview");
    expect(onRestoreModule).toHaveBeenCalledWith("discussion_overview");

    await userEvent.click(screen.getByRole("button", { name: "复制完整总结" }));
    expect(onCopyAll).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("checkbox", { name: "Markdown 中保留证据引用" }));
    await userEvent.click(screen.getByRole("button", { name: "导出 Markdown" }));
    expect(onExportMarkdown).toHaveBeenCalledWith({ includeEvidence: true });

    await userEvent.click(screen.getByRole("button", { name: "创建新分支" }));
    expect(onCreateBranch).toHaveBeenCalledWith(expect.objectContaining({ id: "branch-1" }));

    await userEvent.click(screen.getByRole("button", { name: "保存到图" }));
    expect(screen.getByRole("dialog", { name: "保存总结到图" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "更新原总结" }));
    expect(onSaveToGraph).toHaveBeenCalledWith("update");

  });

  it("confirms dirty close and can retain the local draft", async () => {
    const onClose = vi.fn();
    const onSaveDraft = vi.fn();
    render(
      <ConversationReviewDialog
        view="result"
        scope={scope()}
        selectedModuleIds={["discussion_overview"]}
        presetId="general"
        allowPartial={false}
        version={version()}
        onClose={onClose}
        onScopeChange={vi.fn()}
        onModulesChange={vi.fn()}
        onAllowPartialChange={vi.fn()}
        onGenerate={vi.fn()}
        onSaveDraft={onSaveDraft}
      />,
    );

    const title = screen.getByRole("textbox", { name: "总结标题" });
    await userEvent.type(title, "已编辑");
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "保留未保存的总结？" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "保留草稿并关闭" }));
    expect(onSaveDraft).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
