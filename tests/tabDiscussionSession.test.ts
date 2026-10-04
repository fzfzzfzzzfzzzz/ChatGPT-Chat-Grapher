import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiscussionMapDatabase } from "../db/database";
import { DiscussionService } from "../graph/discussionService";
import {
  TabDiscussionSession,
  tabCaptureKey,
  tabProjectKey,
  type SessionStorage,
} from "../graph/tabDiscussionSession";

class MemoryStorage implements SessionStorage {
  readonly values = new Map<string, unknown>();

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys])
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key)]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.values.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key);
  }
}

describe("tab discussion session", () => {
  let database: DiscussionMapDatabase;
  let service: DiscussionService;
  let storage: MemoryStorage;
  let session: TabDiscussionSession;

  beforeEach(() => {
    database = new DiscussionMapDatabase(`tab-discussion-${crypto.randomUUID()}`);
    service = new DiscussionService(database);
    storage = new MemoryStorage();
    session = new TabDiscussionSession(service.projects, storage);
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it("starts every new tab without a project", async () => {
    const project = await service.createProject("Existing", "Goal");
    storage.values.set("selectedProjectId", project.id);

    expect(await session.getProject(101)).toBeUndefined();
    expect(await session.getProject(102)).toBeUndefined();
  });

  it("allows different tabs to select the same project", async () => {
    const project = await service.createProject("Shared", "Goal");
    await session.setProjectId(101, project.id);
    await session.setProjectId(102, project.id);

    expect((await session.getProject(101))?.id).toBe(project.id);
    expect((await session.getProject(102))?.id).toBe(project.id);
  });

  it("records nodes from different tabs in their shared project", async () => {
    const project = await service.createProject("Shared", "Goal");
    await session.setProjectId(101, project.id);
    await session.setProjectId(102, project.id);

    for (const [index, tabId] of [101, 102].entries()) {
      const selected = await session.getProject(tabId);
      await service.createNode({
        projectId: selected!.id,
        question: `Question ${index}`,
        chatId: `chat-${index}`,
        messageId: `message-${index}`,
      });
    }

    expect((await service.nodes.listForProject(project.id)).map((node) => node.chatId))
      .toEqual(["chat-0", "chat-1"]);
  });

  it("routes nodes from different tabs to their independently selected projects", async () => {
    const first = await service.createProject("First", "Goal");
    const second = await service.createProject("Second", "Goal");
    await session.setProjectId(101, first.id);
    await session.setProjectId(102, second.id);

    const captures = [
      { tabId: 101, chatId: "chat-a", question: "First question" },
      { tabId: 102, chatId: "chat-b", question: "Second question" },
    ] as const;
    for (const [index, capture] of captures.entries()) {
      const project = await session.getProject(capture.tabId);
      await service.createNode({
        projectId: project!.id,
        question: capture.question,
        chatId: capture.chatId,
        messageId: `message-${index}`,
      });
    }

    expect((await service.nodes.listForProject(first.id)).map((node) => node.chatId))
      .toEqual(["chat-a"]);
    expect((await service.nodes.listForProject(second.id)).map((node) => node.chatId))
      .toEqual(["chat-b"]);
  });

  it("keeps capture switches independent and defaults new tabs to enabled", async () => {
    expect(await session.isCaptureEnabled(101)).toBe(true);
    expect(await session.isCaptureEnabled(102)).toBe(true);

    await session.setCaptureEnabled(101, false);

    expect(await session.isCaptureEnabled(101)).toBe(false);
    expect(await session.isCaptureEnabled(102)).toBe(true);
  });

  it("clears all runtime state when a tab closes", async () => {
    const project = await service.createProject("Project", "Goal");
    await session.setProjectId(101, project.id);
    await session.setCaptureEnabled(101, false);

    await session.clear(101);

    expect(storage.values.has(tabProjectKey(101))).toBe(false);
    expect(storage.values.has(tabCaptureKey(101))).toBe(false);
    expect(await session.getProject(101)).toBeUndefined();
    expect(await session.isCaptureEnabled(101)).toBe(true);
  });

  it("drops a tab assignment when the selected project no longer exists", async () => {
    const project = await service.createProject("Removed", "Goal");
    await session.setProjectId(101, project.id);
    await service.deleteProject(project.id);

    expect(await session.getProject(101)).toBeUndefined();
    expect(storage.values.has(tabProjectKey(101))).toBe(false);
  });
});
