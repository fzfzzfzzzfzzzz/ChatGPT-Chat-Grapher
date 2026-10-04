import { afterEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { DiscussionMapDatabase } from "../db/database";
import {
  ConversationReviewService,
  type ConversationReviewAIRequester,
} from "../graph/conversationReviewService";
import type {
  ConversationReviewMessage,
  QuestionNode,
  ReviewCaptureReport,
  ReviewModuleId,
} from "../types/domain";

const databases: DiscussionMapDatabase[] = [];

function createDatabase(): DiscussionMapDatabase {
  const database = new DiscussionMapDatabase(`conversation-review-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("ConversationReviewService", () => {
  it("generates a direct review and only persists allowlisted short evidence", async () => {
    const database = createDatabase();
    const marker = "PRIVATE-TAIL-MUST-NOT-PERSIST";
    const longContent = `${"证据".repeat(150)}${marker}`;
    const { capture, anchor } = await seedOneTurn(database, longContent);
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      const selected = selectedModules(request.user);
      return responseFor(selected, [
        {
          id: "valid",
          text: "有依据的结论",
          status: "已确认",
          isInference: false,
          evidenceSourceIds: ["source-user-1"],
        },
        {
          id: "unknown",
          text: "未知引用会成为推断",
          isInference: false,
          evidenceSourceIds: ["not-in-source"],
        },
      ]);
    });
    const service = new ConversationReviewService(database, { requestAI });

    const started = await service.startReview({
      projectId: "project-1",
      entrySource: "side_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview", "user_goal"],
      presetId: "custom",
      capture,
      allowPartial: false,
      title: "测试总结",
    });
    const completed = await service.waitForJob(started.job.id);

    expect(completed?.status).toBe("completed");
    expect(requestAI).toHaveBeenCalledTimes(1);
    const document = await database.reviewDocuments.get(started.document.id);
    const version = await database.reviewVersions.get(document!.activeVersionId!);
    expect(version?.moduleOrder).toEqual(["discussion_overview", "user_goal"]);
    expect(version?.evidences).toHaveLength(1);
    expect([...version!.evidences[0]!.excerpt]).toHaveLength(240);
    expect(version!.evidences[0]!.excerpt).not.toContain(marker);
    const unknown = version!.modules[0]!.current.items.find(({ id }) => id === "unknown");
    expect(unknown).toMatchObject({ isInference: true, evidenceIds: [] });
    expect(JSON.stringify(await database.reviewJobs.toArray())).not.toContain(longContent);
    expect(JSON.stringify(await database.reviewDocuments.toArray())).not.toContain(longContent);
    expect(JSON.stringify(await database.reviewVersions.toArray())).not.toContain(marker);
    expect(service.activeExecutionCount).toBe(0);
  });

  it("refuses an incomplete source by default and allows an explicit partial review", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    capture.complete = false;
    capture.missingSourceIds = ["source-missing"];
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) =>
      responseFor(selectedModules(request.user))
    );
    const service = new ConversationReviewService(database, { requestAI });
    const strict = await service.startReview({
      projectId: "project-1",
      entrySource: "floating_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    expect((await service.waitForJob(strict.job.id))?.errorCode).toBe("SOURCE_UNAVAILABLE");
    expect(requestAI).not.toHaveBeenCalled();

    const partial = await service.retryReview({
      jobId: strict.job.id,
      capture,
      allowPartial: true,
    });
    expect((await service.waitForJob(partial.job.id))?.status).toBe("partial");
    expect(requestAI).toHaveBeenCalledTimes(1);
  });

  it("deduplicates active work by scope family", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    let finish!: () => void;
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return responseFor(selectedModules(request.user));
    });
    const service = new ConversationReviewService(database, { requestAI });
    const input = {
      projectId: "project-1",
      entrySource: "side_panel" as const,
      scopeType: "current_branch" as const,
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"] as const,
      presetId: "general" as const,
      capture,
      allowPartial: false,
    };
    const first = await service.startReview(input);
    await vi.waitFor(() => expect(requestAI).toHaveBeenCalledTimes(1));
    const second = await service.startReview(input);

    expect(second.reused).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(await database.reviewJobs.count()).toBe(1);
    expect(await database.reviewDocuments.count()).toBe(1);
    finish();
    expect((await service.waitForJob(first.job.id))?.status).toBe("completed");
  });

  it("extracts facts once per chunk and generates modules in batches of at most six", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    const requestedBatchSizes: number[] = [];
    const liveModuleCounts: number[] = [];
    let factCalls = 0;
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      const payload = JSON.parse(request.user) as Record<string, unknown>;
      if ("segmentIndex" in payload) {
        factCalls += 1;
        return {
          content: JSON.stringify({
            facts: [{ text: "一次提取的事实", sourceIds: ["source-user-1"] }],
          }),
          providerId: "openai",
          model: "mock-model",
        };
      }
      const selected = payload.selectedModuleIds as ReviewModuleId[];
      requestedBatchSizes.push(selected.length);
      return responseFor(selected);
    });
    const service = new ConversationReviewService(database, {
      requestAI,
      onProgress: (_job, liveVersion) => {
        if (liveVersion) {
          liveModuleCounts.push(
            liveVersion.modules.filter((module) => module.state === "completed").length,
          );
        }
      },
    });
    const modules: ReviewModuleId[] = [
      "discussion_overview",
      "user_goal",
      "key_takeaways",
      "consensus",
      "user_decisions",
      "unresolved_questions",
      "missed_branches",
      "user_confusions",
      "next_steps",
      "continuation_context",
      "considered_options",
    ];
    const started = await service.startReview({
      projectId: "project-1",
      entrySource: "node_menu",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: modules,
      presetId: "custom",
      capture,
      allowPartial: false,
    });
    const completed = await service.waitForJob(started.job.id);

    expect(completed?.status).toBe("completed");
    expect(factCalls).toBe(1);
    expect(requestedBatchSizes).toEqual([6, 5]);
    expect(liveModuleCounts.some((count) => count === 6)).toBe(true);
    const version = (await database.reviewVersions.toArray())[0]!;
    expect(version.segmented).toBe(true);
    expect(version.segmentCount).toBe(1);
    expect(version.modules).toHaveLength(11);
  });

  it("keeps successful chunk results and records failed source ranges", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedManyTurns(database, 3, "很长的上下文".repeat(1_350));
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      const payload = JSON.parse(request.user) as Record<string, unknown>;
      if ("segmentIndex" in payload) {
        if (payload.segmentIndex === 1) throw new Error("middle chunk unavailable");
        const messages = payload.messages as Array<{ sourceId: string }>;
        return {
          content: JSON.stringify({
            facts: [{ text: "分段事实", sourceIds: [messages[0]!.sourceId] }],
          }),
          providerId: "openai",
          model: "mock-model",
        };
      }
      return responseFor(payload.selectedModuleIds as ReviewModuleId[]);
    });
    const service = new ConversationReviewService(database, { requestAI });
    const started = await service.startReview({
      projectId: "project-1",
      entrySource: "side_panel",
      scopeType: "conversation",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    const completed = await service.waitForJob(started.job.id);
    const version = (await database.reviewVersions.toArray())[0]!;

    expect(completed?.status).toBe("partial");
    expect(version.missingRanges).toHaveLength(1);
    expect(version.modules[0]?.state).toBe("completed");
  });

  it("blocks more than twenty chunks before invoking AI", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedManyTurns(database, 21, "超长消息".repeat(2_000));
    const requestAI = vi.fn<ConversationReviewAIRequester>();
    const service = new ConversationReviewService(database, { requestAI });
    const started = await service.startReview({
      projectId: "project-1",
      entrySource: "side_panel",
      scopeType: "conversation",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    const failed = await service.waitForJob(started.job.id);

    expect(failed).toMatchObject({ status: "failed", errorCode: "SOURCE_TOO_LARGE" });
    expect(requestAI).not.toHaveBeenCalled();
    expect(await database.reviewVersions.count()).toBe(0);
    expect(service.activeExecutionCount).toBe(0);
  });

  it("keeps cancellation terminal when an AI response arrives late", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    let finish!: () => void;
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      // Deliberately ignore AbortSignal to model a late provider response.
      await new Promise<void>((resolve) => { finish = resolve; });
      return responseFor(selectedModules(request.user));
    });
    const service = new ConversationReviewService(database, { requestAI });
    const started = await service.startReview({
      projectId: "project-1",
      entrySource: "floating_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    await vi.waitFor(() => expect(requestAI).toHaveBeenCalledOnce());
    expect((await service.cancelReview(started.job.id))?.status).toBe("cancelled");
    finish();
    const terminal = await service.waitForJob(started.job.id);

    expect(terminal?.status).toBe("cancelled");
    expect(await database.reviewVersions.count()).toBe(0);
    expect(service.activeExecutionCount).toBe(0);
    expect((await service.cancelReview(started.job.id))?.status).toBe("cancelled");
  });

  it("aborts an in-memory execution even after its job row was cascade-deleted", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    let providerAborted = false;
    const requestAI = vi.fn<ConversationReviewAIRequester>((_request, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          providerAborted = true;
          reject(new Error("provider aborted"));
        }, { once: true });
      })
    );
    const service = new ConversationReviewService(database, { requestAI });
    const started = await service.startReview({
      projectId: "project-1",
      entrySource: "side_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    await vi.waitFor(() => expect(requestAI).toHaveBeenCalledOnce());

    await database.reviewJobs.delete(started.job.id);
    await service.cancelReviewsForDocument(started.document.id);

    await vi.waitFor(() => expect(providerAborted).toBe(true));
    await vi.waitFor(() => expect(service.activeExecutionCount).toBe(0));
    expect(await database.reviewVersions.count()).toBe(0);
  });

  it("rolls back an appended version when cancellation races the document update", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    let finish!: () => void;
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return responseFor(selectedModules(request.user));
    });
    const service = new ConversationReviewService(database, { requestAI });
    const started = await service.startReview({
      projectId: "project-1",
      entrySource: "floating_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    await vi.waitFor(() => expect(requestAI).toHaveBeenCalledOnce());

    let cancellation: Promise<unknown> | undefined;
    const cancelDuringDocumentUpdate = () => {
      if (cancellation) return;
      cancellation = Dexie.ignoreTransaction(() => service.cancelReview(started.job.id));
      void cancellation.catch(() => undefined);
    };
    database.reviewDocuments.hook.updating.subscribe(cancelDuringDocumentUpdate);
    finish();
    const terminal = await service.waitForJob(started.job.id);
    await cancellation;
    database.reviewDocuments.hook.updating.unsubscribe(cancelDuringDocumentUpdate);

    expect(terminal?.status).toBe("cancelled");
    expect(await database.reviewVersions.count()).toBe(0);
    expect((await database.reviewDocuments.get(started.document.id))?.activeVersionId).toBeUndefined();
    expect((await database.reviewJobs.get(started.job.id))?.status).toBe("cancelled");
  });

  it("rejects a recollected chat or scope that does not match the original document", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) =>
      responseFor(selectedModules(request.user))
    );
    const service = new ConversationReviewService(database, { requestAI });
    const first = await service.startReview({
      projectId: "project-1",
      entrySource: "side_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    await service.waitForJob(first.job.id);

    const privateMarker = "WRONG-CHAT-SOURCE-MUST-NOT-PERSIST";
    const wrongChat = structuredClone(capture);
    wrongChat.chatId = "chat-2";
    wrongChat.conversationTitle = privateMarker;
    wrongChat.messages.forEach((item) => {
      item.chatId = "chat-2";
      item.locator.chatId = "chat-2";
      item.content = privateMarker;
    });
    await expect(service.retryReview({
      jobId: first.job.id,
      capture: wrongChat,
      allowPartial: false,
    })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });

    await database.nodes.delete(anchor.id);
    await expect(service.retryReview({
      jobId: first.job.id,
      capture,
      allowPartial: false,
    })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });

    expect(await database.reviewJobs.count()).toBe(1);
    expect(await database.reviewVersions.count()).toBe(1);
    expect(requestAI).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await database.reviewJobs.toArray())).not.toContain(privateMarker);
    expect(JSON.stringify(await database.reviewDocuments.toArray())).not.toContain(privateMarker);
    expect(JSON.stringify(await database.reviewVersions.toArray())).not.toContain(privateMarker);
  });

  it("starts only one execution for simultaneous retries of the same document", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    let callCount = 0;
    let finishRetry!: () => void;
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      callCount += 1;
      if (callCount > 1) {
        await new Promise<void>((resolve) => { finishRetry = resolve; });
      }
      return responseFor(selectedModules(request.user));
    });
    const service = new ConversationReviewService(database, { requestAI });
    const first = await service.startReview({
      projectId: "project-1",
      entrySource: "side_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
      capture,
      allowPartial: false,
    });
    await service.waitForJob(first.job.id);

    const [left, right] = await Promise.all([
      service.retryReview({ jobId: first.job.id, capture, allowPartial: false }),
      service.retryReview({ jobId: first.job.id, capture, allowPartial: false }),
    ]);
    await vi.waitFor(() => expect(requestAI).toHaveBeenCalledTimes(2));

    expect(left.job.id).toBe(right.job.id);
    expect([left.reused, right.reused].filter(Boolean)).toHaveLength(1);
    expect(await database.reviewJobs.count()).toBe(2);
    expect(await database.reviewDocuments.count()).toBe(1);
    expect(service.activeExecutionCount).toBe(1);
    finishRetry();
    expect((await service.waitForJob(left.job.id))?.status).toBe("completed");
  });

  it("retries one module into a new immutable version while preserving other modules", async () => {
    const database = createDatabase();
    const { capture, anchor } = await seedOneTurn(database);
    let generation = 0;
    const requestAI = vi.fn<ConversationReviewAIRequester>(async (request) => {
      generation += 1;
      const selected = selectedModules(request.user);
      return responseFor(selected, [{
        id: `generation-${generation}`,
        text: `第 ${generation} 次生成`,
        isInference: false,
        evidenceSourceIds: ["source-user-1"],
      }]);
    });
    const service = new ConversationReviewService(database, { requestAI });
    const first = await service.startReview({
      projectId: "project-1",
      entrySource: "side_panel",
      scopeType: "current_branch",
      anchorNodeId: anchor.id,
      selectedModuleIds: ["discussion_overview", "user_goal"],
      presetId: "custom",
      capture,
      allowPartial: false,
    });
    await service.waitForJob(first.job.id);
    const versionOne = (await database.reviewVersions.toArray())[0]!;
    const retried = await service.retryModule({
      versionId: versionOne.id,
      moduleId: "discussion_overview",
      capture,
      allowPartial: false,
    });
    await service.waitForJob(retried.job.id);
    const versions = await database.reviewVersions.orderBy("version").toArray();

    expect(versions.map(({ version }) => version)).toEqual([1, 2]);
    expect(versions[0]!.modules[0]!.current.items[0]!.text).toBe("第 1 次生成");
    expect(versions[1]!.modules.map(({ moduleId }) => moduleId)).toEqual([
      "discussion_overview",
      "user_goal",
    ]);
    expect(versions[1]!.modules[0]!.current.items[0]!.text).toBe("第 2 次生成");
    expect(versions[1]!.modules[1]!.current.items[0]!.text).toBe("第 1 次生成");
  });
});

async function seedOneTurn(
  database: DiscussionMapDatabase,
  userContent = "请总结这个对话",
): Promise<{ capture: ReviewCaptureReport; anchor: QuestionNode }> {
  await seedProject(database);
  const anchor = node(1, null);
  await database.nodes.add(anchor);
  const messages: ConversationReviewMessage[] = [
    message("source-user-1", "user", 0, "message-1", "turn-1", userContent, anchor.id),
    message("source-assistant-1", "assistant", 1, "assistant-1", "turn-1", "好的。"),
  ];
  return {
    anchor,
    capture: {
      chatId: "chat-1",
      conversationTitle: "测试对话",
      messages,
      complete: true,
      missingSourceIds: [],
    },
  };
}

async function seedManyTurns(
  database: DiscussionMapDatabase,
  count: number,
  content: string,
): Promise<{ capture: ReviewCaptureReport; anchor: QuestionNode }> {
  await seedProject(database);
  const nodes: QuestionNode[] = [];
  const messages: ConversationReviewMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    const current = node(index + 1, index ? `node-${index}` : null);
    nodes.push(current);
    messages.push(message(
      `source-user-${index + 1}`,
      "user",
      index * 2,
      `message-${index + 1}`,
      `turn-${index + 1}`,
      content,
      current.id,
    ));
    messages.push(message(
      `source-assistant-${index + 1}`,
      "assistant",
      index * 2 + 1,
      `assistant-${index + 1}`,
      `turn-${index + 1}`,
      "答复",
    ));
  }
  await database.nodes.bulkAdd(nodes);
  return {
    anchor: nodes[nodes.length - 1]!,
    capture: {
      chatId: "chat-1",
      messages,
      complete: true,
      missingSourceIds: [],
    },
  };
}

async function seedProject(database: DiscussionMapDatabase): Promise<void> {
  await database.projects.add({
    id: "project-1",
    title: "测试项目",
    goal: "测试总结",
    createdAt: 1,
    updatedAt: 1,
  });
}

function node(index: number, parentId: string | null): QuestionNode {
  return {
    id: `node-${index}`,
    projectId: "project-1",
    parentId,
    kind: "captured",
    question: `问题 ${index}`,
    summary: `摘要 ${index}`,
    status: "pending",
    chatId: "chat-1",
    messageId: `message-${index}`,
    messageLocator: {
      version: 1,
      messageId: `message-${index}`,
      turnId: `turn-${index}`,
      ordinal: (index - 1) * 2,
      fingerprint: `fingerprint-${index}`,
    },
    createdAt: index,
    updatedAt: index,
  };
}

function message(
  sourceId: string,
  role: "user" | "assistant",
  ordinal: number,
  messageId: string,
  turnId: string,
  content: string,
  nodeId?: string,
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
      messageId,
      turnId,
      ordinal,
      fingerprint: role === "user" ? `fingerprint-${ordinal / 2 + 1}` : `assistant-${ordinal}`,
    },
    ...(nodeId ? { nodeId } : {}),
  };
}

function selectedModules(userPrompt: string): ReviewModuleId[] {
  const payload = JSON.parse(userPrompt) as { selectedModuleIds?: ReviewModuleId[] };
  return payload.selectedModuleIds ?? [];
}

function responseFor(
  moduleIds: readonly ReviewModuleId[],
  items: Array<Record<string, unknown>> = [{
    id: "item-1",
    text: "总结结果",
    isInference: false,
    evidenceSourceIds: ["source-user-1"],
  }],
) {
  return {
    content: JSON.stringify({
      modules: moduleIds.map((moduleId) => ({
        moduleId,
        overview: `${moduleId} 概览`,
        items,
      })),
    }),
    providerId: "openai" as const,
    model: "mock-model",
  };
}
