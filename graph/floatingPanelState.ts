import type {
  FloatingPanelNodeOption,
  FloatingPanelReviewArtifact,
  FloatingPanelState,
} from "../shared/messages";
import type {
  Project,
  QuestionCandidate,
  QuestionNode,
  ReviewDocument,
  ReviewVersion,
} from "../types/domain";
import { getParentSelectionCandidates } from "./questionTree";
import { countQuestionReferences } from "../shared/questionReferences";
import {
  buildReviewGraphArtifacts,
  reviewArtifactFlowNodeId,
} from "./reviewArtifacts";

type BuildFloatingPanelStateInput = {
  captureEnabled?: boolean;
  project?: Project;
  projects?: Project[];
  nodes: QuestionNode[];
  candidates: QuestionCandidate[];
  reviewDocuments?: ReviewDocument[];
  reviewVersions?: ReviewVersion[];
  chatId?: string;
  selectedNodeId?: string;
  selectedCandidateId?: string;
  mediumConfidence: number;
};

export function emptyFloatingPanelState(
  projectTitle = "Chat Graph",
  projects: Project[] = [],
  captureEnabled = true,
): FloatingPanelState {
  return {
    captureEnabled,
    projectTitle,
    projects: projectOptions(projects),
    graphNodes: [],
    parentState: "empty",
    recommendedParents: [],
    parentOptions: [],
  };
}

export function buildFloatingPanelState({
  captureEnabled = true,
  project,
  projects,
  nodes,
  candidates,
  reviewDocuments = [],
  reviewVersions = [],
  chatId,
  selectedNodeId,
  selectedCandidateId,
  mediumConfidence,
}: BuildFloatingPanelStateInput): FloatingPanelState {
  if (!project) return emptyFloatingPanelState("Chat Graph", projects, captureEnabled);

  const currentNode = chatId
    ? latest(nodes.filter((node) => node.chatId === chatId))
    : undefined;
  const currentCandidate = chatId
    ? latest(candidates.filter((candidate) => candidate.chatId === chatId))
    : undefined;
  const candidateIsCurrent = Boolean(
    currentCandidate &&
      (!currentNode || currentCandidate.createdAt >= currentNode.createdAt),
  );
  const latestQuestion = candidateIsCurrent ? currentCandidate : currentNode;
  const reviewArtifacts = buildFloatingPanelReviewArtifacts(
    project.id,
    reviewDocuments,
    reviewVersions,
    nodes,
  );

  const base = {
    captureEnabled,
    projectId: project.id,
    projectTitle: project.title || "Chat Graph",
    projects: projectOptions(projects ?? [project]),
    graphNodes: graphNodeOptions(nodes),
    reviewNodes: nodes,
    ...(reviewArtifacts.length ? { reviewArtifacts } : {}),
    ...(latestQuestion ? { latestQuestionKey: questionKey(latestQuestion) } : {}),
    ...(project.focusNodeId ? { focusedNodeId: project.focusNodeId } : {}),
  };

  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId)
    : undefined;
  if (selectedNode) {
    return {
      ...base,
      viewingNodeId: selectedNode.id,
      ...nodeCurrentState(nodes, selectedNode),
    };
  }

  const selectedCandidate = selectedCandidateId
    ? candidates.find((candidate) => candidate.id === selectedCandidateId)
    : undefined;
  if (selectedCandidate) {
    return {
      ...base,
      ...candidateCurrentState(nodes, selectedCandidate, mediumConfidence),
    };
  }

  if (!chatId) {
    return {
      ...base,
      parentState: "empty",
      recommendedParents: [],
      parentOptions: [],
    };
  }

  if (candidateIsCurrent && currentCandidate) {
    return {
      ...base,
      ...candidateCurrentState(nodes, currentCandidate, mediumConfidence),
    };
  }

  if (!currentNode) {
    return {
      ...base,
      parentState: "empty",
      recommendedParents: [],
      parentOptions: [],
    };
  }

  return {
    ...base,
    ...nodeCurrentState(nodes, currentNode),
  };
}

export function buildFloatingPanelReviewArtifacts(
  projectId: string,
  documents: readonly ReviewDocument[],
  versions: readonly ReviewVersion[],
  nodes: readonly QuestionNode[] = [],
): FloatingPanelReviewArtifact[] {
  return buildReviewGraphArtifacts(
    documents.filter((document) => document.projectId === projectId),
    versions.filter((version) => version.projectId === projectId),
    nodes.filter((node) => node.projectId === projectId),
  ).map((artifact) => ({
    id: reviewArtifactFlowNodeId(artifact.document.id),
    title: artifact.version.title,
    anchorNodeId: artifact.graphAnchorNodeId,
    documentId: artifact.document.id,
    versionId: artifact.version.id,
    savedAt: artifact.savedAt,
    ...(artifact.stale ? { stale: true } : {}),
  }));
}

function candidateCurrentState(
  nodes: QuestionNode[],
  candidate: QuestionCandidate,
  mediumConfidence: number,
) {
  const previousNode = latest(
    nodes.filter(
      (node) => node.chatId === candidate.chatId && node.createdAt < candidate.createdAt,
    ),
  );
  const eligibleById = new Map(nodes.map((node) => [node.id, node]));
  const rankedRecommendations = [...candidate.recommendations]
    .sort((a, b) => b.confidence - a.confidence);
  const previousConfidence = previousNode
    ? rankedRecommendations.find((recommendation) => recommendation.nodeId === previousNode.id)
      ?.confidence
    : undefined;
  const seenRecommendations = new Set<string>();
  const confidenceOptions: FloatingPanelNodeOption[] = rankedRecommendations
    .flatMap((recommendation) => {
      if (
        recommendation.nodeId === previousNode?.id ||
        seenRecommendations.has(recommendation.nodeId)
      ) return [];
      seenRecommendations.add(recommendation.nodeId);
      const node = eligibleById.get(recommendation.nodeId);
      return node
        ? [{
            id: node.id,
            question: node.question,
            confidence: recommendation.confidence,
          }]
        : [];
    })
    .slice(0, 3);
  const recommendedParents: FloatingPanelNodeOption[] = previousNode
    ? [{
        id: previousNode.id,
        question: previousNode.question,
        ...(previousConfidence !== undefined ? { confidence: previousConfidence } : {}),
        isPrevious: true,
      }, ...confidenceOptions]
    : confidenceOptions;
  const hasMediumChoice =
    recommendedParents.some(
      (option) => option.isPrevious || (option.confidence ?? 0) >= mediumConfidence,
    ) || candidate.noParentConfidence >= mediumConfidence;
  const parentState: FloatingPanelState["parentState"] =
    candidate.status === "processing"
      ? "processing"
      : candidate.status === "failed"
        ? "unresolved"
        : hasMediumChoice
          ? "selecting"
          : "root";

  return {
    currentCandidateId: candidate.id,
    currentQuestion: candidate.question,
    ...(candidate.references?.length
      ? { currentReferenceCounts: countQuestionReferences(candidate.references) }
      : {}),
    ...(candidate.status === "processing"
      ? {}
      : { currentSummary: candidate.summary }),
    parentState,
    recommendedParents,
    rootConfidence: candidate.noParentConfidence,
    parentOptions: nodeOptions(nodes, previousNode?.id),
  };
}

function nodeCurrentState(nodes: QuestionNode[], currentNode: QuestionNode) {
  const parent = currentNode.parentId
    ? nodes.find((node) => node.id === currentNode.parentId)
    : undefined;
  const parentCandidates = getParentSelectionCandidates(nodes, currentNode.id);
  return {
    currentNodeId: currentNode.id,
    currentQuestion: currentNode.question,
    currentSummary: currentNode.summary,
    ...(currentNode.references?.length
      ? { currentReferenceCounts: countQuestionReferences(currentNode.references) }
      : {}),
    ...(parent
      ? {
          parentId: parent.id,
          parentQuestion: parent.question,
          parentSummary: parent.summary,
        }
      : {}),
    parentState: parent ? "ready" as const : "root" as const,
    recommendedParents: [],
    parentOptions: nodeOptions(
      parentCandidates.nodes,
      parentCandidates.latestConversationNodeId,
    ),
  };
}

function questionKey(question: Pick<QuestionNode | QuestionCandidate, "chatId" | "messageId">) {
  return JSON.stringify([question.chatId, question.messageId]);
}

function latest<T extends { createdAt: number }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>(
    (result, item) => (!result || item.createdAt > result.createdAt ? item : result),
    undefined,
  );
}

function nodeOptions(
  nodes: QuestionNode[],
  latestConversationNodeId?: string,
): FloatingPanelNodeOption[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.id === latestConversationNodeId) return -1;
      if (b.id === latestConversationNodeId) return 1;
      return b.updatedAt - a.updatedAt;
    })
    .map(({ id, question }) => ({
      id,
      question,
      ...(id === latestConversationNodeId ? { isPrevious: true } : {}),
    }));
}

function projectOptions(projects: Project[]) {
  return projects.map(({ id, title }) => ({ id, title }));
}

function graphNodeOptions(nodes: QuestionNode[]) {
  return [...nodes]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ id, parentId, question, status, kind, references }) => {
      const referenceCounts = countQuestionReferences(references);
      return {
        id,
        parentId,
        question,
        status,
        ...(kind ? { kind } : {}),
        ...(referenceCounts.total ? { referenceCounts } : {}),
      };
    });
}
