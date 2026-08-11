import Dexie, { type EntityTable } from "dexie";
import type {
  NodeEvent,
  Project,
  QuestionCandidate,
  QuestionNode,
} from "../types/domain";

type LegacyBranch = {
  id: string;
  projectId: string;
  parentId?: string;
  title: string;
  description?: string;
  summary?: string;
  status: QuestionNode["status"];
  createdAt: number;
  updatedAt: number;
};

type LegacyBranchChat = { branchId: string; chatId: string; relation?: string };
type LegacyChat = { id: string; conversationId?: string; conversationUrl: string };

export class DiscussionMapDatabase extends Dexie {
  projects!: EntityTable<Project, "id">;
  nodes!: EntityTable<QuestionNode, "id">;
  candidates!: EntityTable<QuestionCandidate, "id">;
  nodeEvents!: EntityTable<NodeEvent, "id">;

  constructor(name = "chatgpt-discussion-map") {
    super(name);

    this.version(1).stores({
      projects: "id, updatedAt",
      branches:
        "id, projectId, parentId, status, [projectId+status], [projectId+parentId], order, updatedAt",
      chats: "id, &conversationUrl, lastVisitedAt",
      branchChats: "id, branchId, chatId, &[branchId+chatId]",
    });

    this.version(2).stores({
      projects: "id, updatedAt",
      branches:
        "id, projectId, parentId, status, [projectId+status], [projectId+parentId], order, updatedAt",
      chats: "id, &conversationUrl, lastVisitedAt",
      branchChats: "id, branchId, chatId, &[branchId+chatId]",
      decisions: "id, projectId, branchId, updatedAt",
      openQuestions: "id, projectId, branchId, status, [projectId+status], priority, updatedAt",
      graphEvents: "id, projectId, branchId, type, source, createdAt, undoneAt",
    });

    this.version(3).stores({
      projects: "id, updatedAt",
      branches:
        "id, projectId, parentId, status, [projectId+status], [projectId+parentId], order, updatedAt",
      chats: "id, projectId, &conversationUrl, conversationId, lastVisitedAt",
      branchChats: "id, branchId, chatId, relation, &[branchId+chatId], createdAt",
      decisions: "id, projectId, branchId, updatedAt",
      openQuestions: "id, projectId, branchId, status, [projectId+status], priority, updatedAt",
      graphEvents: "id, projectId, branchId, type, source, createdAt, undoneAt",
    });

    this.version(4).stores({
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

    this.version(5)
      .stores({
        projects: "id, updatedAt",
        branches:
          "id, projectId, parentId, status, [projectId+status], [projectId+parentId], order, updatedAt",
        chats: "id, projectId, &conversationUrl, conversationId, lastVisitedAt",
        branchChats: "id, branchId, chatId, relation, &[branchId+chatId], createdAt",
        decisions: "id, projectId, branchId, updatedAt",
        openQuestions: "id, projectId, branchId, status, [projectId+status], priority, updatedAt",
        graphEvents: "id, projectId, branchId, type, source, createdAt, undoneAt",
        syncQueue: "id, entityType, entityId, syncStatus, localUpdatedAt",
        nodes:
          "id, projectId, parentId, status, [projectId+status], &[chatId+messageId], chatId, createdAt, updatedAt",
        candidates:
          "id, projectId, status, &[chatId+messageId], chatId, createdAt, updatedAt",
        nodeEvents: "id, projectId, nodeId, type, source, createdAt, undoneAt",
      })
      .upgrade(async (transaction) => {
        const branches = (await transaction.table("branches").toArray()) as LegacyBranch[];
        if (!branches.length) return;
        const links = (await transaction.table("branchChats").toArray()) as LegacyBranchChat[];
        const chats = (await transaction.table("chats").toArray()) as LegacyChat[];
        const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
        const primaryChatByBranch = new Map<string, LegacyChat>();
        for (const link of links) {
          const chat = chatsById.get(link.chatId);
          if (chat && (!primaryChatByBranch.has(link.branchId) || link.relation === "primary")) {
            primaryChatByBranch.set(link.branchId, chat);
          }
        }

        const nodes: QuestionNode[] = branches.map((branch) => {
          const chat = primaryChatByBranch.get(branch.id);
          const chatId =
            chat?.conversationId ??
            chat?.conversationUrl.match(/\/c\/([^/?#]+)/)?.[1] ??
            `legacy-${branch.id}`;
          return {
            id: branch.id,
            projectId: branch.projectId,
            parentId: branch.parentId ?? null,
            question: branch.title,
            summary: branch.summary?.trim() || branch.description?.trim() || branch.title,
            status: branch.status,
            chatId,
            messageId: `legacy-${branch.id}`,
            createdAt: branch.createdAt,
            updatedAt: branch.updatedAt,
          };
        });
        await transaction.table("nodes").bulkPut(nodes);

        const projects = (await transaction.table("projects").toArray()) as Project[];
        for (const project of projects) {
          const active = nodes.find(
            (node) => node.projectId === project.id && node.status === "active",
          );
          if (active) {
            await transaction.table("projects").update(project.id, {
              focusNodeId: active.id,
            });
          }
        }
      });

    this.version(6).stores({
      projects: "id, updatedAt",
      nodes:
        "id, projectId, parentId, status, [projectId+status], &[chatId+messageId], chatId, createdAt, updatedAt",
      candidates: "id, projectId, status, &[chatId+messageId], chatId, createdAt, updatedAt",
      nodeEvents: "id, projectId, nodeId, type, source, createdAt, undoneAt",
      branches: null,
      chats: null,
      branchChats: null,
      decisions: null,
      openQuestions: null,
      graphEvents: null,
      syncQueue: null,
    });

  }
}

export const db = new DiscussionMapDatabase();
