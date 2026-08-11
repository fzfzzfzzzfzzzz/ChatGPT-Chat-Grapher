import type {
  FloatingPanelNodeOption,
  FloatingPanelState,
} from "../shared/messages";
import type {
  Project,
  QuestionCandidate,
  QuestionNode,
} from "../types/domain";
import { isDescendant } from "./questionTree";

type BuildFloatingPanelStateInput = {
  captureEnabled?: boolean;
  project?: Project;
  projects?: Project[];
  nodes: QuestionNode[];
  candidates: QuestionCandidate[];
  chatId?: string;
  selectedNodeId?: string;
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
  chatId,
  selectedNodeId,
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

  const base = {
    captureEnabled,
    projectId: project.id,
    projectTitle: project.title || "Chat Graph",
    projects: projectOptions(projects ?? [project]),
    graphNodes: graphNodeOptions(nodes),
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

  if (!chatId) {
    return {
      ...base,
      parentState: "empty",
      recommendedParents: [],
      parentOptions: [],
    };
  }

  if (candidateIsCurrent && currentCandidate) {
    const eligibleNodes = nodes;
    const previousNode = latest(
      eligibleNodes.filter(
        (node) => node.chatId === chatId && node.createdAt <= currentCandidate.createdAt,
      ),
    );
    const eligibleById = new Map(eligibleNodes.map((node) => [node.id, node]));
    const rankedRecommendations = [...currentCandidate.recommendations]
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
      ) || currentCandidate.noParentConfidence >= mediumConfidence;
    const parentState =
      currentCandidate.status === "processing"
        ? "processing"
        : currentCandidate.status === "failed"
          ? "unresolved"
          : hasMediumChoice
            ? "selecting"
            : "root";

    return {
      ...base,
      currentCandidateId: currentCandidate.id,
      currentQuestion: currentCandidate.question,
      ...(currentCandidate.status === "processing"
        ? {}
        : { currentSummary: currentCandidate.summary }),
      parentState,
      recommendedParents,
      rootConfidence: currentCandidate.noParentConfidence,
      parentOptions: nodeOptions(nodes),
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

function nodeCurrentState(nodes: QuestionNode[], currentNode: QuestionNode) {
  const parent = currentNode.parentId
    ? nodes.find((node) => node.id === currentNode.parentId)
    : undefined;
  const validParents = nodes.filter(
    (candidate) =>
      candidate.id !== currentNode.id &&
      !isDescendant(nodes, candidate.id, currentNode.id),
  );
  return {
    currentNodeId: currentNode.id,
    currentQuestion: currentNode.question,
    currentSummary: currentNode.summary,
    ...(parent
      ? {
          parentId: parent.id,
          parentQuestion: parent.question,
          parentSummary: parent.summary,
        }
      : {}),
    parentState: parent ? "ready" as const : "root" as const,
    recommendedParents: [],
    parentOptions: nodeOptions(validParents),
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

function nodeOptions(nodes: QuestionNode[]): FloatingPanelNodeOption[] {
  return [...nodes]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 60)
    .map(({ id, question }) => ({ id, question }));
}

function projectOptions(projects: Project[]) {
  return projects.map(({ id, title }) => ({ id, title }));
}

function graphNodeOptions(nodes: QuestionNode[]) {
  return [...nodes]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ id, parentId, question, status }) => ({
      id,
      parentId,
      question,
      status,
    }));
}
