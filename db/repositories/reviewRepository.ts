import type { DiscussionMapDatabase } from "../database";
import type {
  ReviewDocument,
  ReviewEntrySource,
  ReviewJob,
  ReviewJobStatus,
  ReviewModuleEdit,
  ReviewModuleId,
  ReviewModuleSnapshot,
  ReviewPresetId,
  ReviewScope,
  ReviewVersion,
} from "../../types/domain";
import { createId } from "../../utils/id";
import { requireText } from "../../utils/text";

const ACTIVE_JOB_STATUSES = new Set<ReviewJobStatus>([
  "waiting",
  "collecting",
  "organizing",
  "generating",
]);

export type CreateReviewDocumentInput = {
  projectId: string;
  chatId: string;
  scopeFamilyKey: string;
  entrySource: ReviewEntrySource;
  supersedesDocumentId?: string;
};

export type CreateReviewVersionInput = Omit<
  ReviewVersion,
  "id" | "version" | "generatedAt" | "updatedAt"
> & {
  generatedAt?: number;
};

export type CreateReviewJobInput = {
  projectId: string;
  documentId: string;
  scopeFamilyKey: string;
  scope: ReviewScope;
  selectedModuleIds: ReviewModuleId[];
  presetId: ReviewPresetId;
};

export type CreateReviewJobResult = {
  job: ReviewJob;
  created: boolean;
};

export class ReviewRepository {
  constructor(private readonly database: DiscussionMapDatabase) {}

  async createDocument(input: CreateReviewDocumentInput): Promise<ReviewDocument> {
    const now = Date.now();
    const document: ReviewDocument = {
      id: createId("review"),
      projectId: requireText(input.projectId, "Project"),
      chatId: requireText(input.chatId, "Chat"),
      scopeFamilyKey: requireText(input.scopeFamilyKey, "Review scope"),
      entrySource: input.entrySource,
      ...(input.supersedesDocumentId
        ? { supersedesDocumentId: input.supersedesDocumentId }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.database.transaction(
      "rw",
      this.database.projects,
      this.database.reviewDocuments,
      async () => {
        if (!await this.database.projects.get(document.projectId)) {
          throw new Error("Project not found.");
        }
        await this.database.reviewDocuments.add(document);
      },
    );
    return document;
  }

  getDocument(id: string): Promise<ReviewDocument | undefined> {
    return this.database.reviewDocuments.get(id);
  }

  listDocumentsForProject(projectId: string): Promise<ReviewDocument[]> {
    return this.database.reviewDocuments
      .where("projectId")
      .equals(projectId)
      .sortBy("updatedAt")
      .then((items) => items.reverse());
  }

  findDocumentsByScope(projectId: string, scopeFamilyKey: string): Promise<ReviewDocument[]> {
    return this.database.reviewDocuments
      .where("[projectId+scopeFamilyKey]")
      .equals([projectId, scopeFamilyKey])
      .toArray();
  }

  async updateDocument(
    id: string,
    changes: Partial<Pick<
      ReviewDocument,
      "activeVersionId" | "graphAnchorNodeId" | "savedAt" | "supersedesDocumentId"
    >>,
  ): Promise<ReviewDocument> {
    const updated = await this.database.reviewDocuments.update(id, {
      ...changes,
      updatedAt: Date.now(),
    });
    if (!updated) throw new Error("Conversation review not found.");
    return (await this.database.reviewDocuments.get(id))!;
  }

  async createVersion(input: CreateReviewVersionInput): Promise<ReviewVersion> {
    let version: ReviewVersion | undefined;
    await this.database.transaction(
      "rw",
      this.database.reviewVersions,
      this.database.reviewDocuments,
      async () => {
        const document = await this.database.reviewDocuments.get(input.documentId);
        if (
          !document
          || document.projectId !== input.projectId
          || document.chatId !== input.scope.chatId
        ) {
          throw new Error("Conversation review document does not match its version.");
        }
        const existing = await this.database.reviewVersions
          .where("documentId")
          .equals(input.documentId)
          .toArray();
        const versionNumber = existing.reduce((max, item) => Math.max(max, item.version), 0) + 1;
        const now = input.generatedAt ?? Date.now();
        version = {
          ...input,
          id: createId("review-version"),
          version: versionNumber,
          generatedAt: now,
          updatedAt: now,
        };
        await this.database.reviewVersions.add(version);
        const updated = await this.database.reviewDocuments.update(input.documentId, {
          activeVersionId: version.id,
          updatedAt: now,
        });
        if (!updated) throw new Error("Conversation review not found.");
      },
    );
    if (!version) throw new Error("Conversation review version could not be created.");
    return version;
  }

  getVersion(id: string): Promise<ReviewVersion | undefined> {
    return this.database.reviewVersions.get(id);
  }

  listVersions(documentId: string): Promise<ReviewVersion[]> {
    return this.database.reviewVersions
      .where("documentId")
      .equals(documentId)
      .sortBy("version");
  }

  async updateVersion(
    id: string,
    changes: {
      title?: string;
      modules?: ReviewModuleEdit[];
      helpful?: boolean;
      moduleFeedback?: Partial<Record<ReviewModuleId, string>>;
    },
  ): Promise<ReviewVersion> {
    return this.database.transaction("rw", this.database.reviewVersions, async () => {
      const existing = await this.database.reviewVersions.get(id);
      if (!existing) throw new Error("Conversation review version not found.");
      const next: Partial<ReviewVersion> = { updatedAt: Date.now() };
      if (changes.title !== undefined) {
        if (typeof changes.title !== "string" || [...changes.title].length > 160) {
          throw new Error("Conversation review title is invalid.");
        }
        next.title = changes.title;
      }
      if (changes.modules !== undefined) {
        next.modules = mergeModuleEdits(existing, changes.modules);
      }
      if (changes.helpful !== undefined) {
        if (typeof changes.helpful !== "boolean") throw new Error("Conversation review feedback is invalid.");
        next.helpful = changes.helpful;
      }
      if (changes.moduleFeedback !== undefined) {
        next.moduleFeedback = sanitizeModuleFeedback(existing, changes.moduleFeedback);
      }
      await this.database.reviewVersions.update(id, next);
      return (await this.database.reviewVersions.get(id))!;
    });
  }

  async createJob(input: CreateReviewJobInput): Promise<ReviewJob> {
    return (await this.createJobOnce(input)).job;
  }

  async createJobOnce(input: CreateReviewJobInput): Promise<CreateReviewJobResult> {
    return this.database.transaction(
      "rw",
      this.database.projects,
      this.database.reviewDocuments,
      this.database.reviewJobs,
      async () => {
        const [project, document] = await Promise.all([
          this.database.projects.get(input.projectId),
          this.database.reviewDocuments.get(input.documentId),
        ]);
        if (
          !project
          || !document
          || document.projectId !== input.projectId
          || document.chatId !== input.scope.chatId
          || document.scopeFamilyKey !== input.scopeFamilyKey
        ) {
          throw new Error("Conversation review job source no longer exists.");
        }
        const existing = await this.findActiveJob(input.projectId, input.scopeFamilyKey);
        if (existing) return { job: existing, created: false };
        const now = Date.now();
        const moduleStates = Object.fromEntries(
          input.selectedModuleIds.map((moduleId) => [moduleId, "queued"]),
        ) as ReviewJob["moduleStates"];
        const job: ReviewJob = {
          id: createId("review-job"),
          projectId: input.projectId,
          documentId: input.documentId,
          scopeFamilyKey: input.scopeFamilyKey,
          scope: input.scope,
          selectedModuleIds: [...input.selectedModuleIds],
          presetId: input.presetId,
          status: "waiting",
          progress: { current: 0, total: 1, message: "等待生成" },
          moduleStates,
          createdAt: now,
          updatedAt: now,
        };
        await this.database.reviewJobs.add(job);
        return { job, created: true };
      },
    );
  }

  getJob(id: string): Promise<ReviewJob | undefined> {
    return this.database.reviewJobs.get(id);
  }

  async findActiveJob(projectId: string, scopeFamilyKey: string): Promise<ReviewJob | undefined> {
    const jobs = await this.database.reviewJobs
      .where("scopeFamilyKey")
      .equals(scopeFamilyKey)
      .filter((job) => job.projectId === projectId)
      .toArray();
    return jobs.find((job) => ACTIVE_JOB_STATUSES.has(job.status));
  }

  listJobsForProject(projectId: string): Promise<ReviewJob[]> {
    return this.database.reviewJobs
      .where("projectId")
      .equals(projectId)
      .sortBy("updatedAt")
      .then((items) => items.reverse());
  }

  async updateJob(
    id: string,
    changes: Partial<Omit<ReviewJob, "id" | "projectId" | "documentId" | "createdAt">>,
  ): Promise<ReviewJob> {
    const updated = await this.database.reviewJobs.update(id, {
      ...changes,
      updatedAt: Date.now(),
    });
    if (!updated) throw new Error("Conversation review job not found.");
    return (await this.database.reviewJobs.get(id))!;
  }

  async markUnfinishedInterrupted(): Promise<number> {
    let count = 0;
    await this.database.reviewJobs.toCollection().modify((job) => {
      if (!ACTIVE_JOB_STATUSES.has(job.status)) return;
      job.status = "interrupted";
      job.errorCode = "INTERRUPTED";
      job.error = "浏览器后台任务已中断，请重新采集来源后重试。";
      job.updatedAt = Date.now();
      count += 1;
    });
    return count;
  }

  async deleteDocument(id: string): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.reviewDocuments,
      this.database.reviewVersions,
      this.database.reviewJobs,
      this.database.nodes,
      async () => {
        const updatedAt = Date.now();
        await this.database.reviewDocuments.toCollection().modify((document) => {
          if (document.supersedesDocumentId !== id) return;
          delete document.supersedesDocumentId;
          document.updatedAt = updatedAt;
        });
        await this.database.nodes.toCollection().modify((node) => {
          if (node.plannedFromReviewId !== id) return;
          delete node.plannedFromReviewId;
          node.updatedAt = updatedAt;
        });
        await this.database.reviewVersions.where("documentId").equals(id).delete();
        await this.database.reviewJobs.where("documentId").equals(id).delete();
        await this.database.reviewDocuments.delete(id);
      },
    );
  }
}

const CLAIM_STATUSES = new Set([
  "confirmed",
  "user_decision",
  "consensus",
  "assistant_suggestion",
  "tentative",
  "unresolved",
  "deferred",
  "rejected",
]);

function mergeModuleEdits(
  version: ReviewVersion,
  edits: readonly ReviewModuleEdit[],
): ReviewVersion["modules"] {
  const originalById = new Map(version.modules.map((module) => [module.moduleId, module]));
  const evidenceIds = new Set(version.evidences.map((evidence) => evidence.id));
  const seen = new Set<ReviewModuleId>();
  const editById = new Map<ReviewModuleId, ReviewModuleEdit>();
  for (const edit of edits) {
    if (!originalById.has(edit.moduleId) || seen.has(edit.moduleId)) {
      throw new Error("Conversation review module edit is invalid.");
    }
    if (!Array.isArray(edit.editHistory) || edit.editHistory.length > 20) {
      throw new Error("Conversation review edit history exceeds its limit.");
    }
    seen.add(edit.moduleId);
    editById.set(edit.moduleId, edit);
  }
  return version.modules.map((original) => {
    const edit = editById.get(original.moduleId);
    if (!edit) return original;
    return {
      ...original,
      current: sanitizeSnapshot(edit.current, evidenceIds),
      editHistory: edit.editHistory.map((snapshot) => sanitizeSnapshot(snapshot, evidenceIds)),
      ...(edit.editedAt !== undefined
        ? { editedAt: sanitizeTimestamp(edit.editedAt) }
        : original.editedAt !== undefined
          ? { editedAt: original.editedAt }
          : {}),
    };
  });
}

function sanitizeSnapshot(
  snapshot: ReviewModuleSnapshot,
  allowedEvidenceIds: ReadonlySet<string>,
): ReviewModuleSnapshot {
  if (!snapshot || typeof snapshot.overview !== "string" || [...snapshot.overview].length > 50_000) {
    throw new Error("Conversation review module overview is invalid.");
  }
  if (!Array.isArray(snapshot.items) || snapshot.items.length > 500) {
    throw new Error("Conversation review module items are invalid.");
  }
  const itemIds = new Set<string>();
  const items = snapshot.items.map((item) => {
    if (
      !item
      || typeof item.id !== "string"
      || !item.id.trim()
      || item.id.length > 200
      || itemIds.has(item.id)
      || typeof item.text !== "string"
      || [...item.text].length > 20_000
      || typeof item.isInference !== "boolean"
      || (item.isUserEdited !== undefined && typeof item.isUserEdited !== "boolean")
      || (item.status !== undefined && !CLAIM_STATUSES.has(item.status))
      || !Array.isArray(item.evidenceIds)
      || item.evidenceIds.length > 50
      || item.evidenceIds.some((evidenceId) => !allowedEvidenceIds.has(evidenceId))
    ) {
      throw new Error("Conversation review module item is invalid.");
    }
    itemIds.add(item.id);
    return {
      id: item.id,
      text: item.text,
      ...(item.status ? { status: item.status } : {}),
      isInference: item.isInference,
      ...(item.isUserEdited !== undefined ? { isUserEdited: item.isUserEdited } : {}),
      evidenceIds: [...new Set(item.evidenceIds)],
    };
  });
  let branchCandidates: ReviewModuleSnapshot["branchCandidates"];
  if (snapshot.branchCandidates !== undefined) {
    if (!Array.isArray(snapshot.branchCandidates) || snapshot.branchCandidates.length > 50) {
      throw new Error("Conversation review branch candidates are invalid.");
    }
    const ids = new Set<string>();
    branchCandidates = snapshot.branchCandidates.map((candidate) => {
      if (
        !candidate
        || typeof candidate.id !== "string"
        || !candidate.id.trim()
        || ids.has(candidate.id)
        || typeof candidate.title !== "string"
        || typeof candidate.rationale !== "string"
        || typeof candidate.firstQuestion !== "string"
        || [...candidate.title].length > 500
        || [...candidate.rationale].length > 5_000
        || [...candidate.firstQuestion].length > 5_000
        || (candidate.sourceNodeId !== undefined && typeof candidate.sourceNodeId !== "string")
      ) {
        throw new Error("Conversation review branch candidate is invalid.");
      }
      ids.add(candidate.id);
      return { ...candidate };
    });
  }
  return {
    overview: snapshot.overview,
    items,
    ...(branchCandidates ? { branchCandidates } : {}),
  };
}

function sanitizeModuleFeedback(
  version: ReviewVersion,
  feedback: Partial<Record<ReviewModuleId, string>>,
): Partial<Record<ReviewModuleId, string>> {
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) {
    throw new Error("Conversation review module feedback is invalid.");
  }
  const allowed = new Set(version.moduleOrder);
  const sanitized: Partial<Record<ReviewModuleId, string>> = {};
  for (const [moduleId, value] of Object.entries(feedback)) {
    if (!allowed.has(moduleId as ReviewModuleId) || typeof value !== "string" || [...value].length > 2_000) {
      throw new Error("Conversation review module feedback is invalid.");
    }
    sanitized[moduleId as ReviewModuleId] = value;
  }
  return sanitized;
}

function sanitizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Conversation review edit timestamp is invalid.");
  return Math.floor(value);
}
