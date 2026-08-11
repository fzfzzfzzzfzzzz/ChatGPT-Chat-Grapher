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
      schemaVersion: 1,
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
});

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
