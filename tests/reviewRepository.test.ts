import { afterEach, describe, expect, it } from "vitest";
import { DiscussionMapDatabase } from "../db/database";
import { ReviewRepository } from "../db/repositories/reviewRepository";
import type { ReviewScope } from "../types/domain";

const databases: DiscussionMapDatabase[] = [];

function createDatabase(): DiscussionMapDatabase {
  const database = new DiscussionMapDatabase(`review-repository-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
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

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

const scope: ReviewScope = {
  type: "current_branch",
  chatId: "chat-1",
  anchorNodeId: "node-1",
  rootNodeId: "node-1",
  nodeIds: ["node-1"],
  messageSourceIds: ["source-1"],
  messageCount: 1,
  nodeCount: 1,
  includesOtherBranches: false,
  completeness: "complete",
  missingSourceIds: [],
  estimatedTokens: 20,
  sourceSnapshotHash: "snapshot-1",
};

describe("ReviewRepository", () => {
  it("does not create review artifacts for a deleted project", async () => {
    const database = createDatabase();
    const repository = new ReviewRepository(database);

    await expect(repository.createDocument({
      projectId: "project-missing",
      chatId: "chat-1",
      scopeFamilyKey: "missing-project-scope",
      entrySource: "side_panel",
    })).rejects.toThrow("Project not found");
    expect(await database.reviewDocuments.count()).toBe(0);
  });

  it("creates a document, immutable numbered versions, and updates the active version", async () => {
    const database = createDatabase();
    await seedProject(database);
    const repository = new ReviewRepository(database);
    const document = await repository.createDocument({
      projectId: "project-1",
      chatId: "chat-1",
      scopeFamilyKey: "project-1:chat-1:current_branch:node-1",
      entrySource: "side_panel",
    });

    const first = await repository.createVersion({
      documentId: document.id,
      projectId: "project-1",
      title: "第一次总结",
      scope,
      moduleOrder: ["discussion_overview"],
      modules: [],
      evidences: [],
      segmented: false,
      segmentCount: 1,
      missingRanges: [],
    });
    const second = await repository.createVersion({
      documentId: document.id,
      projectId: "project-1",
      title: "第二次总结",
      scope,
      moduleOrder: ["discussion_overview"],
      modules: [],
      evidences: [],
      segmented: false,
      segmentCount: 1,
      missingRanges: [],
    });

    expect([first.version, second.version]).toEqual([1, 2]);
    expect((await repository.getDocument(document.id))?.activeVersionId).toBe(second.id);
  });

  it("only updates the editable draft and rejects forged evidence or oversized history", async () => {
    const database = createDatabase();
    await seedProject(database);
    const repository = new ReviewRepository(database);
    const document = await repository.createDocument({
      projectId: "project-1",
      chatId: "chat-1",
      scopeFamilyKey: "scope-secure-edit",
      entrySource: "side_panel",
    });
    const generated = {
      overview: "模型原稿",
      items: [{
        id: "item-1",
        text: "模型结论",
        status: "confirmed" as const,
        isInference: false,
        evidenceIds: ["evidence-1"],
      }],
    };
    const version = await repository.createVersion({
      documentId: document.id,
      projectId: "project-1",
      title: "受保护的总结",
      scope,
      moduleOrder: ["discussion_overview"],
      modules: [{
        moduleId: "discussion_overview",
        state: "completed",
        generated,
        current: generated,
        editHistory: [],
      }],
      evidences: [{
        id: "evidence-1",
        sourceId: "source-1",
        chatId: "chat-1",
        role: "user",
        excerpt: "证据摘录",
        ordinal: 0,
        locator: {
          version: 1,
          chatId: "chat-1",
          role: "user",
          ordinal: 0,
          fingerprint: "fingerprint-1",
        },
      }],
      segmented: false,
      segmentCount: 1,
      missingRanges: [],
    });

    await repository.updateVersion(version.id, {
      modules: [{
        moduleId: "discussion_overview",
        current: {
          overview: "用户编辑稿",
          items: [{
            id: "item-1",
            text: "用户编辑结论",
            status: "user_decision",
            isInference: false,
            isUserEdited: true,
            evidenceIds: ["evidence-1"],
          }],
        },
        editHistory: [generated],
        editedAt: 42,
        generated: { overview: "伪造原稿", items: [] },
        state: "failed",
      } as never],
    });

    const updated = await repository.getVersion(version.id);
    expect(updated?.modules[0]?.generated).toEqual(generated);
    expect(updated?.modules[0]?.state).toBe("completed");
    expect(updated?.modules[0]?.current.overview).toBe("用户编辑稿");

    await expect(repository.updateVersion(version.id, {
      modules: [{
        moduleId: "discussion_overview",
        current: {
          overview: "伪造证据",
          items: [{
            id: "item-1",
            text: "没有对应证据",
            isInference: false,
            evidenceIds: ["evidence-unknown"],
          }],
        },
        editHistory: [],
      }],
    })).rejects.toThrow("module item is invalid");

    await expect(repository.updateVersion(version.id, {
      modules: [{
        moduleId: "discussion_overview",
        current: generated,
        editHistory: Array.from({ length: 21 }, () => generated),
      }],
    })).rejects.toThrow("edit history exceeds its limit");
  });

  it("deduplicates active jobs by project and scope and marks them interrupted", async () => {
    const database = createDatabase();
    await seedProject(database);
    const repository = new ReviewRepository(database);
    const document = await repository.createDocument({
      projectId: "project-1",
      chatId: "chat-1",
      scopeFamilyKey: "scope-1",
      entrySource: "floating_panel",
    });
    const first = await repository.createJob({
      projectId: "project-1",
      documentId: document.id,
      scopeFamilyKey: "scope-1",
      scope,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
    });
    const duplicate = await repository.createJob({
      projectId: "project-1",
      documentId: document.id,
      scopeFamilyKey: "scope-1",
      scope,
      selectedModuleIds: ["user_goal"],
      presetId: "custom",
    });

    expect(duplicate.id).toBe(first.id);
    expect(await repository.markUnfinishedInterrupted()).toBe(1);
    expect((await repository.getJob(first.id))?.status).toBe("interrupted");
  });

  it("deduplicates simultaneous job creation for the same scope family", async () => {
    const database = createDatabase();
    await seedProject(database);
    const repository = new ReviewRepository(database);
    const document = await repository.createDocument({
      projectId: "project-1",
      chatId: "chat-1",
      scopeFamilyKey: "scope-concurrent",
      entrySource: "side_panel",
    });
    const input = {
      projectId: "project-1",
      documentId: document.id,
      scopeFamilyKey: "scope-concurrent",
      scope,
      selectedModuleIds: ["discussion_overview" as const],
      presetId: "general" as const,
    };

    const [first, second] = await Promise.all([
      repository.createJob(input),
      repository.createJob(input),
    ]);

    expect(second.id).toBe(first.id);
    expect(await database.reviewJobs.count()).toBe(1);
  });

  it("deletes versions and jobs and clears inbound links with their review document", async () => {
    const database = createDatabase();
    await seedProject(database);
    const repository = new ReviewRepository(database);
    const document = await repository.createDocument({
      projectId: "project-1",
      chatId: "chat-1",
      scopeFamilyKey: "scope-1",
      entrySource: "node_menu",
    });
    await repository.createVersion({
      documentId: document.id,
      projectId: "project-1",
      title: "总结",
      scope,
      moduleOrder: [],
      modules: [],
      evidences: [],
      segmented: false,
      segmentCount: 1,
      missingRanges: [],
    });
    await repository.createJob({
      projectId: "project-1",
      documentId: document.id,
      scopeFamilyKey: "scope-1",
      scope,
      selectedModuleIds: ["discussion_overview"],
      presetId: "general",
    });
    const successor = await repository.createDocument({
      projectId: "project-1",
      chatId: "chat-1",
      scopeFamilyKey: "scope-2",
      entrySource: "side_panel",
      supersedesDocumentId: document.id,
    });
    await database.nodes.add({
      id: "planned-node-1",
      projectId: "project-1",
      parentId: null,
      kind: "planned",
      plannedFromReviewId: document.id,
      question: "下一步是什么？",
      summary: "来自总结的分支",
      status: "pending",
      chatId: "chat-1",
      messageId: "planned-message-1",
      createdAt: 1,
      updatedAt: 1,
    });

    await repository.deleteDocument(document.id);

    expect(await repository.getDocument(document.id)).toBeUndefined();
    expect(await repository.listVersions(document.id)).toEqual([]);
    expect(await database.reviewJobs.where("documentId").equals(document.id).count()).toBe(0);
    expect((await repository.getDocument(successor.id))?.supersedesDocumentId).toBeUndefined();
    expect((await database.nodes.get("planned-node-1"))?.plannedFromReviewId).toBeUndefined();
  });
});
