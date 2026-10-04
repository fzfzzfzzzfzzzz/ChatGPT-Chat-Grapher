import { describe, expect, it } from "vitest";
import {
  createScopeFamilyKey,
  createSourceSnapshotHash,
  resolveReviewScope,
} from "../review/scope";
import type {
  ConversationReviewMessage,
  QuestionNode,
  ReviewCaptureReport,
} from "../types/domain";

function node(
  id: string,
  parentId: string | null,
  createdAt: number,
  overrides: Partial<QuestionNode> = {},
): QuestionNode {
  return {
    id,
    projectId: "project-1",
    parentId,
    question: `Question ${id}`,
    summary: `Summary ${id}`,
    status: "pending",
    chatId: "chat-1",
    messageId: `message-${id}`,
    messageLocator: {
      version: 1,
      messageId: `message-${id}`,
      turnId: `turn-${id}`,
      ordinal: createdAt,
      fingerprint: `fingerprint-${id}`,
    },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function message(
  sourceId: string,
  role: "user" | "assistant",
  ordinal: number,
  turnNodeId: string,
): ConversationReviewMessage {
  return {
    sourceId,
    chatId: "chat-1",
    role,
    content: `${role} content for ${turnNodeId}`,
    ordinal,
    locator: {
      version: 1,
      chatId: "chat-1",
      role,
      messageId: role === "user" ? `message-${turnNodeId}` : `answer-${turnNodeId}`,
      turnId: `turn-${turnNodeId}`,
      ordinal,
      fingerprint: `${role}-${turnNodeId}`,
    },
    ...(role === "user" ? { nodeId: turnNodeId } : {}),
    branchPath: ["a", turnNodeId],
  };
}

function capture(messages: ConversationReviewMessage[]): ReviewCaptureReport {
  return {
    chatId: "chat-1",
    messages,
    complete: true,
    missingSourceIds: [],
  };
}

const nodes = [
  node("a", null, 1),
  node("b", "a", 2),
  node("c", "b", 3),
  node("d", "a", 4),
];
const allMessages = [
  message("a-u", "user", 0, "a"),
  message("a-a", "assistant", 1, "a"),
  message("b-u", "user", 2, "b"),
  message("b-a", "assistant", 3, "b"),
  message("c-u", "user", 4, "c"),
  message("c-a", "assistant", 5, "c"),
  message("d-u", "user", 6, "d"),
  message("d-a", "assistant", 7, "d"),
];

describe("Conversation Review scope resolution", () => {
  it("selects complete turns only along the target ancestor branch", () => {
    const result = resolveReviewScope({
      projectId: "project-1",
      scopeType: "current_branch",
      nodes,
      capture: capture(allMessages),
      targetNodeId: "c",
    });

    expect(result.scope.nodeIds).toEqual(["a", "b", "c"]);
    expect(result.messages.map(({ sourceId }) => sourceId)).toEqual([
      "a-u", "a-a", "b-u", "b-a", "c-u", "c-a",
    ]);
    expect(result.scope.includesOtherBranches).toBe(false);
    expect(result.scope.completeness).toBe("complete");
    expect(result.scope.messageCount).toBe(6);
  });

  it("matches legacy user-only ordinals against globally ordered captured messages", () => {
    const first = node("legacy-a", null, 1, {
      messageId: "unmatched-legacy-a",
      messageLocator: {
        version: 1,
        ordinal: 0,
        fingerprint: "legacy-fingerprint-a",
      },
    });
    const second = node("legacy-b", "legacy-a", 2, {
      messageId: "unmatched-legacy-b",
      messageLocator: {
        version: 1,
        ordinal: 1,
        fingerprint: "legacy-fingerprint-b",
      },
    });
    const fallbackMessages: ConversationReviewMessage[] = [
      fallbackMessage("legacy-a-user", "user", 0, "legacy-fingerprint-a"),
      fallbackMessage("legacy-a-answer", "assistant", 1, "answer-a"),
      fallbackMessage("legacy-b-user", "user", 2, "legacy-fingerprint-b"),
      fallbackMessage("legacy-b-answer", "assistant", 3, "answer-b"),
    ];
    const result = resolveReviewScope({
      projectId: "project-1",
      scopeType: "current_branch",
      nodes: [first, second],
      capture: capture(fallbackMessages),
      targetNodeId: second.id,
    });

    expect(result.messages.map(({ sourceId }) => sourceId)).toEqual([
      "legacy-a-user",
      "legacy-a-answer",
      "legacy-b-user",
      "legacy-b-answer",
    ]);
    expect(result.scope.completeness).toBe("complete");
  });

  it("uses all captured chat messages and reports unmatched same-chat graph nodes", () => {
    const result = resolveReviewScope({
      projectId: "project-1",
      scopeType: "conversation",
      nodes,
      capture: capture(allMessages.slice(0, 6)),
      chatId: "chat-1",
    });

    expect(result.scope.nodeIds).toEqual(["a", "b", "c", "d"]);
    expect(result.scope.includesOtherBranches).toBe(true);
    expect(result.scope.missingSourceIds).toContain("node:d");
    expect(result.scope.completeness).toBe("partial");
    expect(result.messages).toHaveLength(6);
  });

  it("attaches graph node and path metadata to every message in a matched turn", () => {
    const bareMessages = allMessages.map((item) => {
      const { branchPath: _branchPath, nodeId: _nodeId, ...bare } = item;
      return item.role === "user" && _nodeId ? { ...bare, nodeId: _nodeId } : bare;
    });
    const result = resolveReviewScope({
      projectId: "project-1",
      scopeType: "conversation",
      nodes,
      capture: capture(bareMessages),
      chatId: "chat-1",
    });

    const cAnswer = result.messages.find(({ sourceId }) => sourceId === "c-a");
    expect(cAnswer).toEqual(expect.objectContaining({
      nodeId: "c",
      branchPath: ["a", "b", "c"],
    }));
  });

  it("keeps only target and direct-parent turns while exposing earlier ancestor summaries", () => {
    const result = resolveReviewScope({
      projectId: "project-1",
      scopeType: "node_context",
      nodes,
      capture: capture(allMessages),
      targetNodeId: "c",
    });

    expect(result.messages.map(({ sourceId }) => sourceId)).toEqual([
      "b-u", "b-a", "c-u", "c-a",
    ]);
    expect(result.ancestorContext).toEqual([expect.objectContaining({
      id: "a",
      question: "Question a",
      summary: "Summary a",
      depthFromTarget: 2,
    })]);
    expect(result.scope.nodeIds).toEqual(["a", "b", "c"]);
  });

  it("marks broken relationships and unavailable capture as partial", () => {
    const orphan = node("orphan", "gone", 10);
    const report: ReviewCaptureReport = {
      ...capture([message("orphan-u", "user", 0, "orphan")]),
      complete: false,
      stoppedReason: "source_unavailable",
    };
    const result = resolveReviewScope({
      projectId: "project-1",
      scopeType: "current_branch",
      nodes: [orphan],
      capture: report,
      targetNodeId: "orphan",
    });

    expect(result.issues.map(({ code }) => code)).toEqual([
      "SOURCE_UNAVAILABLE",
      "MISSING_PARENT",
    ]);
    expect(result.scope.missingSourceIds).toContain("node:gone");
    expect(result.scope.completeness).toBe("partial");
  });

  it("does not pretend an unsent planned target has a complete source turn", () => {
    const plannedWithLocator = node("planned", "a", 9, {
      kind: "planned",
      messageId: "",
    });
    const { messageLocator: _messageLocator, ...planned } = plannedWithLocator;
    const result = resolveReviewScope({
      projectId: "project-1",
      scopeType: "node_context",
      nodes: [nodes[0]!, planned],
      capture: capture(allMessages.slice(0, 2)),
      targetNodeId: "planned",
    });

    expect(result.scope.missingSourceIds).toContain("node:planned");
    expect(result.scope.completeness).toBe("partial");
  });

  it("builds stable family keys and source hashes from identity metadata", () => {
    const key = createScopeFamilyKey({
      projectId: "project:1",
      chatId: "chat/1",
      scopeType: "node_context",
      anchorNodeId: "node 1",
    });
    expect(key).toBe("review-v1:project%3A1:chat%2F1:node_context:node%201");

    const initial = createSourceSnapshotHash(allMessages.slice(0, 2), [nodes[0]!]);
    const sameIdentityDifferentText = createSourceSnapshotHash([
      { ...allMessages[0]!, content: "changed transient text" },
      allMessages[1]!,
    ], [nodes[0]!]);
    const updatedNode = createSourceSnapshotHash(allMessages.slice(0, 2), [
      { ...nodes[0]!, updatedAt: 99 },
    ]);
    expect(sameIdentityDifferentText).toBe(initial);
    expect(updatedNode).not.toBe(initial);
  });
});

function fallbackMessage(
  sourceId: string,
  role: "user" | "assistant",
  ordinal: number,
  fingerprint: string,
): ConversationReviewMessage {
  return {
    sourceId,
    chatId: "chat-1",
    role,
    content: sourceId,
    ordinal,
    locator: {
      version: 1,
      chatId: "chat-1",
      role,
      ordinal,
      fingerprint,
    },
  };
}
