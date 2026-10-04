import type {
  ConversationReviewMessage,
  QuestionNode,
  ReviewCaptureReport,
  ReviewScope,
  ReviewScopeType,
} from "../types/domain";
import { estimateReviewMessagesTokens } from "./processing";

export type ReviewAncestorContext = Pick<
  QuestionNode,
  "id" | "parentId" | "question" | "summary" | "chatId" | "updatedAt"
> & {
  depthFromTarget: number;
};

export type ReviewScopeIssueCode =
  | "TARGET_NOT_FOUND"
  | "MISSING_PARENT"
  | "RELATIONSHIP_CYCLE"
  | "SOURCE_MESSAGE_MISSING"
  | "SOURCE_UNAVAILABLE";

export type ReviewScopeIssue = {
  code: ReviewScopeIssueCode;
  message: string;
  nodeId?: string;
  sourceId?: string;
};

export type ResolveReviewScopeInput = {
  projectId: string;
  scopeType: ReviewScopeType;
  nodes: readonly QuestionNode[];
  capture: ReviewCaptureReport | readonly ConversationReviewMessage[];
  targetNodeId?: string;
  chatId?: string;
};

export type ResolvedReviewScope = {
  scope: ReviewScope;
  scopeFamilyKey: string;
  messages: ConversationReviewMessage[];
  nodes: QuestionNode[];
  /** Earlier ancestors supplied only as question/summary metadata for node_context. */
  ancestorContext: ReviewAncestorContext[];
  issues: ReviewScopeIssue[];
};

export type ReviewScopeFamilyInput = {
  projectId: string;
  chatId: string;
  scopeType: ReviewScopeType;
  anchorNodeId?: string;
};

type CaptureInput = {
  chatId?: string;
  messages: readonly ConversationReviewMessage[];
  complete: boolean;
  missingSourceIds: readonly string[];
  unavailable: boolean;
};

type IndexedMessage = {
  message: ConversationReviewMessage;
  inputIndex: number;
  turnKey: string;
  userOrdinal?: number;
};

export function createScopeFamilyKey(input: ReviewScopeFamilyInput): string {
  return [
    "review-v1",
    encodeKeyPart(input.projectId),
    encodeKeyPart(input.chatId),
    input.scopeType,
    encodeKeyPart(input.anchorNodeId ?? "-"),
  ].join(":");
}

/**
 * Hashes source identity rather than source text. This is deliberately synchronous
 * and browser-safe so it can be used at UI and background boundaries alike.
 */
export function createSourceSnapshotHash(
  messages: readonly ConversationReviewMessage[],
  nodes: readonly Pick<QuestionNode, "id" | "parentId" | "updatedAt">[],
): string {
  const orderedMessages = messages
    .map((message, inputIndex) => ({ message, inputIndex }))
    .sort(compareMessages);
  const messageParts = orderedMessages.map(({ message }) => stableFields([
    message.sourceId,
    message.chatId,
    message.role,
    String(message.ordinal),
    message.locator.messageId ?? "",
    message.locator.turnId ?? "",
    message.locator.fingerprint ?? "",
    message.nodeId ?? "",
  ]));
  const nodeParts = [...nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => stableFields([
      node.id,
      node.parentId ?? "",
      String(node.updatedAt),
    ]));
  return `review-source-v1-${hash64(stableFields([
    "messages-v1",
    ...messageParts,
    "nodes-v1",
    ...nodeParts,
  ]))}`;
}

export function resolveReviewScope(input: ResolveReviewScopeInput): ResolvedReviewScope {
  const capture = normalizeCapture(input.capture);
  const target = input.targetNodeId
    ? input.nodes.find((node) => node.id === input.targetNodeId)
    : undefined;
  const chatId = input.chatId ?? target?.chatId ?? capture.chatId ?? "";
  const capturedChatMessages = sortAndDedupeMessages(
    capture.messages.filter((message) => !chatId || message.chatId === chatId),
  );
  const projectNodes = input.nodes.filter((node) => node.projectId === input.projectId);
  const issues: ReviewScopeIssue[] = [];
  if (capture.unavailable) {
    issues.push({
      code: "SOURCE_UNAVAILABLE",
      message: "当前对话来源不可用。",
    });
  }

  let scopedNodes: QuestionNode[] = [];
  let messageNodes: QuestionNode[] = [];
  let ancestorContext: ReviewAncestorContext[] = [];
  let rootNodeId: string | undefined;
  let anchorNodeId: string | undefined;
  let includesOtherBranches = false;

  if (input.scopeType === "conversation") {
    scopedNodes = projectNodes
      .filter((node) => node.chatId === chatId)
      .sort(compareNodes);
    messageNodes = scopedNodes.filter((node) => node.kind !== "planned");
    includesOtherBranches = hasMultipleLogicalBranches(scopedNodes);
    rootNodeId = findEarliestRoot(scopedNodes)?.id;
    anchorNodeId = rootNodeId;
  } else if (!target || target.projectId !== input.projectId) {
    issues.push({
      code: "TARGET_NOT_FOUND",
      message: "找不到总结范围的目标节点。",
      ...(input.targetNodeId ? { nodeId: input.targetNodeId } : {}),
      sourceId: input.targetNodeId ? `node:${input.targetNodeId}` : "target:missing",
    });
  } else {
    const path = collectAncestorPath(target, projectNodes, issues);
    scopedNodes = path;
    rootNodeId = path[0]?.id;
    anchorNodeId = target.id;
    if (input.scopeType === "current_branch") {
      messageNodes = path;
    } else {
      const directParent = path.length > 1 ? path[path.length - 2] : undefined;
      messageNodes = [directParent, target].filter(
        (node): node is QuestionNode => Boolean(node),
      );
      ancestorContext = path
        .slice(0, Math.max(0, path.length - 2))
        .map((node, index, earlier) => ({
          id: node.id,
          parentId: node.parentId,
          question: node.question,
          summary: node.summary,
          chatId: node.chatId,
          updatedAt: node.updatedAt,
          depthFromTarget: earlier.length - index + 1,
        }));
    }
  }

  const chatMessages = attachGraphMetadata(capturedChatMessages, scopedNodes);
  const indexedMessages = indexMessageTurns(chatMessages);
  const selectedMessages = input.scopeType === "conversation"
    ? chatMessages
    : selectCompleteTurns(messageNodes, indexedMessages);
  const missingSourceIds = new Set(
    capture.missingSourceIds.filter((sourceId) => sourceId.trim()),
  );
  for (const issue of issues) {
    if (issue.sourceId) missingSourceIds.add(issue.sourceId);
  }

  for (const node of messageNodes) {
    if (!findMatchingTurnKeys(node, indexedMessages).length) {
      const sourceId = `node:${node.id}`;
      missingSourceIds.add(sourceId);
      issues.push({
        code: "SOURCE_MESSAGE_MISSING",
        message: `节点“${node.question || node.id}”缺少可定位的完整消息。`,
        nodeId: node.id,
        sourceId,
      });
    }
  }

  const orderedMissingSourceIds = [...missingSourceIds].sort();
  const sourceSnapshotHash = createSourceSnapshotHash(selectedMessages, scopedNodes);
  const scope: ReviewScope = {
    type: input.scopeType,
    chatId,
    ...(anchorNodeId ? { anchorNodeId } : {}),
    ...(rootNodeId ? { rootNodeId } : {}),
    nodeIds: scopedNodes.map(({ id }) => id),
    messageSourceIds: selectedMessages.map(({ sourceId }) => sourceId),
    messageCount: selectedMessages.length,
    nodeCount: scopedNodes.length,
    includesOtherBranches,
    completeness: capture.complete && orderedMissingSourceIds.length === 0 && issues.length === 0
      ? "complete"
      : "partial",
    missingSourceIds: orderedMissingSourceIds,
    estimatedTokens: estimateReviewMessagesTokens(selectedMessages),
    sourceSnapshotHash,
  };
  const scopeFamilyKey = createScopeFamilyKey({
    projectId: input.projectId,
    chatId,
    scopeType: input.scopeType,
    ...(anchorNodeId ? { anchorNodeId } : {}),
  });

  return {
    scope,
    scopeFamilyKey,
    messages: selectedMessages,
    nodes: scopedNodes,
    ancestorContext,
    issues,
  };
}

function normalizeCapture(
  capture: ReviewCaptureReport | readonly ConversationReviewMessage[],
): CaptureInput {
  if (Array.isArray(capture)) {
    return {
      chatId: capture[0]?.chatId,
      messages: capture,
      complete: true,
      missingSourceIds: [],
      unavailable: false,
    };
  }
  const report = capture as ReviewCaptureReport;
  return {
    chatId: report.chatId,
    messages: report.messages,
    complete: report.complete,
    missingSourceIds: report.missingSourceIds,
    unavailable: report.stoppedReason === "source_unavailable",
  };
}

function collectAncestorPath(
  target: QuestionNode,
  nodes: readonly QuestionNode[],
  issues: ReviewScopeIssue[],
): QuestionNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const reversePath: QuestionNode[] = [];
  const visited = new Set<string>();
  let current: QuestionNode | undefined = target;

  while (current) {
    if (visited.has(current.id)) {
      issues.push({
        code: "RELATIONSHIP_CYCLE",
        message: "节点关系中存在循环，范围已在循环处停止。",
        nodeId: current.id,
      });
      break;
    }
    visited.add(current.id);
    reversePath.push(current);
    if (!current.parentId) break;
    const parent = byId.get(current.parentId);
    if (!parent) {
      issues.push({
        code: "MISSING_PARENT",
        message: "节点的父级关系缺失，范围只包含仍可解析的部分。",
        nodeId: current.parentId,
        sourceId: `node:${current.parentId}`,
      });
      break;
    }
    current = parent;
  }
  return reversePath.reverse();
}

function indexMessageTurns(
  messages: readonly ConversationReviewMessage[],
): IndexedMessage[] {
  let sequence = -1;
  let currentTurn = "fallback:leading";
  return messages.map((message, inputIndex) => {
    let userOrdinal: number | undefined;
    if (message.role === "user") {
      sequence += 1;
      currentTurn = `sequence:${sequence}`;
      userOrdinal = sequence;
    } else if (sequence < 0) {
      currentTurn = "sequence:leading";
    }
    return {
      message,
      inputIndex,
      // A logical turn is the user message plus following assistant messages.
      // Some platforms expose different DOM turn ids for the two roles, so those
      // ids are used for node matching but never allowed to split a complete turn.
      turnKey: currentTurn,
      ...(userOrdinal !== undefined ? { userOrdinal } : {}),
    };
  });
}

function findMatchingTurnKeys(
  node: QuestionNode,
  messages: readonly IndexedMessage[],
): string[] {
  const keys = new Set<string>();
  for (const indexed of messages) {
    if (messageMatchesNode(indexed.message, node, indexed.userOrdinal)) {
      keys.add(indexed.turnKey);
    }
  }
  return [...keys];
}

function selectCompleteTurns(
  nodes: readonly QuestionNode[],
  messages: readonly IndexedMessage[],
): ConversationReviewMessage[] {
  const turnKeys = new Set<string>();
  for (const node of nodes) {
    for (const key of findMatchingTurnKeys(node, messages)) turnKeys.add(key);
  }
  return messages
    .filter(({ turnKey }) => turnKeys.has(turnKey))
    .map(({ message }) => message);
}

function messageMatchesNode(
  message: ConversationReviewMessage,
  node: QuestionNode,
  userOrdinal?: number,
): boolean {
  if (message.nodeId === node.id) return true;
  if (message.role !== "user" || message.chatId !== node.chatId) return false;
  if (message.locator.messageId && message.locator.messageId === node.messageId) return true;
  if (message.sourceId === node.messageId) return true;
  const nodeLocator = node.messageLocator;
  if (!nodeLocator) return false;
  if (nodeLocator.messageId && nodeLocator.messageId === message.locator.messageId) return true;
  if (nodeLocator.turnId && nodeLocator.turnId === message.locator.turnId) return true;
  return nodeLocator.ordinal === userOrdinal
    && nodeLocator.fingerprint === message.locator.fingerprint;
}

function attachGraphMetadata(
  messages: readonly ConversationReviewMessage[],
  nodes: readonly QuestionNode[],
): ConversationReviewMessage[] {
  const indexed = indexMessageTurns(messages);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const metadataByTurn = new Map<string, { nodeId: string; branchPath: string[] }>();
  for (const node of nodes) {
    if (node.kind === "planned") continue;
    const branchPath = safeNodePath(node, nodeById);
    for (const turnKey of findMatchingTurnKeys(node, indexed)) {
      if (!metadataByTurn.has(turnKey)) {
        metadataByTurn.set(turnKey, { nodeId: node.id, branchPath });
      }
    }
  }
  return indexed.map(({ message, turnKey }) => {
    const metadata = metadataByTurn.get(turnKey);
    if (!metadata) return message;
    return {
      ...message,
      ...(message.nodeId ? {} : { nodeId: metadata.nodeId }),
      ...(message.branchPath ? {} : { branchPath: [...metadata.branchPath] }),
    };
  });
}

function safeNodePath(
  node: QuestionNode,
  nodeById: ReadonlyMap<string, QuestionNode>,
): string[] {
  const reversePath: string[] = [];
  const visited = new Set<string>();
  let current: QuestionNode | undefined = node;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    reversePath.push(current.id);
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }
  return reversePath.reverse();
}

function sortAndDedupeMessages(
  messages: readonly ConversationReviewMessage[],
): ConversationReviewMessage[] {
  const bySourceId = new Map<string, { message: ConversationReviewMessage; inputIndex: number }>();
  messages.forEach((message, inputIndex) => {
    if (!bySourceId.has(message.sourceId)) bySourceId.set(message.sourceId, { message, inputIndex });
  });
  return [...bySourceId.values()].sort(compareMessages).map(({ message }) => message);
}

function compareMessages(
  left: { message: ConversationReviewMessage; inputIndex: number },
  right: { message: ConversationReviewMessage; inputIndex: number },
): number {
  return left.message.ordinal - right.message.ordinal || left.inputIndex - right.inputIndex;
}

function compareNodes(left: QuestionNode, right: QuestionNode): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function hasMultipleLogicalBranches(nodes: readonly QuestionNode[]): boolean {
  const included = new Set(nodes.map(({ id }) => id));
  const childCounts = new Map<string, number>();
  let roots = 0;
  for (const node of nodes) {
    if (!node.parentId || !included.has(node.parentId)) {
      roots += 1;
      continue;
    }
    const count = (childCounts.get(node.parentId) ?? 0) + 1;
    if (count > 1) return true;
    childCounts.set(node.parentId, count);
  }
  return roots > 1 && nodes.length > 1;
}

function findEarliestRoot(nodes: readonly QuestionNode[]): QuestionNode | undefined {
  const included = new Set(nodes.map(({ id }) => id));
  return nodes
    .filter((node) => !node.parentId || !included.has(node.parentId))
    .sort(compareNodes)[0];
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function stableFields(fields: readonly string[]): string {
  return fields.map((value) => `${value.length}:${value}`).join("|");
}

function hash64(value: string): string {
  let high = 2166136261;
  let low = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high ^= code;
    high = Math.imul(high, 16777619);
    low ^= code + index;
    low = Math.imul(low, 3266489917);
  }
  return `${(high >>> 0).toString(36)}${(low >>> 0).toString(36).padStart(7, "0")}`;
}
