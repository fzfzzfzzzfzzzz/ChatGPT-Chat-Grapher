import type { DiscussionMapDatabase } from "../db/database";
import { CandidateRepository } from "../db/repositories/candidateRepository";
import { NodeEventRepository } from "../db/repositories/nodeEventRepository";
import { NodeRepository } from "../db/repositories/nodeRepository";
import { ProjectRepository } from "../db/repositories/projectRepository";
import type {
  CapturedQuestion,
  NodeStatus,
  ParentRecommendation,
  Project,
  QuestionCandidate,
  QuestionNode,
} from "../types/domain";
import { requireText } from "../utils/text";
import { canBeParentNode } from "./parentEligibility";
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

export class DiscussionService {
  readonly projects: ProjectRepository;
  readonly nodes: NodeRepository;
  readonly candidates: CandidateRepository;
  readonly events: NodeEventRepository;

  constructor(private readonly database: DiscussionMapDatabase) {
    this.projects = new ProjectRepository(database);
    this.nodes = new NodeRepository(database);
    this.candidates = new CandidateRepository(database);
    this.events = new NodeEventRepository(database);
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
      ],
      async () => {
        await this.database.nodes.where("projectId").equals(projectId).delete();
        await this.database.candidates.where("projectId").equals(projectId).delete();
        await this.database.nodeEvents.where("projectId").equals(projectId).delete();
        await this.database.projects.delete(projectId);
      },
    );
  }

  async createCandidate(
    projectId: string,
    captured: CapturedQuestion,
  ): Promise<QuestionCandidate | QuestionNode> {
    const existingNode = await this.nodes.findByMessage(
      projectId,
      captured.chatId,
      captured.messageId,
    );
    if (existingNode) return existingNode;
    if (captured.messageAnchor) {
      const existingNodeByAnchor = await this.nodes.findByAnchor(
        projectId,
        captured.chatId,
        captured.messageAnchor,
      );
      if (existingNodeByAnchor) return existingNodeByAnchor;
    }
    const existingCandidate = await this.candidates.findByMessage(
      projectId,
      captured.chatId,
      captured.messageId,
    );
    if (existingCandidate) return existingCandidate;
    if (captured.messageAnchor) {
      const existingCandidateByAnchor = await this.candidates.findByAnchor(
        projectId,
        captured.chatId,
        captured.messageAnchor,
      );
      if (existingCandidateByAnchor) return existingCandidateByAnchor;
    }

    return this.candidates.create({
      projectId,
      question: requireText(captured.question, "Question"),
      summary: fallbackSummary(captured.question),
      chatId: captured.chatId,
      messageId: captured.messageId,
      ...(captured.messageAnchor ? { messageAnchor: captured.messageAnchor } : {}),
      ...(captured.messageLocator ? { messageLocator: captured.messageLocator } : {}),
      recommendations: [],
      noParentConfidence: 0,
      status: "processing",
    });
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
        if (existing) return existing;
        if (input.messageAnchor) {
          const existingByAnchor = await this.nodes.findByAnchor(
            input.projectId,
            input.chatId,
            input.messageAnchor,
          );
          if (existingByAnchor) return existingByAnchor;
        }

        const parentId = input.parentId ?? null;
        if (parentId) {
          const parent = await this.nodes.get(parentId);
          if (!parent || parent.projectId !== input.projectId) {
            throw new Error("Parent question must belong to the same project.");
          }
          if (!canBeParentNode(parent)) {
            throw new Error("A completed question cannot be selected as a parent.");
          }
        }

        const status = input.status ?? "pending";
        const node = await this.nodes.create({
          projectId: input.projectId,
          parentId,
          question: input.question,
          summary: cleanSummary(input.summary ?? fallbackSummary(input.question)),
          status,
          chatId: input.chatId,
          messageId: input.messageId,
          ...(input.messageAnchor ? { messageAnchor: input.messageAnchor } : {}),
          ...(input.messageLocator ? { messageLocator: input.messageLocator } : {}),
        });
        if (parentId) await this.nodes.update(parentId, { status: "resolved" });
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
            skippedCount += 1;
            if (index === capturedQuestions.length - 1) finalNode = existing;
            continue;
          }

          const node = await this.nodes.create({
            projectId,
            parentId: previousCreatedNodeId,
            question,
            summary: fallbackSummary(question),
            status: "pending",
            chatId,
            messageId,
            ...(captured.messageAnchor ? { messageAnchor: captured.messageAnchor } : {}),
            ...(captured.messageLocator ? { messageLocator: captured.messageLocator } : {}),
          });
          createdNodes.push(node);
          previousCreatedNodeId = node.id;
          if (index === capturedQuestions.length - 1) finalNode = node;
        }

        if (!finalNode) throw new Error("The latest question could not be imported.");

        const allNodes = await this.nodes.listForProject(projectId);
        const parentIds = new Set(
          allNodes.flatMap((node) => node.parentId ? [node.parentId] : []),
        );
        for (const node of createdNodes) {
          await this.nodes.update(node.id, {
            status: parentIds.has(node.id) ? "resolved" : "pending",
          });
        }
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
          if (!canBeParentNode(parent)) {
            throw new Error("A completed question cannot be selected as a parent.");
          }
          if (isDescendant(allNodes, parentId, nodeId)) {
            throw new Error("Moving this question would create a cycle.");
          }
        }
        const beforeParentId = node.parentId;
        const updated = await this.nodes.update(nodeId, { parentId });
        if (parentId) await this.nodes.update(parentId, { status: "resolved" });
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
          await this.nodes.update(node.id, { messageLocator });
        }
        for (const candidate of candidates) {
          await this.candidates.update(candidate.id, { messageLocator });
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
        if (node.parentId && children.length) {
          await this.nodes.update(node.parentId, { status: "resolved" });
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
