import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { DiscussionMapDatabase } from "../db/database";
import { DiscussionService } from "../graph/discussionService";
import { getCurrentPath, getOpenBranches } from "../graph/questionTree";

describe("DiscussionService v0.5", () => {
  let database: DiscussionMapDatabase;
  let service: DiscussionService;

  beforeEach(() => {
    database = new DiscussionMapDatabase(`test-${crypto.randomUUID()}`);
    service = new DiscussionService(database);
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  function capture(question: string, index: number, chatId = "chat-1") {
    return {
      question,
      chatId,
      messageId: `message-${index}`,
      messageAnchor: `user:${index}:hash-${index}`,
    };
  }

  it("stores only question, summary and status as node business content", async () => {
    const project = await service.createProject("Project", "Goal");
    const node = await service.createNode({
      projectId: project.id,
      ...capture("浏览器插件如何读取 ChatGPT？", 1),
      summary: "讨论如何稳定捕获 ChatGPT 用户消息。",
    });

    expect(node).toMatchObject({
      question: "浏览器插件如何读取 ChatGPT？",
      summary: "讨论如何稳定捕获 ChatGPT 用户消息。",
      status: "active",
      parentId: null,
    });
    for (const forbidden of ["reason", "resource", "decision", "routes", "answer", "openQuestions"]) {
      expect(node).not.toHaveProperty(forbidden);
    }
  });

  it("deduplicates a captured submission by chat and message identity", async () => {
    const project = await service.createProject("Project", "Goal");
    const first = await service.createCandidate(project.id, capture("Question", 1));
    const duplicate = await service.createCandidate(project.id, capture("Question", 1));
    expect(duplicate.id).toBe(first.id);
    expect(await database.candidates.count()).toBe(1);
  });

  it("deduplicates a provisional capture after a stable id becomes available", async () => {
    const project = await service.createProject("Project", "Goal");
    const provisional = await service.createCandidate(project.id, capture("Question", 1));
    const stable = await service.createCandidate(project.id, {
      ...capture("Question", 1),
      messageId: "stable-message-1",
      messageLocator: {
        version: 1,
        messageId: "stable-message-1",
        ordinal: 1,
        fingerprint: "hash-1",
      },
    });
    expect(stable.id).toBe(provisional.id);
    expect(await database.candidates.count()).toBe(1);
  });

  it("refines locator metadata without changing the dedupe identity", async () => {
    const project = await service.createProject("Project", "Goal");
    const candidate = await service.createCandidate(project.id, capture("Question", 1));
    const refined = await service.refineMessageLocator(
      candidate.chatId,
      candidate.messageAnchor!,
      {
        version: 1,
        messageId: "stable-message-1",
        turnId: "turn-1",
        ordinal: 1,
        fingerprint: "hash-1",
      },
    );
    expect(refined).toBe(true);
    expect((await service.candidates.get(candidate.id))?.messageLocator?.messageId)
      .toBe("stable-message-1");

    const node = await service.promoteCandidate(candidate.id, null, "user");
    expect(node.messageId).toBe("message-1");
    expect(node.messageLocator?.turnId).toBe("turn-1");
  });

  it("refines locator metadata for every project copy of a source message", async () => {
    const firstProject = await service.createProject("First", "Goal");
    const secondProject = await service.createProject("Second", "Goal");
    const first = await service.createNode({ projectId: firstProject.id, ...capture("Shared", 1) });
    const second = await service.createNode({ projectId: secondProject.id, ...capture("Shared", 1) });
    const locator = {
      version: 1 as const,
      messageId: "stable-message-1",
      turnId: "turn-1",
      ordinal: 1,
      fingerprint: "hash-1",
    };

    expect(await service.refineMessageLocator("chat-1", "user:1:hash-1", locator)).toBe(true);
    expect((await service.nodes.get(first.id))?.messageLocator).toEqual(locator);
    expect((await service.nodes.get(second.id))?.messageLocator).toEqual(locator);
  });

  it("promotes candidates into a logical tree and keeps one active question", async () => {
    const project = await service.createProject("Project", "Goal");
    const rootCandidate = await service.createCandidate(project.id, capture("怎么做 Chat Graph？", 1));
    const root = await service.promoteCandidate(rootCandidate.id, null, "user");
    const childCandidate = await service.createCandidate(
      project.id,
      capture("浏览器插件如何读取消息？", 2),
    );
    const child = await service.promoteCandidate(childCandidate.id, root.id, "user");
    const nodes = await service.nodes.listForProject(project.id);

    expect(child.parentId).toBe(root.id);
    expect(nodes.find((node) => node.id === root.id)?.status).toBe("pending");
    expect(nodes.filter((node) => node.status === "active")).toHaveLength(1);
    expect((await service.projects.get(project.id))?.focusNodeId).toBe(child.id);
  });

  it("supports multiple roots instead of forcing unrelated questions together", async () => {
    const project = await service.createProject("Project", "Goal");
    const first = await service.createNode({ projectId: project.id, ...capture("Chat Graph", 1) });
    const unrelated = await service.createNode({
      projectId: project.id,
      ...capture("IBKR 港股手续费是多少？", 2),
      parentId: null,
    });
    const nodes = await service.nodes.listForProject(project.id);
    expect(first.parentId).toBeNull();
    expect(unrelated.parentId).toBeNull();
    expect(nodes.filter((node) => node.parentId === null)).toHaveLength(2);
  });

  it("imports an empty project as a resolved linear history with the latest question active", async () => {
    const project = await service.createProject("Project", "Goal");
    const result = await service.importLinearQuestions(project.id, [
      capture("First", 1),
      capture("Second", 2),
      capture("Latest", 3),
    ]);
    const nodes = await service.nodes.listForProject(project.id);
    const first = nodes.find((node) => node.question === "First")!;
    const second = nodes.find((node) => node.question === "Second")!;
    const latest = nodes.find((node) => node.question === "Latest")!;

    expect(result).toMatchObject({ createdCount: 3, skippedCount: 0 });
    expect(first).toMatchObject({ parentId: null, status: "resolved" });
    expect(second).toMatchObject({ parentId: first.id, status: "resolved" });
    expect(latest).toMatchObject({ parentId: second.id, status: "active" });
    expect((await service.projects.get(project.id))?.focusNodeId).toBe(latest.id);
  });

  it("creates a separate root and links remaining questions across skipped nodes", async () => {
    const project = await service.createProject("Project", "Goal");
    const existing = await service.createNode({ projectId: project.id, ...capture("Existing", 2) });
    const oldActive = await service.createNode({
      projectId: project.id,
      ...capture("Old active", 9),
      parentId: existing.id,
    });

    const result = await service.importLinearQuestions(project.id, [
      capture("First new", 1),
      capture("Existing", 2),
      capture("Latest new", 3),
    ]);
    const nodes = await service.nodes.listForProject(project.id);
    const firstNew = nodes.find((node) => node.question === "First new")!;
    const latestNew = nodes.find((node) => node.question === "Latest new")!;

    expect(result).toMatchObject({ createdCount: 2, skippedCount: 1, activeNodeId: latestNew.id });
    expect(firstNew.parentId).toBeNull();
    expect(firstNew.status).toBe("resolved");
    expect(latestNew.parentId).toBe(firstNew.id);
    expect(latestNew.status).toBe("active");
    expect((await service.nodes.get(existing.id))?.parentId).toBeNull();
    expect((await service.nodes.get(oldActive.id))?.status).toBe("pending");
  });

  it("activates an existing latest question without changing its relation", async () => {
    const project = await service.createProject("Project", "Goal");
    const existingLatest = await service.createNode({
      projectId: project.id,
      ...capture("Existing latest", 2),
    });
    await service.setStatus(existingLatest.id, "resolved");
    const oldActive = await service.createNode({ projectId: project.id, ...capture("Old active", 9) });

    const result = await service.importLinearQuestions(project.id, [
      capture("New history", 1),
      capture("Existing latest", 2),
    ]);

    expect(result).toMatchObject({ createdCount: 1, skippedCount: 1, activeNodeId: existingLatest.id });
    expect(await service.nodes.get(existingLatest.id)).toMatchObject({
      parentId: null,
      status: "active",
    });
    expect((await service.nodes.get(oldActive.id))?.status).toBe("pending");
    const newHistory = (await service.nodes.listForProject(project.id))
      .find((node) => node.question === "New history")!;
    expect(newHistory).toMatchObject({ parentId: null, status: "resolved" });
  });

  it("deduplicates within a project while allowing the same source question in another project", async () => {
    const firstProject = await service.createProject("First", "Goal");
    const secondProject = await service.createProject("Second", "Goal");
    const captured = capture("Shared question", 1);
    const first = await service.createNode({ projectId: firstProject.id, ...captured });
    const firstDuplicate = await service.createNode({ projectId: firstProject.id, ...captured });
    const second = await service.createNode({ projectId: secondProject.id, ...captured });

    expect(firstDuplicate.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    expect(await database.nodes.count()).toBe(2);
  });

  it("consumes a matching candidate in the current project during linear import", async () => {
    const project = await service.createProject("Project", "Goal");
    const candidate = await service.createCandidate(project.id, capture("Inbox question", 1));

    const result = await service.importLinearQuestions(project.id, [capture("Inbox question", 1)]);

    expect(result).toMatchObject({ createdCount: 1, skippedCount: 0 });
    expect(await service.candidates.get(candidate.id)).toBeUndefined();
    expect(await service.nodes.listForProject(project.id)).toHaveLength(1);
  });

  it("rolls back the whole linear import when any question is invalid", async () => {
    const project = await service.createProject("Project", "Goal");
    const candidate = await service.createCandidate(project.id, capture("Inbox question", 1));

    await expect(service.importLinearQuestions(project.id, [
      capture("Inbox question", 1),
      { ...capture("Invalid", 2), question: "   " },
    ])).rejects.toThrow();

    expect(await service.nodes.listForProject(project.id)).toEqual([]);
    expect(await service.candidates.get(candidate.id)).toBeDefined();
  });

  it("deletes a project together with its graph, inbox and relation events", async () => {
    const project = await service.createProject("Disposable", "Goal");
    const retainedProject = await service.createProject("Retained", "Goal");
    const root = await service.createNode({
      projectId: project.id,
      ...capture("Root", 1),
    });
    const linkedCandidate = await service.createCandidate(
      project.id,
      capture("Linked child", 2),
    );
    await service.promoteCandidate(linkedCandidate.id, root.id, "ai", 0.92);
    await service.createCandidate(project.id, capture("Inbox item", 3));

    await service.deleteProject(project.id);

    expect(await service.projects.get(project.id)).toBeUndefined();
    expect(await service.projects.get(retainedProject.id)).toBeDefined();
    expect(await service.nodes.listForProject(project.id)).toEqual([]);
    expect(await service.candidates.listForProject(project.id)).toEqual([]);
    expect(await database.nodeEvents.where("projectId").equals(project.id).count()).toBe(0);
  });

  it("updates Current Path after manual parent correction", async () => {
    const project = await service.createProject("Project", "Goal");
    const root = await service.createNode({ projectId: project.id, ...capture("Root", 1) });
    const wrong = await service.createNode({ projectId: project.id, ...capture("Wrong", 2), parentId: root.id });
    const sibling = await service.createNode({ projectId: project.id, ...capture("Sibling", 3), parentId: root.id });
    const child = await service.createNode({ projectId: project.id, ...capture("Child", 4), parentId: wrong.id });

    await service.changeParent(child.id, sibling.id);
    const nodes = await service.nodes.listForProject(project.id);
    expect(getCurrentPath(nodes, child.id).map((node) => node.question)).toEqual([
      "Root",
      "Sibling",
      "Child",
    ]);
  });

  it("rejects self-parenting and cycles", async () => {
    const project = await service.createProject("Project", "Goal");
    const root = await service.createNode({ projectId: project.id, ...capture("Root", 1) });
    const child = await service.createNode({ projectId: project.id, ...capture("Child", 2), parentId: root.id });
    await expect(service.changeParent(root.id, root.id)).rejects.toThrow("own parent");
    await expect(service.changeParent(root.id, child.id)).rejects.toThrow("cycle");
  });

  it("rejects completed nodes as new parents while retaining their graph relations", async () => {
    const project = await service.createProject("Project", "Goal");
    const completed = await service.createNode({
      projectId: project.id,
      ...capture("Completed", 1),
    });
    const child = await service.createNode({
      projectId: project.id,
      ...capture("Existing child", 2),
      parentId: completed.id,
    });
    const unrelated = await service.createNode({
      projectId: project.id,
      ...capture("Unrelated", 3),
    });
    await service.setStatus(completed.id, "resolved");

    expect((await service.nodes.get(child.id))?.parentId).toBe(completed.id);
    await expect(service.createNode({
      projectId: project.id,
      ...capture("New child", 4),
      parentId: completed.id,
    })).rejects.toThrow("completed question");
    await expect(service.changeParent(unrelated.id, completed.id)).rejects.toThrow(
      "completed question",
    );
  });

  it("changes focus for Parent/Main Thread navigation without changing relations or status", async () => {
    const project = await service.createProject("Project", "Goal");
    const root = await service.createNode({ projectId: project.id, ...capture("Root", 1) });
    const child = await service.createNode({ projectId: project.id, ...capture("Child", 2), parentId: root.id });
    await service.setStatus(root.id, "resolved");
    await service.focusNode(root.id);
    const storedRoot = await service.nodes.get(root.id);
    const storedChild = await service.nodes.get(child.id);
    expect((await service.projects.get(project.id))?.focusNodeId).toBe(root.id);
    expect(storedRoot?.status).toBe("resolved");
    expect(storedChild?.parentId).toBe(root.id);
  });

  it("lists pending and parked sibling/child branches but hides resolved ones", async () => {
    const project = await service.createProject("Project", "Goal");
    const root = await service.createNode({ projectId: project.id, ...capture("Root", 1) });
    const focus = await service.createNode({ projectId: project.id, ...capture("Focus", 2), parentId: root.id });
    const pending = await service.createNode({ projectId: project.id, ...capture("Pending", 3), parentId: root.id, status: "pending" });
    const parked = await service.createNode({ projectId: project.id, ...capture("Parked", 4), parentId: focus.id, status: "parked" });
    await service.createNode({ projectId: project.id, ...capture("Resolved", 5), parentId: root.id, status: "resolved" });
    const nodes = await service.nodes.listForProject(project.id);
    expect(getOpenBranches(nodes, focus.id).map((node) => node.id)).toEqual([pending.id, parked.id]);
  });

  it("undoes the most recent high-confidence automatic parent link", async () => {
    const project = await service.createProject("Project", "Goal");
    const root = await service.createNode({ projectId: project.id, ...capture("Root", 1) });
    const candidate = await service.createCandidate(project.id, capture("Child", 2));
    const child = await service.promoteCandidate(candidate.id, root.id, "ai", 0.94);

    const undone = await service.undoLatestAutoLink(project.id);
    expect(undone?.id).toBe(child.id);
    expect(undone?.parentId).toBeNull();
    expect(await service.undoLatestAutoLink(project.id)).toBeUndefined();
  });

  it("reparents children when a node is deleted", async () => {
    const project = await service.createProject("Project", "Goal");
    const root = await service.createNode({ projectId: project.id, ...capture("Root", 1) });
    const parent = await service.createNode({ projectId: project.id, ...capture("Parent", 2), parentId: root.id });
    const child = await service.createNode({ projectId: project.id, ...capture("Child", 3), parentId: parent.id });
    await service.deleteNode(parent.id);
    expect((await service.nodes.get(child.id))?.parentId).toBe(root.id);
  });

  it("retains nodes, status, parent and focus after IndexedDB reopens", async () => {
    const databaseName = database.name;
    const project = await service.createProject("Persistent", "Goal");
    const root = await service.createNode({ projectId: project.id, ...capture("Root", 1) });
    const child = await service.createNode({ projectId: project.id, ...capture("Child", 2), parentId: root.id });
    await service.setStatus(child.id, "parked");
    database.close();

    database = new DiscussionMapDatabase(databaseName);
    service = new DiscussionService(database);
    const restored = await service.nodes.get(child.id);
    expect(restored?.parentId).toBe(root.id);
    expect(restored?.status).toBe("parked");
    expect((await service.projects.get(project.id))?.focusNodeId).toBe(child.id);
  });

  it("migrates global message uniqueness to project-scoped uniqueness", async () => {
    const legacyName = `legacy-v6-${crypto.randomUUID()}`;
    const legacy = new Dexie(legacyName);
    legacy.version(6).stores({
      projects: "id, updatedAt",
      nodes:
        "id, projectId, parentId, status, [projectId+status], &[chatId+messageId], chatId, createdAt, updatedAt",
      candidates: "id, projectId, status, &[chatId+messageId], chatId, createdAt, updatedAt",
      nodeEvents: "id, projectId, nodeId, type, source, createdAt, undoneAt",
    });
    const now = Date.now();
    await legacy.table("projects").add({
      id: "project-old",
      title: "Old project",
      goal: "Goal",
      createdAt: now,
      updatedAt: now,
    });
    await legacy.table("nodes").add({
      id: "node-old",
      projectId: "project-old",
      parentId: null,
      question: "Shared question",
      summary: "Shared question",
      status: "active",
      chatId: "chat-1",
      messageId: "message-1",
      createdAt: now,
      updatedAt: now,
    });
    legacy.close();

    const migrated = new DiscussionMapDatabase(legacyName);
    const migratedService = new DiscussionService(migrated);
    const secondProject = await migratedService.createProject("Second", "Goal");
    const duplicateAcrossProjects = await migratedService.createNode({
      projectId: secondProject.id,
      ...capture("Shared question", 1),
    });

    expect(await migrated.nodes.get("node-old")).toBeDefined();
    expect(duplicateAcrossProjects.projectId).toBe(secondProject.id);
    expect(await migrated.nodes.count()).toBe(2);
    migrated.close();
    await migrated.delete();
  });

  it("migrates v0.4 Branch data and removes legacy knowledge/sync tables", async () => {
    const legacyName = `legacy-${crypto.randomUUID()}`;
    const legacy = new Dexie(legacyName);
    legacy.version(4).stores({
      projects: "id, updatedAt",
      branches:
        "id, projectId, parentId, status, [projectId+status], [projectId+parentId], order, updatedAt",
      chats: "id, projectId, &conversationUrl, conversationId, lastVisitedAt",
      branchChats: "id, branchId, chatId, relation, &[branchId+chatId], createdAt",
      decisions: "id, projectId, branchId, updatedAt",
      openQuestions: "id, projectId, branchId, status, [projectId+status], priority, updatedAt",
      graphEvents: "id, projectId, branchId, type, source, createdAt, undoneAt",
      syncQueue: "id, entityType, entityId, syncStatus, localUpdatedAt",
    });
    const now = Date.now();
    await legacy.table("projects").add({
      id: "project-old",
      title: "Old project",
      goal: "Old goal",
      createdAt: now,
      updatedAt: now,
    });
    await legacy.table("branches").add({
      id: "branch-old",
      projectId: "project-old",
      title: "Old branch title",
      description: "Old description",
      status: "active",
      order: 0,
      createdAt: now,
      updatedAt: now,
    });
    await legacy.table("chats").add({
      id: "chat-row",
      projectId: "project-old",
      conversationId: "conversation-old",
      conversationUrl: "https://chatgpt.com/c/conversation-old",
      createdAt: now,
      lastVisitedAt: now,
    });
    await legacy.table("branchChats").add({
      id: "link-old",
      branchId: "branch-old",
      chatId: "chat-row",
      relation: "primary",
      createdAt: now,
    });
    legacy.close();

    const migrated = new DiscussionMapDatabase(legacyName);
    const node = await migrated.nodes.get("branch-old");
    expect(node).toMatchObject({
      question: "Old branch title",
      summary: "Old description",
      chatId: "conversation-old",
      parentId: null,
    });
    expect((await migrated.projects.get("project-old"))?.focusNodeId).toBe("branch-old");
    expect(migrated.tables.map((table) => table.name).sort()).toEqual([
      "candidates",
      "nodeEvents",
      "nodes",
      "projects",
    ]);
    migrated.close();
    await migrated.delete();
  });
});
