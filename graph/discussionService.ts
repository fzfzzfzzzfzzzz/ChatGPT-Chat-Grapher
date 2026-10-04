import type { DiscussionMapDatabase } from "../db/database";
import { CandidateRepository } from "../db/repositories/candidateRepository";
import { NodeEventRepository } from "../db/repositories/nodeEventRepository";
import { NodeRepository } from "../db/repositories/nodeRepository";
import { ProjectRepository } from "../db/repositories/projectRepository";
import { ReviewRepository } from "../db/repositories/reviewRepository";
import type {
  CapturedQuestion,
  NodeStatus,
  ParentRecommendation,
  Project,
  QuestionCandidate,
  QuestionNode,
  ReviewBranchCandidate,
} from "../types/domain";
import { createId } from "../utils/id";
import { requireText } from "../utils/text";
import { sanitizeQuestionReferences } from "../shared/questionReferences";
import { isDescendant } from "./questionTree";

export type CreateNodeInput = CapturedQuestion & {
  projectId: string;
  parentId?: string | null;
  summary?: string;
  status?: NodeStatus;
};

export type UpdateNodeInput = {
  summary?: string;
  status?: NodeStatus;
  parentId?: string | null;
};

export type LinearGraphImportResult = {
  createdCount: number;
  skippedCount: number;
  activeNodeId: string;
};

export type CandidateCaptureResult =
  | { kind: "created_candidate"; candidate: QuestionCandidate }
  | { kind: "existing_candidate"; candidate: QuestionCandidate }
  | { kind: "existing_node"; node: QuestionNode };

export class DiscussionService {
  readonly projects: ProjectRepository;
  readonly nodes: NodeRepository;
  readonly candidates: CandidateRepository;
  readonly events: NodeEventRepository;
  readonly reviews: ReviewRepository;

  constructor(private readonly database: DiscussionMapDatabase) {
    this.projects = new ProjectRepository(database);
    this.nodes = new NodeRepository(database);
    this.candidates = new CandidateRepository(database);
    this.events = new NodeEventRepository(database);
    this.reviews = new ReviewRepository(database);
  }

  createProject(title: string, goal: string): Promise<Project> {
    return this.projects.create(title, goal);
  }

  updateProject(
    id: string,
    input: Partial<Pick<Project, "title" | "goal">>,
  ): Promise<Project> {
    return this.projects.update(id, input);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.database.transaction(
      "rw",
      [
        this.database.projects,
        this.database.nodes,
        this.database.candidates,
        this.database.nodeEvents,
        this.database.reviewDocuments,
        this.database.reviewVersions,
        this.database.reviewJobs,
      ],
      async () => {
        await this.database.nodes.where("projectId").equals(projectId).delete();
        await this.database.candidates.where("projectId").equals(projectId).delete();
        await this.database.nodeEvents.where("projectId").equals(projectId).delete();
        await this.database.reviewVersions.where("projectId").equals(projectId).delete();
        await this.database.reviewJobs.where("projectId").equals(projectId).delete();
        await this.database.reviewDocuments.where("projectId").equals(projectId).delete();
        await this.database.projects.delete(projectId);
      },
    );
  }

  async createCandidate(
    projectId: string,
    captured: CapturedQuestion,
  ): Promise<QuestionCandidate | QuestionNode> {
    const result = await this.findOrCreateCandidate(projectId, captured);
    return result.kind === "existing_node" ? result.node : result.candidate;
  }

  async findOrCreateCandidate(
    projectId: string,
    captured: CapturedQuestion,
  ): Promise<CandidateCaptureResult> {
    const existingNode = await this.nodes.findByMessage(
      projectId,
      captured.chatId,
      captured.messageId,
    );
    if (existingNode) {
      return {
        kind: "existing_node",
        node: await this.enrichNodeReferences(existingNode, captured),
      };
    }
    if (captured.messageAnchor) {
      const existingNodeByAnchor = await this.nodes.findByAnchor(
        projectId,
        captured.chatId,
        captured.messageAnchor,
      );
      if (existingNodeByAnchor) {
        return {
          kind: "existing_node",
          node: await this.enrichNodeReferences(existingNodeByAnchor, captured),
        };
      }
    }
    const planned = (await this.nodes.listForProject(projectId))
      .filter((node) => (
        node.kind === "planned"
        && node.chatId === captured.chatId
        && normalizePlannedQuestion(node.question) === normalizePlannedQuestion(captured.question)
      ))
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (planned) {
      return {
        kind: "existing_node",
        node: await this.nodes.realizePlanned(planned.id, {
          ...captured,
          references: sanitizeQuestionReferences(captured.references),
        }),
      };
    }
    const existingCandidate = await this.candidates.findByMessage(
      projectId,
      captured.chatId,
      captured.messageId,
    );
    if (existingCandidate) {
      return {
        kind: "existing_candidate",
        candidate: await this.enrichCandidateReferences(existingCandidate, captured),
      };
    }
    if (captured.messageAnchor) {
      const existingCandidateByAnchor = await this.candidates.findByAnchor(
        projectId,
        captured.chatId,
        captured.messageAnchor,
      );
      if (existingCandidateByAnchor) {
        return {
          kind: "existing_candidate",
          candidate: await this.enrichCandidateReferences(existingCandidateByAnchor, captured),
        };
      }
    }

    const candidate = await this.candidates.create({
      projectId,
      question: requireText(captured.question, "Question"),
      summary: fallbackSummary(captured.question),
      chatId: captured.chatId,
      messageId: captured.messageId,
      ...(captured.messageAnchor ? { messageAnchor: captured.messageAnchor } : {}),
      ...(captured.messageLocator ? { messageLocator: captured.messageLocator } : {}),
      ...(sanitizeQuestionReferences(captured.references).length
        ? { references: sanitizeQuestionReferences(captured.references) }
        : {}),
      recommendations: [],
      noParentConfidence: 0,
      status: "processing",
    });
    return { kind: "created_candidate", candidate };
  }

  async recordRecommendation(
    candidateId: string,
    recommendation: ParentRecommendation,
  ): Promise<QuestionCandidate> {
    return this.candidates.update(candidateId, {
      summary: cleanSummary(recommendation.summary),
      recommendations: recommendation.candidates.slice(0, 3),
      noParentConfidence: clampConfidence(recommendation.noParentConfidence),
      status: "inbox",
    });
  }

  async sendCandidateToInbox(candidateId: string): Promise<QuestionCandidate> {
    const candidate = await this.candidates.get(candidateId);
    if (!candidate) throw new Error("Question candidate not found.");
    return this.candidates.update(candidateId, { status: "inbox" });
  }

  async markCandidateFailed(candidateId: string): Promise<QuestionCandidate> {
    const candidate = await this.candidates.get(candidateId);
    if (!candidate) throw new Error("Question candidate not found.");
    return this.candidates.update(candidateId, { status: "failed" });
  }

  async promoteCandidate(
    candidateId: string,
    parentId: string | null,
    source: "user" | "ai",
    confidence?: number,
  ): Promise<QuestionNode> {
    return this.database.transaction(
      "rw",
      [
        this.database.projects,
        this.database.nodes,
        this.database.candidates,
        this.database.nodeEvents,
      ],
      async () => {
        const candidate = await this.candidates.get(candidateId);
        if (!candidate) throw new Error("Question candidate not found.");
        const node = await this.createNode({
          projectId: candidate.projectId,
          parentId,
          question: candidate.question,
          summary: candidate.summary,
          chatId: candidate.chatId,
          messageId: candidate.messageId,
          ...(candidate.messageAnchor ? { messageAnchor: candidate.messageAnchor } : {}),
          ...(candidate.messageLocator ? { messageLocator: candidate.messageLocator } : {}),
          ...(candidate.references?.length ? { references: candidate.references } : {}),
        });
        if (source === "ai" && parentId) {
          await this.events.create({
            projectId: candidate.projectId,
            nodeId: node.id,
            type: "AUTO_LINK",
            beforeParentId: null,
            afterParentId: parentId,
            source,
            ...(confidence !== undefined ? { confidence: clampConfidence(confidence) } : {}),
          });
        }
        await this.candidates.delete(candidateId);
        return node;
      },
    );
  }

  async createNode(input: CreateNodeInput): Promise<QuestionNode> {
    return this.database.transaction(
      "rw",
      [this.database.projects, this.database.nodes],
      async () => {
        const project = await this.projects.get(input.projectId);
        if (!project) throw new Error("Project not found.");
        const existing = await this.nodes.findByMessage(
          input.projectId,
          input.chatId,
          input.messageId,
        );
        if (existing) return this.enrichNodeReferences(existing, input);
        if (input.messageAnchor) {
          const existingByAnchor = await this.nodes.findByAnchor(
            input.projectId,
            input.chatId,
            input.messageAnchor,
          );
          if (existingByAnchor) return this.enrichNodeReferences(existingByAnchor, input);
        }

        const parentId = input.parentId ?? null;
        if (parentId) {
          const parent = await this.nodes.get(parentId);
          if (!parent || parent.projectId !== input.projectId) {
            throw new Error("Parent question must belong to the same project.");
          }
        }

        const status = input.status ?? "pending";
        const node = await this.nodes.create({
          projectId: input.projectId,
          parentId,
          kind: "captured",
          question: input.question,
          summary: cleanSummary(input.summary ?? fallbackSummary(input.question)),
          status,
          chatId: input.chatId,
          messageId: input.messageId,
          ...(input.messageAnchor ? { messageAnchor: input.messageAnchor } : {}),
          ...(input.messageLocator ? { messageLocator: input.messageLocator } : {}),
          ...(sanitizeQuestionReferences(input.references).length
            ? { references: sanitizeQuestionReferences(input.references) }
            : {}),
        });
        await this.projects.update(input.projectId, { focusNodeId: node.id });
        return node;
      },
    );
  }

  async createPlannedNode(input: {
    projectId: string;
    chatId: string;
    parentId: string | null;
    reviewId: string;
    candidate: ReviewBranchCandidate;
  }): Promise<QuestionNode> {
    const question = requireText(input.candidate.firstQuestion, "Question");
    const normalizedQuestion = normalizePlannedQuestion(question);
    const chatId = requireText(input.chatId, "Chat");
    const reviewId = requireText(input.reviewId, "Review");
    return this.database.transaction(
      "rw",
      [this.database.projects, this.database.nodes],
      async () => {
        const project = await this.projects.get(input.projectId);
        if (!project) throw new Error("Project not found.");

        // The recommendation action can be delivered more than once (double
        // click, two open extension surfaces, or a retried runtime message).
        // Keep the lookup and insert in the same IndexedDB write transaction so
        // overlapping callers serialize on the nodes store. A realized node
        // retains plannedFromReviewId, so repeating the action after the user
        // sent the question resolves to that captured node as well.
        const existing = (await this.nodes.listForProject(input.projectId))
          .filter((node) => (
            node.chatId === chatId
            && node.plannedFromReviewId === reviewId
            && normalizePlannedQuestion(node.question) === normalizedQuestion
          ))
          .sort(comparePlannedSuggestionMatches)[0];
        if (existing) {
          await this.projects.update(input.projectId, { focusNodeId: existing.id });
          return existing;
        }

        if (input.parentId) {
          const parent = await this.nodes.get(input.parentId);
          if (!parent || parent.projectId !== input.projectId) {
            throw new Error("Parent question must belong to the same project.");
          }
        }
        const node = await this.nodes.create({
          projectId: input.projectId,
          parentId: input.parentId,
          kind: "planned",
          plannedFromReviewId: reviewId,
          question,
          summary: cleanSummary(input.candidate.rationale || input.candidate.title),
          status: "pending",
          chatId,
          messageId: createId("planned-message"),
        });
        await this.projects.update(input.projectId, { focusNodeId: node.id });
        return node;
      },
    );
  }

  async importLinearQuestions(
    projectId: string,
    capturedQuestions: CapturedQuestion[],
  ): Promise<LinearGraphImportResult> {
    if (!capturedQuestions.length) throw new Error("No questions to import.");

    return this.database.transaction(
      "rw",
      [this.database.projects, this.database.nodes, this.database.candidates],
      async () => {
        const project = await this.projects.get(projectId);
        if (!project) throw new Error("Project not found.");

        const createdNodes: QuestionNode[] = [];
        let skippedCount = 0;
        let previousCreatedNodeId: string | null = null;
        let finalNode: QuestionNode | undefined;

        for (const [index, captured] of capturedQuestions.entries()) {
          const question = requireText(captured.question, "Question");
          const chatId = requireText(captured.chatId, "Chat ID");
          const messageId = requireText(captured.messageId, "Message ID");
          const existing = await this.nodes.findByMessage(projectId, chatId, messageId) ??
            (captured.messageAnchor
              ? await this.nodes.findByAnchor(projectId, chatId, captured.messageAnchor)
              : undefined);
          const candidate = await this.candidates.findByMessage(projectId, chatId, messageId) ??
            (captured.messageAnchor
              ? await this.candidates.findByAnchor(projectId, chatId, captured.messageAnchor)
              : undefined);

          if (candidate) await this.candidates.delete(candidate.id);

          if (existing) {
            await this.enrichNodeReferences(existing, captured);
            skippedCount += 1;
            if (index === capturedQuestions.length - 1) finalNode = existing;
            continue;
          }

          const node = await this.nodes.create({
            projectId,
            parentId: previousCreatedNodeId,
            kind: "captured",
            question,
            summary: fallbackSummary(question),
            status: "pending",
            chatId,
            messageId,
            ...(captured.messageAnchor ? { messageAnchor: captured.messageAnchor } : {}),
            ...(captured.messageLocator ? { messageLocator: captured.messageLocator } : {}),
            ...(sanitizeQuestionReferences(captured.references).length
              ? { references: sanitizeQuestionReferences(captured.references) }
              : {}),
          });
          createdNodes.push(node);
          previousCreatedNodeId = node.id;
          if (index === capturedQuestions.length - 1) finalNode = node;
        }

        if (!finalNode) throw new Error("The latest question could not be imported.");

        await this.projects.update(projectId, { focusNodeId: finalNode.id });

        return {
          createdCount: createdNodes.length,
          skippedCount,
          activeNodeId: finalNode.id,
        };
      },
    );
  }

  async updateNode(id: string, input: UpdateNodeInput): Promise<QuestionNode> {
    return this.database.transaction(
      "rw",
      [this.database.projects, this.database.nodes, this.database.nodeEvents],
      async () => {
        const existing = await this.nodes.get(id);
        if (!existing) throw new Error("Question node not found.");
        if (input.parentId !== undefined && input.parentId !== existing.parentId) {
          await this.changeParent(id, input.parentId, "user");
        }
        if (input.status !== undefined && input.status !== existing.status) {
          await this.setStatus(id, input.status);
        }
        if (input.summary !== undefined) {
          await this.nodes.update(id, { summary: cleanSummary(input.summary) });
        }
        return (await this.nodes.get(id))!;
      },
    );
  }

  async changeParent(
    nodeId: string,
    parentId: string | null,
    source: "user" | "ai" = "user",
  ): Promise<QuestionNode> {
    return this.database.transaction(
      "rw",
      [this.database.nodes, this.database.nodeEvents],
      async () => {
        const node = await this.nodes.get(nodeId);
        if (!node) throw new Error("Question node not found.");
        if (parentId === nodeId) throw new Error("A question cannot be its own parent.");
        const allNodes = await this.nodes.listForProject(node.projectId);
        if (parentId) {
          const parent = allNodes.find((candidate) => candidate.id === parentId);
          if (!parent) throw new Error("Parent question must belong to the same project.");
          if (isDescendant(allNodes, parentId, nodeId)) {
            throw new Error("Moving this question would create a cycle.");
          }
        }
        const beforeParentId = node.parentId;
        const updated = await this.nodes.update(nodeId, { parentId });
        await this.events.create({
          projectId: node.projectId,
          nodeId,
          type: source === "ai" ? "AUTO_LINK" : "CHANGE_PARENT",
          beforeParentId,
          afterParentId: parentId,
          source,
        });
        return updated;
      },
    );
  }

  async focusNode(nodeId: string): Promise<QuestionNode> {
    const node = await this.nodes.get(nodeId);
    if (!node) throw new Error("Question node not found.");
    await this.projects.update(node.projectId, { focusNodeId: node.id });
    return node;
  }

  async refineMessageLocator(
    chatId: string,
    messageAnchor: string,
    messageLocator: QuestionNode["messageLocator"],
  ): Promise<boolean> {
    if (!messageLocator) return false;
    return this.database.transaction(
      "rw",
      [this.database.nodes, this.database.candidates],
      async () => {
        const [nodes, candidates] = await Promise.all([
          this.database.nodes
            .where("chatId")
            .equals(chatId)
            .filter((item) => item.messageAnchor === messageAnchor)
            .toArray(),
          this.database.candidates
            .where("chatId")
            .equals(chatId)
            .filter((item) => item.messageAnchor === messageAnchor)
            .toArray(),
        ]);
        for (const node of nodes) {
          await this.nodes.update(node.id, {
            messageLocator,
            ...(node.references?.length
              ? { references: refineUserReferenceLocators(node.references, chatId, messageLocator) }
              : {}),
          });
        }
        for (const candidate of candidates) {
          await this.candidates.update(candidate.id, {
            messageLocator,
            ...(candidate.references?.length
              ? { references: refineUserReferenceLocators(candidate.references, chatId, messageLocator) }
              : {}),
          });
        }
        return nodes.length + candidates.length > 0;
      },
    );
  }

  async setStatus(nodeId: string, status: NodeStatus): Promise<QuestionNode> {
    const node = await this.nodes.get(nodeId);
    if (!node) throw new Error("Question node not found.");
    return this.nodes.update(nodeId, { status });
  }

  async undoLatestAutoLink(projectId: string): Promise<QuestionNode | undefined> {
    return this.database.transaction(
      "rw",
      [this.database.nodes, this.database.nodeEvents],
      async () => {
        const event = await this.events.latestUndoableAutoLink(projectId);
        if (!event) return undefined;
        const node = await this.nodes.get(event.nodeId);
        if (!node) {
          await this.events.markUndone(event.id);
          return undefined;
        }
        if (node.parentId !== event.afterParentId) {
          await this.events.markUndone(event.id);
          return undefined;
        }
        const updated = await this.nodes.update(node.id, { parentId: event.beforeParentId });
        await this.events.markUndone(event.id);
        return updated;
      },
    );
  }

  async deleteNode(nodeId: string): Promise<void> {
    await this.database.transaction(
      "rw",
      [this.database.projects, this.database.nodes, this.database.nodeEvents],
      async () => {
        const node = await this.nodes.get(nodeId);
        if (!node) return;
        const children = await this.nodes.listChildren(node.projectId, node.id);
        for (const child of children) {
          await this.nodes.update(child.id, { parentId: node.parentId });
        }
        await this.database.nodeEvents.where("nodeId").equals(nodeId).delete();
        await this.nodes.delete(nodeId);
        const project = await this.projects.get(node.projectId);
        if (project?.focusNodeId === nodeId) {
          if (node.parentId) await this.projects.update(node.projectId, { focusNodeId: node.parentId });
          else await this.projects.clearFocus(node.projectId);
        }
      },
    );
  }

  private async enrichNodeReferences(
    node: QuestionNode,
    captured: Pick<CapturedQuestion, "references">,
  ): Promise<QuestionNode> {
    const references = mergeQuestionReferences(node.references, captured.references);
    if (references.length === (node.references?.length ?? 0)) return node;
    return this.nodes.update(node.id, { references });
  }

  private async enrichCandidateReferences(
    candidate: QuestionCandidate,
    captured: Pick<CapturedQuestion, "references">,
  ): Promise<QuestionCandidate> {
    const references = mergeQuestionReferences(candidate.references, captured.references);
    if (references.length === (candidate.references?.length ?? 0)) return candidate;
    return this.candidates.update(candidate.id, { references });
  }

  async deleteNodeWithDescendants(nodeId: string): Promise<string[]> {
    return this.database.transaction(
      "rw",
      [this.database.projects, this.database.nodes, this.database.nodeEvents],
      async () => {
        const node = await this.nodes.get(nodeId);
        if (!node) return [];
        const nodes = await this.nodes.listForProject(node.projectId);
        const childIdsByParent = new Map<string, string[]>();
        for (const candidate of nodes) {
          if (!candidate.parentId) continue;
          const children = childIdsByParent.get(candidate.parentId) ?? [];
          children.push(candidate.id);
          childIdsByParent.set(candidate.parentId, children);
        }
        const deletedIds: string[] = [];
        const pendingIds = [node.id];
        while (pendingIds.length) {
          const currentId = pendingIds.pop()!;
          deletedIds.push(currentId);
          pendingIds.push(...(childIdsByParent.get(currentId) ?? []));
        }
        await this.database.nodeEvents.where("nodeId").anyOf(deletedIds).delete();
        await this.database.nodes.bulkDelete(deletedIds);
        const project = await this.projects.get(node.projectId);
        if (project?.focusNodeId && deletedIds.includes(project.focusNodeId)) {
          if (node.parentId) await this.projects.update(node.projectId, { focusNodeId: node.parentId });
          else await this.projects.clearFocus(node.projectId);
        }
        return deletedIds;
      },
    );
  }
}

function mergeQuestionReferences(
  existing: QuestionNode["references"],
  incoming: CapturedQuestion["references"],
) {
  const byId = new Map(
    sanitizeQuestionReferences(existing).map((reference) => [reference.id, reference]),
  );
  for (const reference of sanitizeQuestionReferences(incoming)) byId.set(reference.id, reference);
  return sanitizeQuestionReferences([...byId.values()]);
}

function refineUserReferenceLocators(
  references: NonNullable<QuestionNode["references"]>,
  chatId: string,
  messageLocator: NonNullable<QuestionNode["messageLocator"]>,
) {
  return references.map((reference) => reference.sourceLocator?.role === "user"
    ? {
        ...reference,
        sourceLocator: {
          version: 1 as const,
          chatId,
          role: "user" as const,
          ...(messageLocator.messageId ? { messageId: messageLocator.messageId } : {}),
          ...(messageLocator.turnId ? { turnId: messageLocator.turnId } : {}),
          ordinal: messageLocator.ordinal,
          fingerprint: messageLocator.fingerprint,
        },
      }
    : reference);
}

export function fallbackSummary(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}…`;
}

function cleanSummary(summary: string): string {
  const normalized = requireText(summary, "Summary").replace(/\s+/g, " ").trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}…`;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizePlannedQuestion(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function comparePlannedSuggestionMatches(left: QuestionNode, right: QuestionNode): number {
  // Once a planned node has been bound to a real message, it is the strongest
  // identity for subsequent retries of the same recommendation action.
  const leftCaptured = left.kind === "captured" ? 0 : 1;
  const rightCaptured = right.kind === "captured" ? 0 : 1;
  return leftCaptured - rightCaptured
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id);
}
