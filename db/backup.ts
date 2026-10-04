import type {
  NodeEvent,
  Project,
  QuestionCandidate,
  QuestionNode,
  QuestionReference,
  ReferenceLocator,
  ReviewDocument,
  ReviewEvidence,
  ReviewItem,
  ReviewModuleId,
  ReviewModuleResult,
  ReviewModuleSnapshot,
  ReviewScope,
  ReviewVersion,
} from "../types/domain";
import { isAIProviderId } from "../ai/providers";
import {
  MAX_ASSISTANT_QUOTE_LENGTH,
  MAX_QUESTION_REFERENCES,
  MAX_REFERENCE_NAME_LENGTH,
  isAllowedThumbnailDataUrl,
} from "../shared/questionReferences";
import { createId } from "../utils/id";
import { createScopeFamilyKey } from "../review/scope";
import type { DiscussionMapDatabase } from "./database";

export const CHAT_GRAPH_BACKUP_FORMAT = "chat-graph-backup";
export const CHAT_GRAPH_BACKUP_SCHEMA_VERSION = 3;
export const MAX_BACKUP_FILE_BYTES = 50 * 1024 * 1024;

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
    reviewDocuments: ReviewDocument[];
    reviewVersions: ReviewVersion[];
  };
};

export type BackupSummary = {
  projectCount: number;
  nodeCount: number;
  candidateCount: number;
  reviewDocumentCount: number;
  reviewVersionCount: number;
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
  const [projects, nodes, candidates, nodeEvents, reviewDocuments, reviewVersions] = await database.transaction(
    "r",
    [
      database.projects,
      database.nodes,
      database.candidates,
      database.nodeEvents,
      database.reviewDocuments,
      database.reviewVersions,
    ],
    () => Promise.all([
      database.projects.toArray(),
      database.nodes.toArray(),
      database.candidates.toArray(),
      database.nodeEvents.toArray(),
      database.reviewDocuments.toArray(),
      database.reviewVersions.toArray(),
    ]),
  );

  return {
    format: CHAT_GRAPH_BACKUP_FORMAT,
    schemaVersion: CHAT_GRAPH_BACKUP_SCHEMA_VERSION,
    extensionVersion: extensionVersion.trim() || "unknown",
    exportedAt: new Date().toISOString(),
    data: {
      projects: sortByCreatedAt(projects),
      nodes: sortByCreatedAt(nodes).map((node) => ({ ...node, kind: node.kind ?? "captured" })),
      candidates: sortByCreatedAt(candidates),
      nodeEvents: sortByCreatedAt(nodeEvents),
      reviewDocuments: sortByCreatedAt(reviewDocuments),
      reviewVersions: [...reviewVersions].sort(
        (left, right) => left.generatedAt - right.generatedAt || left.id.localeCompare(right.id),
      ),
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
  if (
    root.schemaVersion !== 1 &&
    root.schemaVersion !== 2 &&
    root.schemaVersion !== CHAT_GRAPH_BACKUP_SCHEMA_VERSION
  ) {
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
      reviewDocuments: root.schemaVersion === 3 && data.reviewDocuments !== undefined
        ? expectArray(data.reviewDocuments, "data.reviewDocuments").map(parseReviewDocument)
        : [],
      reviewVersions: root.schemaVersion === 3 && data.reviewVersions !== undefined
        ? expectArray(data.reviewVersions, "data.reviewVersions").map(parseReviewVersion)
        : [],
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
  const reviewDocumentIds = new Map(
    backup.data.reviewDocuments.map((document) => [document.id, createId("review")]),
  );
  const reviewVersionIds = new Map(
    backup.data.reviewVersions.map((version) => [version.id, createId("review-version")]),
  );
  const sourceNodes = new Map(backup.data.nodes.map((node) => [node.id, node]));

  const importedProjectIds = backup.data.projects.map((project) => projectIds.get(project.id)!);

  await database.transaction(
    "rw",
    [
      database.projects,
      database.nodes,
      database.candidates,
      database.nodeEvents,
      database.reviewDocuments,
      database.reviewVersions,
    ],
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
      const nodes = backup.data.nodes.map((node): QuestionNode => {
        const { plannedFromReviewId, ...source } = node;
        return {
          ...source,
          id: nodeIds.get(node.id)!,
          projectId: projectIds.get(node.projectId)!,
          parentId: node.parentId ? nodeIds.get(node.parentId)! : null,
          ...(plannedFromReviewId && reviewDocumentIds.has(plannedFromReviewId)
            ? { plannedFromReviewId: reviewDocumentIds.get(plannedFromReviewId)! }
            : {}),
        };
      });
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
      const reviewDocuments = backup.data.reviewDocuments.map((document): ReviewDocument => {
        const sourceVersion = backup.data.reviewVersions.find((version) => (
          version.documentId === document.id
          && (version.id === document.activeVersionId || document.activeVersionId === undefined)
        ));
        const mappedScopeAnchor = sourceVersion?.scope.anchorNodeId
          ? nodeIds.get(sourceVersion.scope.anchorNodeId)
          : undefined;
        const mappedProjectId = projectIds.get(document.projectId)!;
        const mapped: ReviewDocument = {
          id: reviewDocumentIds.get(document.id)!,
          projectId: mappedProjectId,
          chatId: document.chatId,
          scopeFamilyKey: sourceVersion
            ? createScopeFamilyKey({
                projectId: mappedProjectId,
                chatId: document.chatId,
                scopeType: sourceVersion.scope.type,
                ...(mappedScopeAnchor ? { anchorNodeId: mappedScopeAnchor } : {}),
              })
            : `imported:${mappedProjectId}:${document.scopeFamilyKey}`,
          entrySource: document.entrySource,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        };
        if (document.activeVersionId && reviewVersionIds.has(document.activeVersionId)) {
          mapped.activeVersionId = reviewVersionIds.get(document.activeVersionId)!;
        }
        if (document.graphAnchorNodeId && nodeIds.has(document.graphAnchorNodeId)) {
          mapped.graphAnchorNodeId = nodeIds.get(document.graphAnchorNodeId)!;
        }
        if (document.supersedesDocumentId && reviewDocumentIds.has(document.supersedesDocumentId)) {
          mapped.supersedesDocumentId = reviewDocumentIds.get(document.supersedesDocumentId)!;
        }
        if (document.savedAt !== undefined) mapped.savedAt = document.savedAt;
        return mapped;
      });
      const reviewVersions = backup.data.reviewVersions.map((version): ReviewVersion => ({
        ...version,
        id: reviewVersionIds.get(version.id)!,
        documentId: reviewDocumentIds.get(version.documentId)!,
        projectId: projectIds.get(version.projectId)!,
        scope: mapImportedReviewScope(version.scope, nodeIds),
        evidences: version.evidences.map((evidence) => mapImportedReviewEvidence(evidence, nodeIds)),
        modules: version.modules.map((module) => mapImportedReviewModule(module, nodeIds)),
      }));

      await database.projects.bulkAdd(projects);
      if (nodes.length) await database.nodes.bulkAdd(nodes);
      if (candidates.length) await database.candidates.bulkAdd(candidates);
      if (nodeEvents.length) await database.nodeEvents.bulkAdd(nodeEvents);
      if (reviewDocuments.length) await database.reviewDocuments.bulkAdd(reviewDocuments);
      if (reviewVersions.length) await database.reviewVersions.bulkAdd(reviewVersions);
    },
  );

  return {
    projectCount: backup.data.projects.length,
    nodeCount: backup.data.nodes.length,
    candidateCount: backup.data.candidates.length,
    reviewDocumentCount: backup.data.reviewDocuments.length,
    reviewVersionCount: backup.data.reviewVersions.length,
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
  if (record.kind !== undefined && record.kind !== "captured" && record.kind !== "planned") {
    throw new BackupValidationError(`${path}.kind 无效。`);
  }
  node.kind = record.kind === "planned" ? "planned" : "captured";
  const plannedFromReviewId = optionalId(
    record.plannedFromReviewId,
    `${path}.plannedFromReviewId`,
  );
  if (plannedFromReviewId) node.plannedFromReviewId = plannedFromReviewId;
  const messageAnchor = optionalString(record.messageAnchor, `${path}.messageAnchor`);
  if (messageAnchor) node.messageAnchor = messageAnchor;
  if (record.messageLocator !== undefined) {
    node.messageLocator = parseMessageLocator(record.messageLocator, `${path}.messageLocator`);
  }
  if (record.references !== undefined) {
    const references = parseQuestionReferences(record.references, `${path}.references`);
    if (references.length) node.references = references;
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
  if (record.references !== undefined) {
    const references = parseQuestionReferences(record.references, `${path}.references`);
    if (references.length) candidate.references = references;
  }
  return candidate;
}

function parseQuestionReferences(value: unknown, path: string): QuestionReference[] {
  const values = expectArray(value, path);
  if (values.length > MAX_QUESTION_REFERENCES) {
    throw new BackupValidationError(`${path} 超过 ${MAX_QUESTION_REFERENCES} 条限制。`);
  }
  const references = values.map((item, index): QuestionReference => {
    const itemPath = `${path}[${index}]`;
    const record = expectRecord(item, itemPath);
    const id = expectId(record.id, `${itemPath}.id`);
    const sourceLocator = record.sourceLocator === undefined
      ? undefined
      : parseReferenceLocator(record.sourceLocator, `${itemPath}.sourceLocator`);
    if (record.type === "file") {
      const name = expectString(record.name, `${itemPath}.name`);
      if (name.length > MAX_REFERENCE_NAME_LENGTH) {
        throw new BackupValidationError(`${itemPath}.name 过长。`);
      }
      const mimeType = optionalString(record.mimeType, `${itemPath}.mimeType`);
      const size = optionalNonNegativeNumber(record.size, `${itemPath}.size`);
      return {
        id,
        type: "file",
        name,
        ...(mimeType ? { mimeType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(sourceLocator ? { sourceLocator } : {}),
      };
    }
    if (record.type === "image") {
      const name = optionalString(record.name, `${itemPath}.name`);
      const alt = optionalString(record.alt, `${itemPath}.alt`);
      if ((name?.length ?? 0) > MAX_REFERENCE_NAME_LENGTH || (alt?.length ?? 0) > MAX_REFERENCE_NAME_LENGTH) {
        throw new BackupValidationError(`${itemPath} 的图片名称或说明过长。`);
      }
      const thumbnailDataUrl = optionalString(
        record.thumbnailDataUrl,
        `${itemPath}.thumbnailDataUrl`,
      );
      if (thumbnailDataUrl && !isAllowedThumbnailDataUrl(thumbnailDataUrl)) {
        throw new BackupValidationError(`${itemPath}.thumbnailDataUrl 无效或过大。`);
      }
      if (!name && !alt && !thumbnailDataUrl) {
        throw new BackupValidationError(`${itemPath} 缺少可显示的图片信息。`);
      }
      return {
        id,
        type: "image",
        ...(name ? { name } : {}),
        ...(alt ? { alt } : {}),
        ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
        ...(sourceLocator ? { sourceLocator } : {}),
      };
    }
    if (record.type === "assistant_quote") {
      const excerpt = expectString(record.excerpt, `${itemPath}.excerpt`);
      if (excerpt.length > MAX_ASSISTANT_QUOTE_LENGTH) {
        throw new BackupValidationError(`${itemPath}.excerpt 过长。`);
      }
      return {
        id,
        type: "assistant_quote",
        excerpt,
        ...(sourceLocator ? { sourceLocator } : {}),
      };
    }
    throw new BackupValidationError(`${itemPath}.type 无效。`);
  });
  const ids = new Set<string>();
  for (const reference of references) {
    if (ids.has(reference.id)) throw new BackupValidationError(`${path} 中存在重复引用 ID。`);
    ids.add(reference.id);
  }
  return references;
}

function parseReferenceLocator(value: unknown, path: string): ReferenceLocator {
  const record = expectRecord(value, path);
  if (record.version !== 1) throw new BackupValidationError(`${path}.version 无效。`);
  if (record.role !== "user" && record.role !== "assistant") {
    throw new BackupValidationError(`${path}.role 无效。`);
  }
  const locator: ReferenceLocator = {
    version: 1,
    chatId: expectId(record.chatId, `${path}.chatId`),
    role: record.role,
  };
  const messageId = optionalId(record.messageId, `${path}.messageId`);
  const turnId = optionalId(record.turnId, `${path}.turnId`);
  const fingerprint = optionalString(record.fingerprint, `${path}.fingerprint`);
  if (messageId) locator.messageId = messageId;
  if (turnId) locator.turnId = turnId;
  if (fingerprint) locator.fingerprint = fingerprint;
  if (record.ordinal !== undefined) {
    if (!Number.isSafeInteger(record.ordinal) || (record.ordinal as number) < 0) {
      throw new BackupValidationError(`${path}.ordinal 无效。`);
    }
    locator.ordinal = record.ordinal as number;
  }
  return locator;
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

const REVIEW_MODULE_IDS = new Set<ReviewModuleId>([
  "discussion_overview",
  "user_goal",
  "key_takeaways",
  "consensus",
  "user_decisions",
  "unresolved_questions",
  "missed_branches",
  "user_confusions",
  "next_steps",
  "continuation_context",
  "considered_options",
  "disagreements",
  "tradeoffs",
  "rejected_or_deferred_options",
  "assumptions_constraints",
  "facts_to_verify",
  "clarified_technical_details",
  "understanding_changes",
  "important_terms",
  "prerequisite_gaps",
  "product_problem",
  "confirmed_scope",
  "solution_architecture",
  "technology_stack",
  "business_technical_flow",
  "data_interfaces_tools_skills",
  "risks_dependencies",
  "progress_release_plan",
  "acceptance_criteria",
  "external_confirmations",
  "deliverables",
  "branch_contribution",
  "suggested_new_branches",
]);

function parseReviewDocument(value: unknown, index: number): ReviewDocument {
  const path = `data.reviewDocuments[${index}]`;
  const record = expectRecord(value, path);
  if (
    record.entrySource !== "floating_panel" &&
    record.entrySource !== "side_panel" &&
    record.entrySource !== "node_menu"
  ) {
    throw new BackupValidationError(`${path}.entrySource 无效。`);
  }
  const document: ReviewDocument = {
    id: expectId(record.id, `${path}.id`),
    projectId: expectId(record.projectId, `${path}.projectId`),
    chatId: expectId(record.chatId, `${path}.chatId`),
    scopeFamilyKey: expectString(record.scopeFamilyKey, `${path}.scopeFamilyKey`),
    entrySource: record.entrySource,
    createdAt: expectTimestamp(record.createdAt, `${path}.createdAt`),
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
  };
  const activeVersionId = optionalId(record.activeVersionId, `${path}.activeVersionId`);
  const graphAnchorNodeId = optionalId(record.graphAnchorNodeId, `${path}.graphAnchorNodeId`);
  const supersedesDocumentId = optionalId(
    record.supersedesDocumentId,
    `${path}.supersedesDocumentId`,
  );
  if (activeVersionId) document.activeVersionId = activeVersionId;
  if (graphAnchorNodeId) document.graphAnchorNodeId = graphAnchorNodeId;
  if (supersedesDocumentId) document.supersedesDocumentId = supersedesDocumentId;
  if (record.savedAt !== undefined) {
    document.savedAt = expectTimestamp(record.savedAt, `${path}.savedAt`);
  }
  return document;
}

function parseReviewVersion(value: unknown, index: number): ReviewVersion {
  const path = `data.reviewVersions[${index}]`;
  const record = expectRecord(value, path);
  const versionNumber = expectPositiveInteger(record.version, `${path}.version`);
  const moduleOrder = expectArray(record.moduleOrder, `${path}.moduleOrder`).map(
    (moduleId, moduleIndex) => parseReviewModuleId(moduleId, `${path}.moduleOrder[${moduleIndex}]`),
  );
  const version: ReviewVersion = {
    id: expectId(record.id, `${path}.id`),
    documentId: expectId(record.documentId, `${path}.documentId`),
    projectId: expectId(record.projectId, `${path}.projectId`),
    version: versionNumber,
    title: expectString(record.title, `${path}.title`),
    scope: parseReviewScope(record.scope, `${path}.scope`),
    moduleOrder,
    modules: expectArray(record.modules, `${path}.modules`).map((module, moduleIndex) =>
      parseReviewModule(module, `${path}.modules[${moduleIndex}]`)
    ),
    evidences: expectArray(record.evidences, `${path}.evidences`).map((evidence, evidenceIndex) =>
      parseReviewEvidence(evidence, `${path}.evidences[${evidenceIndex}]`)
    ),
    segmented: expectBoolean(record.segmented, `${path}.segmented`),
    segmentCount: expectNonNegativeInteger(record.segmentCount, `${path}.segmentCount`),
    missingRanges: expectArray(record.missingRanges, `${path}.missingRanges`).map(
      (item, itemIndex) => expectString(item, `${path}.missingRanges[${itemIndex}]`),
    ),
    generatedAt: expectTimestamp(record.generatedAt, `${path}.generatedAt`),
    updatedAt: expectTimestamp(record.updatedAt, `${path}.updatedAt`),
  };
  if (record.providerId !== undefined) {
    if (!isAIProviderId(record.providerId)) {
      throw new BackupValidationError(`${path}.providerId 无效。`);
    }
    version.providerId = record.providerId;
  }
  const model = optionalString(record.model, `${path}.model`);
  if (model) version.model = model;
  if (record.helpful !== undefined) version.helpful = expectBoolean(record.helpful, `${path}.helpful`);
  if (record.moduleFeedback !== undefined) {
    const feedbackRecord = expectRecord(record.moduleFeedback, `${path}.moduleFeedback`);
    const feedback: ReviewVersion["moduleFeedback"] = {};
    for (const [key, feedbackValue] of Object.entries(feedbackRecord)) {
      const moduleId = parseReviewModuleId(key, `${path}.moduleFeedback.${key}`);
      feedback[moduleId] = expectString(feedbackValue, `${path}.moduleFeedback.${key}`);
    }
    version.moduleFeedback = feedback;
  }
  return version;
}

function parseReviewScope(value: unknown, path: string): ReviewScope {
  const record = expectRecord(value, path);
  if (
    record.type !== "current_branch" &&
    record.type !== "conversation" &&
    record.type !== "node_context"
  ) {
    throw new BackupValidationError(`${path}.type 无效。`);
  }
  if (record.completeness !== "complete" && record.completeness !== "partial") {
    throw new BackupValidationError(`${path}.completeness 无效。`);
  }
  const scope: ReviewScope = {
    type: record.type,
    chatId: expectId(record.chatId, `${path}.chatId`),
    nodeIds: parseIdArray(record.nodeIds, `${path}.nodeIds`),
    messageSourceIds: expectArray(record.messageSourceIds, `${path}.messageSourceIds`).map(
      (sourceId, index) => expectString(sourceId, `${path}.messageSourceIds[${index}]`),
    ),
    messageCount: expectNonNegativeInteger(record.messageCount, `${path}.messageCount`),
    nodeCount: expectNonNegativeInteger(record.nodeCount, `${path}.nodeCount`),
    includesOtherBranches: expectBoolean(
      record.includesOtherBranches,
      `${path}.includesOtherBranches`,
    ),
    completeness: record.completeness,
    missingSourceIds: expectArray(record.missingSourceIds, `${path}.missingSourceIds`).map(
      (sourceId, index) => expectString(sourceId, `${path}.missingSourceIds[${index}]`),
    ),
    estimatedTokens: expectNonNegativeInteger(record.estimatedTokens, `${path}.estimatedTokens`),
    sourceSnapshotHash: expectString(record.sourceSnapshotHash, `${path}.sourceSnapshotHash`),
  };
  const anchorNodeId = optionalId(record.anchorNodeId, `${path}.anchorNodeId`);
  const rootNodeId = optionalId(record.rootNodeId, `${path}.rootNodeId`);
  if (anchorNodeId) scope.anchorNodeId = anchorNodeId;
  if (rootNodeId) scope.rootNodeId = rootNodeId;
  return scope;
}

function parseReviewModule(value: unknown, path: string): ReviewModuleResult {
  const record = expectRecord(value, path);
  if (
    record.state !== "queued" &&
    record.state !== "generating" &&
    record.state !== "completed" &&
    record.state !== "empty" &&
    record.state !== "failed"
  ) {
    throw new BackupValidationError(`${path}.state 无效。`);
  }
  const editHistory = expectArray(record.editHistory, `${path}.editHistory`);
  if (editHistory.length > 20) throw new BackupValidationError(`${path}.editHistory 超过 20 条限制。`);
  const module: ReviewModuleResult = {
    moduleId: parseReviewModuleId(record.moduleId, `${path}.moduleId`),
    state: record.state,
    generated: parseReviewModuleSnapshot(record.generated, `${path}.generated`),
    current: parseReviewModuleSnapshot(record.current, `${path}.current`),
    editHistory: editHistory.map((snapshot, index) =>
      parseReviewModuleSnapshot(snapshot, `${path}.editHistory[${index}]`)
    ),
  };
  if (record.editedAt !== undefined) module.editedAt = expectTimestamp(record.editedAt, `${path}.editedAt`);
  const error = optionalString(record.error, `${path}.error`);
  if (error) module.error = error;
  return module;
}

function parseReviewModuleSnapshot(value: unknown, path: string): ReviewModuleSnapshot {
  const record = expectRecord(value, path);
  const snapshot: ReviewModuleSnapshot = {
    overview: expectText(record.overview, `${path}.overview`),
    items: expectArray(record.items, `${path}.items`).map((item, index) =>
      parseReviewItem(item, `${path}.items[${index}]`)
    ),
  };
  if (record.branchCandidates !== undefined) {
    snapshot.branchCandidates = expectArray(record.branchCandidates, `${path}.branchCandidates`).map(
      (candidate, index) => {
        const candidatePath = `${path}.branchCandidates[${index}]`;
        const candidateRecord = expectRecord(candidate, candidatePath);
        const sourceNodeId = optionalId(candidateRecord.sourceNodeId, `${candidatePath}.sourceNodeId`);
        return {
          id: expectId(candidateRecord.id, `${candidatePath}.id`),
          title: expectString(candidateRecord.title, `${candidatePath}.title`),
          rationale: expectString(candidateRecord.rationale, `${candidatePath}.rationale`),
          firstQuestion: expectString(candidateRecord.firstQuestion, `${candidatePath}.firstQuestion`),
          ...(sourceNodeId ? { sourceNodeId } : {}),
        };
      },
    );
  }
  return snapshot;
}

function parseReviewItem(value: unknown, path: string): ReviewItem {
  const record = expectRecord(value, path);
  const status = record.status;
  if (
    status !== undefined &&
    status !== "confirmed" &&
    status !== "user_decision" &&
    status !== "consensus" &&
    status !== "assistant_suggestion" &&
    status !== "tentative" &&
    status !== "unresolved" &&
    status !== "deferred" &&
    status !== "rejected"
  ) {
    throw new BackupValidationError(`${path}.status 无效。`);
  }
  return {
    id: expectId(record.id, `${path}.id`),
    text: expectString(record.text, `${path}.text`),
    ...(status ? { status } : {}),
    isInference: expectBoolean(record.isInference, `${path}.isInference`),
    ...(record.isUserEdited !== undefined
      ? { isUserEdited: expectBoolean(record.isUserEdited, `${path}.isUserEdited`) }
      : {}),
    evidenceIds: parseIdArray(record.evidenceIds, `${path}.evidenceIds`),
  };
}

function parseReviewEvidence(value: unknown, path: string): ReviewEvidence {
  const record = expectRecord(value, path);
  if (record.role !== "user" && record.role !== "assistant") {
    throw new BackupValidationError(`${path}.role 无效。`);
  }
  const excerpt = expectString(record.excerpt, `${path}.excerpt`);
  if (Array.from(excerpt).length > 240) {
    throw new BackupValidationError(`${path}.excerpt 超过 240 字限制。`);
  }
  const evidence: ReviewEvidence = {
    id: expectId(record.id, `${path}.id`),
    sourceId: expectString(record.sourceId, `${path}.sourceId`),
    chatId: expectId(record.chatId, `${path}.chatId`),
    role: record.role,
    excerpt,
    ordinal: expectNonNegativeInteger(record.ordinal, `${path}.ordinal`),
    locator: parseReferenceLocator(record.locator, `${path}.locator`),
  };
  const nodeId = optionalId(record.nodeId, `${path}.nodeId`);
  if (nodeId) evidence.nodeId = nodeId;
  if (record.branchPath !== undefined) evidence.branchPath = parseIdArray(record.branchPath, `${path}.branchPath`);
  return evidence;
}

function parseReviewModuleId(value: unknown, path: string): ReviewModuleId {
  if (typeof value !== "string" || !REVIEW_MODULE_IDS.has(value as ReviewModuleId)) {
    throw new BackupValidationError(`${path} 无效。`);
  }
  return value as ReviewModuleId;
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

  assertUniqueIds(backup.data.reviewDocuments, "总结");
  assertUniqueIds(backup.data.reviewVersions, "总结版本");
  const documents = new Map(backup.data.reviewDocuments.map((document) => [document.id, document]));
  const versions = new Map(backup.data.reviewVersions.map((version) => [version.id, version]));
  for (const node of backup.data.nodes) {
    if (
      node.plannedFromReviewId
      && documents.get(node.plannedFromReviewId)?.projectId !== node.projectId
    ) {
      throw new BackupValidationError(`计划节点 ${node.id} 的来源总结无效。`);
    }
  }
  for (const document of backup.data.reviewDocuments) {
    if (!projects.has(document.projectId)) {
      throw new BackupValidationError(`总结 ${document.id} 引用了不存在的项目。`);
    }
    if (document.activeVersionId && versions.get(document.activeVersionId)?.documentId !== document.id) {
      throw new BackupValidationError(`总结 ${document.id} 的当前版本无效。`);
    }
    const graphAnchor = document.graphAnchorNodeId
      ? nodes.get(document.graphAnchorNodeId)
      : undefined;
    if (graphAnchor && graphAnchor.projectId !== document.projectId) {
      throw new BackupValidationError(`总结 ${document.id} 的图锚点无效。`);
    }
    if (
      document.supersedesDocumentId &&
      documents.get(document.supersedesDocumentId)?.projectId !== document.projectId
    ) {
      throw new BackupValidationError(`总结 ${document.id} 的前序总结无效。`);
    }
  }
  const versionNumbers = new Set<string>();
  for (const version of backup.data.reviewVersions) {
    if (
      !projects.has(version.projectId) ||
      documents.get(version.documentId)?.projectId !== version.projectId
    ) {
      throw new BackupValidationError(`总结版本 ${version.id} 引用了不存在的总结或项目。`);
    }
    const versionKey = `${version.documentId}:${version.version}`;
    if (versionNumbers.has(versionKey)) {
      throw new BackupValidationError(`总结 ${version.documentId} 存在重复版本号。`);
    }
    versionNumbers.add(versionKey);
    const scopeNodeIds = new Set(version.scope.nodeIds);
    for (const nodeId of scopeNodeIds) {
      const scopeNode = nodes.get(nodeId);
      if (scopeNode && scopeNode.projectId !== version.projectId) {
        throw new BackupValidationError(`总结版本 ${version.id} 的范围节点无效。`);
      }
    }
    for (const nodeId of [version.scope.anchorNodeId, version.scope.rootNodeId]) {
      const scopeAnchor = nodeId ? nodes.get(nodeId) : undefined;
      if (scopeAnchor && scopeAnchor.projectId !== version.projectId) {
        throw new BackupValidationError(`总结版本 ${version.id} 的范围锚点无效。`);
      }
    }
    const evidenceIds = new Set(version.evidences.map((evidence) => evidence.id));
    if (evidenceIds.size !== version.evidences.length) {
      throw new BackupValidationError(`总结版本 ${version.id} 存在重复证据 ID。`);
    }
    const moduleIds = new Set(version.modules.map((module) => module.moduleId));
    if (moduleIds.size !== version.modules.length) {
      throw new BackupValidationError(`总结版本 ${version.id} 存在重复模块。`);
    }
    if (version.moduleOrder.some((moduleId) => !moduleIds.has(moduleId))) {
      throw new BackupValidationError(`总结版本 ${version.id} 的模块目录无效。`);
    }
    for (const evidence of version.evidences) {
      const evidenceNode = evidence.nodeId ? nodes.get(evidence.nodeId) : undefined;
      if (evidenceNode && evidenceNode.projectId !== version.projectId) {
        throw new BackupValidationError(`总结版本 ${version.id} 的证据节点无效。`);
      }
      if (evidence.branchPath?.some((nodeId) => {
        const branchNode = nodes.get(nodeId);
        return branchNode !== undefined && branchNode.projectId !== version.projectId;
      })) {
        throw new BackupValidationError(`总结版本 ${version.id} 的证据路径无效。`);
      }
    }
    for (const module of version.modules) {
      for (const snapshot of [module.generated, module.current, ...module.editHistory]) {
        if (snapshot.items.some((item) => item.evidenceIds.some((id) => !evidenceIds.has(id)))) {
          throw new BackupValidationError(`总结版本 ${version.id} 的模块证据引用无效。`);
        }
        if (snapshot.branchCandidates?.some((candidate) => {
          if (candidate.sourceNodeId === undefined) return false;
          const sourceNode = nodes.get(candidate.sourceNodeId);
          return sourceNode !== undefined && (
            sourceNode.projectId !== version.projectId
            || !scopeNodeIds.has(candidate.sourceNodeId)
          );
        })) {
          throw new BackupValidationError(`总结版本 ${version.id} 的建议分支来源无效。`);
        }
      }
    }
  }
}

function mapImportedReviewScope(
  scope: ReviewScope,
  nodeIds: Map<string, string>,
): ReviewScope {
  const mapped: ReviewScope = {
    ...scope,
    nodeIds: scope.nodeIds.flatMap((id) => nodeIds.get(id) ?? []),
  };
  if (scope.anchorNodeId) {
    const anchorNodeId = nodeIds.get(scope.anchorNodeId);
    if (anchorNodeId) mapped.anchorNodeId = anchorNodeId;
    else delete mapped.anchorNodeId;
  }
  if (scope.rootNodeId) {
    const rootNodeId = nodeIds.get(scope.rootNodeId);
    if (rootNodeId) mapped.rootNodeId = rootNodeId;
    else delete mapped.rootNodeId;
  }
  mapped.nodeCount = mapped.nodeIds.length;
  return mapped;
}

function mapImportedReviewEvidence(
  evidence: ReviewEvidence,
  nodeIds: Map<string, string>,
): ReviewEvidence {
  const mapped: ReviewEvidence = {
    id: evidence.id,
    sourceId: evidence.sourceId,
    chatId: evidence.chatId,
    role: evidence.role,
    excerpt: evidence.excerpt,
    ordinal: evidence.ordinal,
    locator: evidence.locator,
  };
  if (evidence.nodeId && nodeIds.has(evidence.nodeId)) mapped.nodeId = nodeIds.get(evidence.nodeId)!;
  if (evidence.branchPath) mapped.branchPath = evidence.branchPath.flatMap((id) => nodeIds.get(id) ?? []);
  return mapped;
}

function mapImportedReviewModule(
  module: ReviewModuleResult,
  nodeIds: Map<string, string>,
): ReviewModuleResult {
  return {
    ...module,
    generated: mapImportedReviewSnapshot(module.generated, nodeIds),
    current: mapImportedReviewSnapshot(module.current, nodeIds),
    editHistory: module.editHistory.map((snapshot) => mapImportedReviewSnapshot(snapshot, nodeIds)),
  };
}

function mapImportedReviewSnapshot(
  snapshot: ReviewModuleSnapshot,
  nodeIds: Map<string, string>,
): ReviewModuleSnapshot {
  if (!snapshot.branchCandidates) return snapshot;
  return {
    ...snapshot,
    branchCandidates: snapshot.branchCandidates.map((candidate) => {
      if (!candidate.sourceNodeId || !nodeIds.has(candidate.sourceNodeId)) {
        const { sourceNodeId: _sourceNodeId, ...rest } = candidate;
        return rest;
      }
      return { ...candidate, sourceNodeId: nodeIds.get(candidate.sourceNodeId)! };
    }),
  };
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

function expectText(value: unknown, path: string): string {
  if (typeof value !== "string") throw new BackupValidationError(`${path} 必须是文本。`);
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new BackupValidationError(`${path} 必须是布尔值。`);
  return value;
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new BackupValidationError(`${path} 必须是非负整数。`);
  }
  return value as number;
}

function expectPositiveInteger(value: unknown, path: string): number {
  const result = expectNonNegativeInteger(value, path);
  if (result < 1) throw new BackupValidationError(`${path} 必须是正整数。`);
  return result;
}

function parseIdArray(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, index) => expectId(item, `${path}[${index}]`));
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

function optionalNonNegativeNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BackupValidationError(`${path} 必须是非负数。`);
  }
  return value;
}

function expectConfidence(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BackupValidationError(`${path} 必须在 0 到 1 之间。`);
  }
  return value;
}
