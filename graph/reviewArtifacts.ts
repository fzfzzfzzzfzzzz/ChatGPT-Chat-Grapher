import type { QuestionNode, ReviewDocument, ReviewVersion } from "../types/domain";

/**
 * Read-only projection of a persisted review into the question graph.
 *
 * Keeping the document and its active version together prevents graph callers
 * from accidentally rendering a stale version or treating a draft as saved.
 */
export type ReviewGraphArtifact = {
  kind: "review";
  id: string;
  graphAnchorNodeId: string;
  savedAt: number;
  document: ReviewDocument;
  version: ReviewVersion;
  stale?: boolean;
};

const REVIEW_FLOW_NODE_PREFIX = "review-artifact:";

export function reviewArtifactFlowNodeId(documentId: string): string {
  return `${REVIEW_FLOW_NODE_PREFIX}${documentId}`;
}

export function buildReviewGraphArtifacts(
  documents: readonly ReviewDocument[],
  versions: readonly ReviewVersion[],
  questions: readonly QuestionNode[] = [],
): ReviewGraphArtifact[] {
  const versionsById = new Map(versions.map((version) => [version.id, version]));

  return documents
    .flatMap((document): ReviewGraphArtifact[] => {
      if (
        document.savedAt === undefined
        || !document.graphAnchorNodeId
        || !document.activeVersionId
      ) {
        return [];
      }

      const version = versionsById.get(document.activeVersionId);
      if (
        !version
        || version.documentId !== document.id
        || version.projectId !== document.projectId
      ) {
        return [];
      }

      return [{
        kind: "review",
        id: document.id,
        graphAnchorNodeId: document.graphAnchorNodeId,
        savedAt: document.savedAt,
        document,
        version,
        ...(questions.length ? { stale: isReviewArtifactStale(version, questions) } : {}),
      }];
    })
    .sort((left, right) => left.savedAt - right.savedAt || left.id.localeCompare(right.id));
}

function isReviewArtifactStale(
  version: ReviewVersion,
  questions: readonly QuestionNode[],
): boolean {
  const projectQuestions = questions.filter((node) => node.projectId === version.projectId);
  if (version.scope.type === "conversation") {
    return projectQuestions.some((node) => (
      node.chatId === version.scope.chatId && node.updatedAt > version.generatedAt
    ));
  }
  const included = new Set(version.scope.nodeIds);
  if (projectQuestions.some((node) => included.has(node.id) && node.updatedAt > version.generatedAt)) {
    return true;
  }
  const anchor = version.scope.anchorNodeId;
  if (!anchor) return false;
  const byId = new Map(projectQuestions.map((node) => [node.id, node]));
  return projectQuestions.some((node) => {
    if (node.createdAt <= version.generatedAt || included.has(node.id)) return false;
    const visited = new Set<string>();
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      if (parentId === anchor) return true;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  });
}
