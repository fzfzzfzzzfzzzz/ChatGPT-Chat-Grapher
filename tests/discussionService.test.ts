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
