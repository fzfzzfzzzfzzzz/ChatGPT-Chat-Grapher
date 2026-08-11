import type {
  NodeEvent,
  Project,
  QuestionCandidate,
  QuestionNode,
} from "../types/domain";
import { createId } from "../utils/id";
import type { DiscussionMapDatabase } from "./database";

export const CHAT_GRAPH_BACKUP_FORMAT = "chat-graph-backup";
export const CHAT_GRAPH_BACKUP_SCHEMA_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024;

export type DiscussionBackup = {
  format: typeof CHAT_GRAPH_BACKUP_FORMAT;
  schemaVersion: typeof CHAT_GRAPH_BACKUP_SCHEMA_VERSION;
  extensionVersion: string;
  exportedAt: string;
  data: {
    projects: Project[];
    nodes: QuestionNode[];
    candidates: QuestionCandidate[];
    nodeEvents: NodeEvent[];
  };
};

export type BackupSummary = {
  projectCount: number;
  nodeCount: number;
  candidateCount: number;
};

export type BackupImportResult = BackupSummary & {
  eventCount: number;
  importedProjectIds: string[];
};

export class BackupValidationError extends Error {
  override name = "BackupValidationError";
}

export async function createDiscussionBackup(
  database: DiscussionMapDatabase,
  extensionVersion: string,
): Promise<DiscussionBackup> {
  const [projects, nodes, candidates, nodeEvents] = await database.transaction(
    "r",
    [database.projects, database.nodes, database.candidates, database.nodeEvents],
    () => Promise.all([
      database.projects.toArray(),
      database.nodes.toArray(),
      database.candidates.toArray(),
      database.nodeEvents.toArray(),
    ]),
  );

  return {
    format: CHAT_GRAPH_BACKUP_FORMAT,
    schemaVersion: CHAT_GRAPH_BACKUP_SCHEMA_VERSION,
    extensionVersion: extensionVersion.trim() || "unknown",
    exportedAt: new Date().toISOString(),
    data: {
      projects: sortByCreatedAt(projects),
      nodes: sortByCreatedAt(nodes),
      candidates: sortByCreatedAt(candidates),
      nodeEvents: sortByCreatedAt(nodeEvents),
    },
  };
}

export function stringifyDiscussionBackup(backup: DiscussionBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function parseDiscussionBackupJson(text: string): DiscussionBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupValidationError("无法读取该文件，请选择有效的 Chat Graph JSON 备份。");
  }
  return parseDiscussionBackup(value);
}

export function parseDiscussionBackup(value: unknown): DiscussionBackup {
  const root = expectRecord(value, "备份");
  if (root.format !== CHAT_GRAPH_BACKUP_FORMAT) {
    throw new BackupValidationError("这不是 Chat Graph 备份文件。");
  }
  if (root.schemaVersion !== CHAT_GRAPH_BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError(`不支持该备份版本：${String(root.schemaVersion)}。`);
  }

  const exportedAt = expectString(root.exportedAt, "exportedAt");
  if (Number.isNaN(Date.parse(exportedAt))) {
    throw new BackupValidationError("备份的 exportedAt 不是有效时间。");
  }
  const data = expectRecord(root.data, "data");
  const backup: DiscussionBackup = {
    format: CHAT_GRAPH_BACKUP_FORMAT,
    schemaVersion: CHAT_GRAPH_BACKUP_SCHEMA_VERSION,
    extensionVersion: expectString(root.extensionVersion, "extensionVersion"),
    exportedAt,
    data: {
      projects: expectArray(data.projects, "data.projects").map(parseProject),
      nodes: expectArray(data.nodes, "data.nodes").map(parseNode),
      candidates: expectArray(data.candidates, "data.candidates").map(parseCandidate),
      nodeEvents: expectArray(data.nodeEvents, "data.nodeEvents").map(parseNodeEvent),
    },
  };
  validateBackupRelationships(backup);
  return backup;
}

export async function importDiscussionBackup(
  database: DiscussionMapDatabase,
  value: unknown,
): Promise<BackupImportResult> {
  const backup = parseDiscussionBackup(value);
  if (!backup.data.projects.length) {
    throw new BackupValidationError("备份中没有可导入的项目。");
  }

  const projectIds = new Map(backup.data.projects.map((project) => [project.id, createId("project")]));
  const nodeIds = new Map(backup.data.nodes.map((node) => [node.id, createId("node")]));
  const candidateIds = new Map(
    backup.data.candidates.map((candidate) => [candidate.id, createId("candidate")]),
  );
  const eventIds = new Map(backup.data.nodeEvents.map((event) => [event.id, createId("event")]));
  const sourceNodes = new Map(backup.data.nodes.map((node) => [node.id, node]));

  const importedProjectIds = backup.data.projects.map((project) => projectIds.get(project.id)!);

  await database.transaction(
    "rw",
    [database.projects, database.nodes, database.candidates, database.nodeEvents],
    async () => {
      const usedTitles = new Set((await database.projects.toArray()).map((project) => project.title));
      const projects = backup.data.projects.map((project): Project => {
        const mappedFocusId = project.focusNodeId
          ? nodeIds.get(project.focusNodeId)
          : undefined;
        return {
          id: projectIds.get(project.id)!,
          title: uniqueImportedTitle(project.title, usedTitles),
          goal: project.goal,
          ...(mappedFocusId ? { focusNodeId: mappedFocusId } : {}),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
      });
      const nodes = backup.data.nodes.map((node): QuestionNode => ({
        ...node,
        id: nodeIds.get(node.id)!,
        projectId: projectIds.get(node.projectId)!,
        parentId: node.parentId ? nodeIds.get(node.parentId)! : null,
      }));
      const candidates = backup.data.candidates.map((candidate): QuestionCandidate => ({
        ...candidate,
        id: candidateIds.get(candidate.id)!,
        projectId: projectIds.get(candidate.projectId)!,
        recommendations: candidate.recommendations.flatMap((recommendation) => {
          if (sourceNodes.get(recommendation.nodeId)?.projectId !== candidate.projectId) return [];
          const nodeId = nodeIds.get(recommendation.nodeId);
          return nodeId ? [{ ...recommendation, nodeId }] : [];
        }),
      }));
      const nodeEvents = backup.data.nodeEvents.map((event): NodeEvent => ({
        ...event,
        id: eventIds.get(event.id)!,
        projectId: projectIds.get(event.projectId)!,
        nodeId: nodeIds.get(event.nodeId)!,
        beforeParentId: event.beforeParentId && sourceNodes.get(event.beforeParentId)?.projectId === event.projectId
          ? nodeIds.get(event.beforeParentId) ?? null
          : null,
        afterParentId: event.afterParentId && sourceNodes.get(event.afterParentId)?.projectId === event.projectId
          ? nodeIds.get(event.afterParentId) ?? null
          : null,
      }));

      await database.projects.bulkAdd(projects);
      if (nodes.length) await database.nodes.bulkAdd(nodes);
      if (candidates.length) await database.candidates.bulkAdd(candidates);
      if (nodeEvents.length) await database.nodeEvents.bulkAdd(nodeEvents);
    },
  );

  return {
    projectCount: backup.data.projects.length,
    nodeCount: backup.data.nodes.length,
    candidateCount: backup.data.candidates.length,
    eventCount: backup.data.nodeEvents.length,
    importedProjectIds,
  };
}

function parseProject(value: unknown, index: number): Project {
  const record = expectRecord(value, `data.projects[${index}]`);
  const project: Project = {
    id: expectId(record.id, `data.projects[${index}].id`),
    title: expectString(record.title, `data.projects[${index}].title`),
    goal: expectString(record.goal, `data.projects[${index}].goal`),
    createdAt: expectTimestamp(record.createdAt, `data.projects[${index}].createdAt`),
    updatedAt: expectTimestamp(record.updatedAt, `data.projects[${index}].updatedAt`),
  };
  const focusNodeId = optionalId(record.focusNodeId, `data.projects[${index}].focusNodeId`);
  if (focusNodeId) project.focusNodeId = focusNodeId;
  return project;
}

function parseNode(value: unknown, index: number): QuestionNode {
  const path = `data.nodes[${index}]`;
  const record = expectRecord(value, path);
  const status = record.status;
  if (status !== "pending" && status !== "resolved") {
    throw new BackupValidationError(`${path}.status 无效。`);
  }
  const node: QuestionNode = {
    id: expectId(record.id, `${path}.id`),
    projectId: expectId(record.projectId, `${path}.projectId`),
    parentId: nullableId(record.parentId, `${path}.parentId`),
    question: expectString(record.question, `${path}.question`),
    summary: expectString(record.summary, `${path}.summary`),
    status,
    chatId: expectId(record.chatId, `${path}.chatId`),
    messageId: expectId(record.messageId, `${path}.messageId`),
    createdAt: expectTimestamp(record.createdAt, `${path}.createdAt`),
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
  };
  const messageAnchor = optionalString(record.messageAnchor, `${path}.messageAnchor`);
  if (messageAnchor) node.messageAnchor = messageAnchor;
  if (record.messageLocator !== undefined) {
    node.messageLocator = parseMessageLocator(record.messageLocator, `${path}.messageLocator`);
  }
  return node;
}

function parseCandidate(value: unknown, index: number): QuestionCandidate {
  const path = `data.candidates[${index}]`;
  const record = expectRecord(value, path);
  const status = record.status;
  if (status !== "processing" && status !== "inbox" && status !== "failed") {
    throw new BackupValidationError(`${path}.status 无效。`);
  }
  const candidate: QuestionCandidate = {
    id: expectId(record.id, `${path}.id`),
    projectId: expectId(record.projectId, `${path}.projectId`),
    question: expectString(record.question, `${path}.question`),
    summary: expectString(record.summary, `${path}.summary`),
    chatId: expectId(record.chatId, `${path}.chatId`),
    messageId: expectId(record.messageId, `${path}.messageId`),
    recommendations: expectArray(record.recommendations, `${path}.recommendations`).map(
      (recommendation, recommendationIndex) => {
        const recommendationPath = `${path}.recommendations[${recommendationIndex}]`;
        const item = expectRecord(recommendation, recommendationPath);
        return {
          nodeId: expectId(item.nodeId, `${recommendationPath}.nodeId`),
          confidence: expectConfidence(item.confidence, `${recommendationPath}.confidence`),
        };
      },
    ),
    noParentConfidence: expectConfidence(record.noParentConfidence, `${path}.noParentConfidence`),
    status,
    createdAt: expectTimestamp(record.createdAt, `${path}.createdAt`),
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
  };
  const messageAnchor = optionalString(record.messageAnchor, `${path}.messageAnchor`);
  if (messageAnchor) candidate.messageAnchor = messageAnchor;
  if (record.messageLocator !== undefined) {
    candidate.messageLocator = parseMessageLocator(record.messageLocator, `${path}.messageLocator`);
  }
  return candidate;
}

function parseNodeEvent(value: unknown, index: number): NodeEvent {
  const path = `data.nodeEvents[${index}]`;
  const record = expectRecord(value, path);
  const type = record.type;
  const source = record.source;
  if (type !== "AUTO_LINK" && type !== "CHANGE_PARENT") {
    throw new BackupValidationError(`${path}.type 无效。`);
  }
  if (source !== "user" && source !== "ai") {
    throw new BackupValidationError(`${path}.source 无效。`);
  }
  const event: NodeEvent = {
    id: expectId(record.id, `${path}.id`),
    projectId: expectId(record.projectId, `${path}.projectId`),
    nodeId: expectId(record.nodeId, `${path}.nodeId`),
    type,
    beforeParentId: nullableId(record.beforeParentId, `${path}.beforeParentId`),
    afterParentId: nullableId(record.afterParentId, `${path}.afterParentId`),
    source,
    createdAt: expectTimestamp(record.createdAt, `${path}.createdAt`),
  };
  if (record.confidence !== undefined) {
    event.confidence = expectConfidence(record.confidence, `${path}.confidence`);
  }
  if (record.undoneAt !== undefined) {
    event.undoneAt = expectTimestamp(record.undoneAt, `${path}.undoneAt`);
  }
  return event;
}

function parseMessageLocator(value: unknown, path: string): NonNullable<QuestionNode["messageLocator"]> {
  const record = expectRecord(value, path);
  if (record.version !== 1) throw new BackupValidationError(`${path}.version 无效。`);
  const ordinal = record.ordinal;
  if (!Number.isSafeInteger(ordinal) || (ordinal as number) < 0) {
    throw new BackupValidationError(`${path}.ordinal 无效。`);
  }
  const locator: NonNullable<QuestionNode["messageLocator"]> = {
    version: 1,
    ordinal: ordinal as number,
    fingerprint: expectString(record.fingerprint, `${path}.fingerprint`),
  };
  const messageId = optionalString(record.messageId, `${path}.messageId`);
  const turnId = optionalString(record.turnId, `${path}.turnId`);
  if (messageId) locator.messageId = messageId;
  if (turnId) locator.turnId = turnId;
  return locator;
}

function validateBackupRelationships(backup: DiscussionBackup): void {
  assertUniqueIds(backup.data.projects, "项目");
  assertUniqueIds(backup.data.nodes, "节点");
  assertUniqueIds(backup.data.candidates, "待整理问题");
  assertUniqueIds(backup.data.nodeEvents, "事件");

  const projects = new Set(backup.data.projects.map((project) => project.id));
  const nodes = new Map(backup.data.nodes.map((node) => [node.id, node]));

  for (const project of backup.data.projects) {
    if (project.focusNodeId && nodes.get(project.focusNodeId)?.projectId !== project.id) {
      throw new BackupValidationError(`项目 ${project.id} 的当前节点无效。`);
    }
  }
  for (const node of backup.data.nodes) {
    if (!projects.has(node.projectId)) {
      throw new BackupValidationError(`节点 ${node.id} 引用了不存在的项目。`);
    }
    if (node.parentId && nodes.get(node.parentId)?.projectId !== node.projectId) {
      throw new BackupValidationError(`节点 ${node.id} 的父节点无效。`);
    }
  }
  assertAcyclicNodes(backup.data.nodes, nodes);
  assertUniqueMessageKeys(backup.data.nodes, "节点");

  for (const candidate of backup.data.candidates) {
    if (!projects.has(candidate.projectId)) {
      throw new BackupValidationError(`待整理问题 ${candidate.id} 引用了不存在的项目。`);
    }
  }
  assertUniqueMessageKeys(backup.data.candidates, "待整理问题");

  for (const event of backup.data.nodeEvents) {
    if (!projects.has(event.projectId) || nodes.get(event.nodeId)?.projectId !== event.projectId) {
      throw new BackupValidationError(`事件 ${event.id} 引用了不存在的项目或节点。`);
    }
  }
}

function assertAcyclicNodes(nodes: QuestionNode[], nodeById: Map<string, QuestionNode>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (node: QuestionNode): void => {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) throw new BackupValidationError("备份中的问题图存在循环父子关系。");
    visiting.add(node.id);
    if (node.parentId) visit(nodeById.get(node.parentId)!);
    visiting.delete(node.id);
    visited.add(node.id);
  };
  nodes.forEach(visit);
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new BackupValidationError(`${label} ID 重复：${item.id}。`);
    ids.add(item.id);
  }
}

function assertUniqueMessageKeys(
  items: Array<{ projectId: string; chatId: string; messageId: string }>,
  label: string,
): void {
  const keys = new Set<string>();
  for (const item of items) {
    const key = JSON.stringify([item.projectId, item.chatId, item.messageId]);
    if (keys.has(key)) throw new BackupValidationError(`${label}中存在重复的消息定位。`);
    keys.add(key);
  }
}

function uniqueImportedTitle(title: string, usedTitles: Set<string>): string {
  if (!usedTitles.has(title)) {
    usedTitles.add(title);
    return title;
  }
  const base = `${title}（导入）`;
  let candidate = base;
  let suffix = 2;
  while (usedTitles.has(candidate)) candidate = `${base} ${suffix++}`;
  usedTitles.add(candidate);
  return candidate;
}

function sortByCreatedAt<T extends { id: string; createdAt: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackupValidationError(`${path} 格式无效。`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new BackupValidationError(`${path} 必须是数组。`);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BackupValidationError(`${path} 必须是非空文本。`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return expectString(value, path);
}

function expectId(value: unknown, path: string): string {
  const id = expectString(value, path);
  if (id.length > 512) throw new BackupValidationError(`${path} 过长。`);
  return id;
}

function optionalId(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return expectId(value, path);
}

function nullableId(value: unknown, path: string): string | null {
  if (value === null) return null;
  return expectId(value, path);
}

function expectTimestamp(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BackupValidationError(`${path} 必须是有效时间戳。`);
  }
  return value;
}

function expectConfidence(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BackupValidationError(`${path} 必须在 0 到 1 之间。`);
  }
  return value;
}
