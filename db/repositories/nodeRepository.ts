import type { DiscussionMapDatabase } from "../database";
import type { QuestionNode } from "../../types/domain";
import { createId } from "../../utils/id";
import { requireText } from "../../utils/text";

export type NewQuestionNode = Omit<QuestionNode, "id" | "createdAt" | "updatedAt">;

export class NodeRepository {
  constructor(private readonly database: DiscussionMapDatabase) {}

  async create(input: NewQuestionNode): Promise<QuestionNode> {
    const now = Date.now();
    const node: QuestionNode = {
      ...input,
      id: createId("node"),
      question: requireText(input.question, "Question"),
      summary: requireText(input.summary, "Summary"),
      createdAt: now,
      updatedAt: now,
    };
    await this.database.nodes.add(node);
    return node;
  }

  get(id: string): Promise<QuestionNode | undefined> {
    return this.database.nodes.get(id);
  }

  findByMessage(
    projectId: string,
    chatId: string,
    messageId: string,
  ): Promise<QuestionNode | undefined> {
    return this.database.nodes
      .where("[projectId+chatId+messageId]")
      .equals([projectId, chatId, messageId])
      .first();
  }

  findByAnchor(
    projectId: string,
    chatId: string,
    messageAnchor: string,
  ): Promise<QuestionNode | undefined> {
    return this.database.nodes
      .where("[projectId+chatId]")
      .equals([projectId, chatId])
      .filter((node) => node.messageAnchor === messageAnchor)
      .first();
  }

  listForProject(projectId: string): Promise<QuestionNode[]> {
    return this.database.nodes
      .where("projectId")
      .equals(projectId)
      .sortBy("createdAt");
  }

  listChildren(projectId: string, parentId: string | null): Promise<QuestionNode[]> {
    return this.database.nodes
      .where("projectId")
      .equals(projectId)
      .filter((node) => node.parentId === parentId)
      .sortBy("createdAt");
  }

  async update(
    id: string,
    changes: Partial<Omit<QuestionNode, "id" | "projectId" | "question" | "chatId" | "messageId" | "createdAt">>,
  ): Promise<QuestionNode> {
    const updated = await this.database.nodes.update(id, { ...changes, updatedAt: Date.now() });
    if (!updated) throw new Error("Question node not found.");
    return (await this.database.nodes.get(id))!;
  }

  delete(id: string): Promise<void> {
    return this.database.nodes.delete(id);
  }
}
