import type { DiscussionMapDatabase } from "../database";
import type { NodeEvent } from "../../types/domain";
import { createId } from "../../utils/id";

export class NodeEventRepository {
  constructor(private readonly database: DiscussionMapDatabase) {}

  async create(input: Omit<NodeEvent, "id" | "createdAt">): Promise<NodeEvent> {
    const event: NodeEvent = { ...input, id: createId("event"), createdAt: Date.now() };
    await this.database.nodeEvents.add(event);
    return event;
  }

  async latestUndoableAutoLink(projectId: string): Promise<NodeEvent | undefined> {
    const events = await this.database.nodeEvents
      .where("projectId")
      .equals(projectId)
      .filter((event) => event.type === "AUTO_LINK" && event.undoneAt === undefined)
      .toArray();
    return events.sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  markUndone(id: string): Promise<number> {
    return this.database.nodeEvents.update(id, { undoneAt: Date.now() });
  }
}
