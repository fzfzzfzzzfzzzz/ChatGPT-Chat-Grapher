import type { DiscussionMapDatabase } from "../database";
import type { QuestionCandidate } from "../../types/domain";
import { createId } from "../../utils/id";

type NewCandidate = Omit<QuestionCandidate, "id" | "createdAt" | "updatedAt">;

export class CandidateRepository {
  constructor(private readonly database: DiscussionMapDatabase) {}

  async create(input: NewCandidate): Promise<QuestionCandidate> {
    const now = Date.now();
    const candidate: QuestionCandidate = {
      ...input,
      id: createId("candidate"),
      createdAt: now,
      updatedAt: now,
    };
    await this.database.candidates.add(candidate);
    return candidate;
  }

  get(id: string): Promise<QuestionCandidate | undefined> {
    return this.database.candidates.get(id);
  }

  findByMessage(
    projectId: string,
    chatId: string,
    messageId: string,
  ): Promise<QuestionCandidate | undefined> {
    return this.database.candidates
      .where("[projectId+chatId+messageId]")
      .equals([projectId, chatId, messageId])
      .first();
  }

  findByAnchor(
    projectId: string,
    chatId: string,
    messageAnchor: string,
  ): Promise<QuestionCandidate | undefined> {
    return this.database.candidates
      .where("[projectId+chatId]")
      .equals([projectId, chatId])
      .filter((candidate) => candidate.messageAnchor === messageAnchor)
      .first();
  }

  listForProject(projectId: string): Promise<QuestionCandidate[]> {
    return this.database.candidates
      .where("projectId")
      .equals(projectId)
      .sortBy("createdAt");
  }

  async update(
    id: string,
    changes: Partial<Omit<QuestionCandidate, "id" | "projectId" | "question" | "chatId" | "messageId" | "createdAt">>,
  ): Promise<QuestionCandidate> {
    const updated = await this.database.candidates.update(id, {
      ...changes,
      updatedAt: Date.now(),
    });
    if (!updated) throw new Error("Question candidate not found.");
    return (await this.database.candidates.get(id))!;
  }

  delete(id: string): Promise<void> {
    return this.database.candidates.delete(id);
  }
}
