import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BackupValidationError,
  createDiscussionBackup,
  importDiscussionBackup,
  parseDiscussionBackup,
  parseDiscussionBackupJson,
  stringifyDiscussionBackup,
} from "../db/backup";
import { DiscussionMapDatabase } from "../db/database";
import { ReviewRepository } from "../db/repositories/reviewRepository";
import { DiscussionService } from "../graph/discussionService";

describe("Chat Graph JSON backup", () => {
  let database: DiscussionMapDatabase;

  beforeEach(() => {
    database = new DiscussionMapDatabase(`backup-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it("exports all graph tables without extension settings or API keys", async () => {
    await seedBackupGraph(database);

    const backup = await createDiscussionBackup(database, "0.9.0");
    const json = stringifyDiscussionBackup(backup);

    expect(backup).toMatchObject({
      format: "chat-graph-backup",
      schemaVersion: 3,
      extensionVersion: "0.9.0",
    });
    expect(backup.data.projects).toHaveLength(1);
    expect(backup.data.nodes).toHaveLength(2);
    expect(backup.data.candidates).toHaveLength(1);
    expect(backup.data.nodeEvents).toHaveLength(1);
    expect(json).not.toContain("apiKey");
    expect(parseDiscussionBackupJson(json)).toEqual(backup);
  });

  it("imports a backup as a separate graph with every internal reference remapped", async () => {
    await seedBackupGraph(database);
    const backup = await createDiscussionBackup(database, "0.9.0");
    const target = new DiscussionMapDatabase(`backup-target-${crypto.randomUUID()}`);

    try {
      await target.projects.add({
        id: "existing-project",
        title: "Research",
        goal: "Existing goal",
        createdAt: 1,
        updatedAt: 1,
      });

      const result = await importDiscussionBackup(target, backup);
      const importedProjectId = result.importedProjectIds[0]!;
      const importedProject = await target.projects.get(importedProjectId);
      const importedNodes = await target.nodes.where("projectId").equals(importedProjectId).sortBy("createdAt");
      const importedCandidate = (await target.candidates.where("projectId").equals(importedProjectId).toArray())[0]!;
      const importedEvent = (await target.nodeEvents.where("projectId").equals(importedProjectId).toArray())[0]!;
      const root = importedNodes.find((node) => node.question === "Root question")!;
      const child = importedNodes.find((node) => node.question === "Child question")!;

      expect(result).toMatchObject({ projectCount: 1, nodeCount: 2, candidateCount: 1, eventCount: 1 });
      expect(importedProject).toMatchObject({ title: "Research（导入）", focusNodeId: child.id });
      expect(importedProjectId).not.toBe("project-source");
      expect(root.id).not.toBe("node-root");
      expect(child.parentId).toBe(root.id);
      expect(child.references).toEqual(backup.data.nodes[1]!.references);
      expect(importedCandidate.recommendations).toEqual([{ nodeId: root.id, confidence: 0.7 }]);
      expect(importedEvent).toMatchObject({
        nodeId: child.id,
        beforeParentId: null,
        afterParentId: root.id,
      });

      const repeated = await importDiscussionBackup(target, backup);
      expect((await target.projects.get(repeated.importedProjectIds[0]!))?.title).toBe("Research（导入） 2");
      expect(await target.nodes.count()).toBe(4);
    } finally {
      target.close();
      await target.delete();
    }
  });

  it("rejects malformed, unsupported, and cyclic backups before writing", async () => {
    await expect(async () => parseDiscussionBackupJson("not json")).rejects.toThrow(
      BackupValidationError,
    );
    expect(() => parseDiscussionBackup({ format: "chat-graph-backup", schemaVersion: 99 })).toThrow(
      "不支持该备份版本",
    );

    await seedBackupGraph(database);
    const backup = await createDiscussionBackup(database, "0.9.0");
    const invalidThumbnail = structuredClone(backup);
    invalidThumbnail.data.nodes[0]!.references = [{
      id: "image-unsafe",
      type: "image",
      alt: "Unsafe image",
      thumbnailDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    }];
    expect(() => parseDiscussionBackup(invalidThumbnail)).toThrow("thumbnailDataUrl");
    backup.data.nodes[0]!.parentId = backup.data.nodes[1]!.id;
    expect(() => parseDiscussionBackup(backup)).toThrow("循环父子关系");

    const target = new DiscussionMapDatabase(`backup-invalid-${crypto.randomUUID()}`);
    try {
      await expect(importDiscussionBackup(target, backup)).rejects.toThrow(BackupValidationError);
      expect(await target.projects.count()).toBe(0);
      expect(await target.nodes.count()).toBe(0);
    } finally {
      target.close();
      await target.delete();
    }
  });

  it("imports schema v1 backups without reference fields", async () => {
    await seedBackupGraph(database);
    const backup = await createDiscussionBackup(database, "0.12.0") as unknown as Record<string, unknown>;
    backup.schemaVersion = 1;
    const data = backup.data as { nodes: Array<Record<string, unknown>> };
    data.nodes.forEach((node) => delete node.references);
    expect(parseDiscussionBackup(backup)).toMatchObject({ schemaVersion: 3 });
  });

  it("round-trips review versions, short evidence, artifacts, and planned branch links", async () => {
    await seedBackupGraph(database);
    await seedBackupReview(database);
    const backup = await createDiscussionBackup(database, "1.0.0");
    const target = new DiscussionMapDatabase(`backup-review-${crypto.randomUUID()}`);
    try {
      const result = await importDiscussionBackup(target, backup);
      const projectId = result.importedProjectIds[0]!;
      const documents = await target.reviewDocuments.where("projectId").equals(projectId).toArray();
      const versions = await target.reviewVersions.where("projectId").equals(projectId).toArray();
      const nodes = await target.nodes.where("projectId").equals(projectId).toArray();
      const document = documents[0]!;
      const version = versions[0]!;
      const planned = nodes.find((node) => node.kind === "planned")!;
      const anchor = nodes.find((node) => node.question === "Child question")!;

      expect(document.id).not.toBe("review-source");
      expect(document.activeVersionId).toBe(version.id);
      expect(document.graphAnchorNodeId).toBe(anchor.id);
      expect(document.scopeFamilyKey).toContain(projectId);
      expect(version.scope.anchorNodeId).toBe(anchor.id);
      expect(version.evidences[0]).toMatchObject({ excerpt: "Short local evidence", nodeId: anchor.id });
      expect(planned.plannedFromReviewId).toBe(document.id);
      expect(version.modules[0]?.current.branchCandidates?.[0]?.sourceNodeId).toBe(anchor.id);
    } finally {
      target.close();
      await target.delete();
    }
  });

  it("imports a review after its source node was deleted and keeps the stable evidence locator", async () => {
    await seedBackupGraph(database);
    await seedBackupReview(database);
    await new DiscussionService(database).deleteNode("node-child");

    const backup = await createDiscussionBackup(database, "1.0.0");
    expect(() => parseDiscussionBackup(backup)).not.toThrow();
    expect(backup.data.reviewDocuments[0]?.graphAnchorNodeId).toBe("node-child");
    expect(backup.data.reviewVersions[0]?.evidences[0]?.nodeId).toBe("node-child");

    const target = new DiscussionMapDatabase(`backup-deleted-source-${crypto.randomUUID()}`);
    try {
      const result = await importDiscussionBackup(target, backup);
      const projectId = result.importedProjectIds[0]!;
      const document = (await target.reviewDocuments.where("projectId").equals(projectId).toArray())[0]!;
      const version = (await target.reviewVersions.where("projectId").equals(projectId).toArray())[0]!;
      const nodes = await target.nodes.where("projectId").equals(projectId).toArray();
      const root = nodes.find((node) => node.question === "Root question")!;
      const planned = nodes.find((node) => node.kind === "planned")!;
      const evidence = version.evidences[0]!;

      expect(document.graphAnchorNodeId).toBeUndefined();
      expect(version.scope).toMatchObject({
        nodeIds: [root.id],
        nodeCount: 1,
        rootNodeId: root.id,
      });
      expect(version.scope.anchorNodeId).toBeUndefined();
      expect(evidence).toMatchObject({
        excerpt: "Short local evidence",
        locator: { messageId: "message-2" },
        branchPath: [root.id],
      });
      expect(evidence.nodeId).toBeUndefined();
      expect(version.modules[0]?.current.branchCandidates?.[0]?.sourceNodeId).toBeUndefined();
      expect(planned).toMatchObject({ parentId: root.id, plannedFromReviewId: document.id });
    } finally {
      target.close();
      await target.delete();
    }
  });

  it("cleans inbound review links before exporting and importing after review deletion", async () => {
    await seedBackupGraph(database);
    await seedBackupReview(database);
    const repository = new ReviewRepository(database);
    const successor = await repository.createDocument({
      projectId: "project-source",
      chatId: "chat-1",
      scopeFamilyKey: "successor-family-key",
      entrySource: "side_panel",
      supersedesDocumentId: "review-source",
    });

    await repository.deleteDocument("review-source");

    expect((await repository.getDocument(successor.id))?.supersedesDocumentId).toBeUndefined();
    expect((await database.nodes.get("node-planned"))?.plannedFromReviewId).toBeUndefined();
    const backup = await createDiscussionBackup(database, "1.0.0");
    expect(() => parseDiscussionBackup(backup)).not.toThrow();

    const target = new DiscussionMapDatabase(`backup-deleted-review-${crypto.randomUUID()}`);
    try {
      const result = await importDiscussionBackup(target, backup);
      const projectId = result.importedProjectIds[0]!;
      const documents = await target.reviewDocuments.where("projectId").equals(projectId).toArray();
      const planned = (await target.nodes.where("projectId").equals(projectId).toArray())
        .find((node) => node.kind === "planned")!;

      expect(result).toMatchObject({ reviewDocumentCount: 1, reviewVersionCount: 0 });
      expect(documents).toHaveLength(1);
      expect(documents[0]?.supersedesDocumentId).toBeUndefined();
      expect(planned.plannedFromReviewId).toBeUndefined();
    } finally {
      target.close();
      await target.delete();
    }
  });
});

async function seedBackupReview(database: DiscussionMapDatabase): Promise<void> {
  const scope = {
    type: "node_context" as const,
    chatId: "chat-1",
    anchorNodeId: "node-child",
    rootNodeId: "node-root",
    nodeIds: ["node-root", "node-child"],
    messageSourceIds: ["source-user-2"],
    messageCount: 1,
    nodeCount: 2,
    includesOtherBranches: false,
    completeness: "complete" as const,
    missingSourceIds: [],
    estimatedTokens: 20,
    sourceSnapshotHash: "source-hash",
  };
  const snapshot = {
    overview: "Review overview",
    items: [{
      id: "item-1",
      text: "Confirmed conclusion",
      status: "confirmed" as const,
      isInference: false,
      evidenceIds: ["evidence-1"],
    }],
    branchCandidates: [{
      id: "branch-1",
      title: "Follow up",
      rationale: "Still unresolved",
      firstQuestion: "What should we do next?",
      sourceNodeId: "node-child",
    }],
  };
  await database.reviewDocuments.add({
    id: "review-source",
    projectId: "project-source",
    chatId: "chat-1",
    scopeFamilyKey: "old-family-key",
    entrySource: "node_menu",
    activeVersionId: "review-version-source",
    graphAnchorNodeId: "node-child",
    savedAt: 25,
    createdAt: 20,
    updatedAt: 25,
  });
  await database.reviewVersions.add({
    id: "review-version-source",
    documentId: "review-source",
    projectId: "project-source",
    version: 1,
    title: "Conversation review",
    scope,
    moduleOrder: ["discussion_overview"],
    modules: [{
      moduleId: "discussion_overview",
      state: "completed",
      generated: structuredClone(snapshot),
      current: snapshot,
      editHistory: [],
    }],
    evidences: [{
      id: "evidence-1",
      sourceId: "source-user-2",
      chatId: "chat-1",
      role: "user",
      excerpt: "Short local evidence",
      ordinal: 1,
      locator: {
        version: 1,
        chatId: "chat-1",
        role: "user",
        messageId: "message-2",
      },
      nodeId: "node-child",
      branchPath: ["node-root", "node-child"],
    }],
    segmented: false,
    segmentCount: 1,
    missingRanges: [],
    generatedAt: 23,
    updatedAt: 24,
  });
  await database.nodes.add({
    id: "node-planned",
    projectId: "project-source",
    parentId: "node-child",
    kind: "planned",
    plannedFromReviewId: "review-source",
    question: "What should we do next?",
    summary: "Still unresolved",
    status: "pending",
    chatId: "chat-1",
    messageId: "planned-message-1",
    createdAt: 26,
    updatedAt: 26,
  });
}

async function seedBackupGraph(database: DiscussionMapDatabase): Promise<void> {
  await database.projects.add({
    id: "project-source",
    title: "Research",
    goal: "Keep the discussion structured",
    focusNodeId: "node-child",
    createdAt: 10,
    updatedAt: 20,
  });
  await database.nodes.bulkAdd([
    {
      id: "node-root",
      projectId: "project-source",
      parentId: null,
      question: "Root question",
      summary: "Root summary",
      status: "pending",
      chatId: "chat-1",
      messageId: "message-1",
      createdAt: 11,
      updatedAt: 11,
    },
    {
      id: "node-child",
      projectId: "project-source",
      parentId: "node-root",
      question: "Child question",
      summary: "Child summary",
      status: "resolved",
      chatId: "chat-1",
      messageId: "message-2",
      messageAnchor: "anchor-2",
      messageLocator: { version: 1, ordinal: 1, fingerprint: "fingerprint-2" },
      references: [{
        id: "file-1",
        type: "file",
        name: "requirements.pdf",
        sourceLocator: {
          version: 1,
          chatId: "chat-1",
          role: "user",
          messageId: "message-2",
        },
      }],
      createdAt: 12,
      updatedAt: 12,
    },
  ]);
  await database.candidates.add({
    id: "candidate-source",
    projectId: "project-source",
    question: "Candidate question",
    summary: "Candidate summary",
    chatId: "chat-1",
    messageId: "message-3",
    recommendations: [{ nodeId: "node-root", confidence: 0.7 }],
    noParentConfidence: 0.2,
    status: "inbox",
    createdAt: 13,
    updatedAt: 13,
  });
  await database.nodeEvents.add({
    id: "event-source",
    projectId: "project-source",
    nodeId: "node-child",
    type: "AUTO_LINK",
    beforeParentId: null,
    afterParentId: "node-root",
    source: "ai",
    confidence: 0.9,
    createdAt: 14,
  });
}
