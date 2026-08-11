import { describe, expect, it } from "vitest";
import { buildFloatingPanelState } from "../graph/floatingPanelState";
import type { Project, QuestionCandidate, QuestionNode } from "../types/domain";

const project: Project = {
  id: "project-1",
  title: "Chat Graph",
  goal: "Keep the current discussion visible.",
  focusNodeId: "node-parent",
  createdAt: 1,
  updatedAt: 1,
};

function node(
  id: string,
  question: string,
  createdAt: number,
  parentId: string | null = null,
): QuestionNode {
  return {
    id,
    projectId: project.id,
    parentId,
    question,
    summary: `Summary: ${question}`,
    status: "pending",
    chatId: "chat-1",
    messageId: `message-${id}`,
    createdAt,
    updatedAt: createdAt,
  };
}

function candidate(
  overrides: Partial<QuestionCandidate> = {},
): QuestionCandidate {
  return {
    id: "candidate-1",
    projectId: project.id,
    question: "浮窗应该展示什么？",
    summary: "确定常驻浮窗中的核心信息。",
    chatId: "chat-1",
    messageId: "message-new",
    recommendations: [],
    noParentConfidence: 0,
    status: "processing",
    createdAt: 3,
    updatedAt: 3,
    ...overrides,
  };
}

describe("v0.6 floating panel state", () => {
  it("exposes the persisted capture-service state to the floating panel", () => {
    const state = buildFloatingPanelState({
      captureEnabled: false,
      project,
      nodes: [],
      candidates: [],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.captureEnabled).toBe(false);
  });

  it("provides every project for the header switcher", () => {
    const secondProject: Project = {
      id: "project-2",
      title: "联合项目",
      goal: "联合推进多个讨论项目。",
      createdAt: 2,
      updatedAt: 2,
    };
    const state = buildFloatingPanelState({
      project,
      projects: [project, secondProject],
      nodes: [],
      candidates: [],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.projects).toEqual([
      { id: project.id, title: project.title },
      { id: secondProject.id, title: secondProject.title },
    ]);
  });

  it("provides the complete current-project structure for the compact graph", () => {
    const root = node("node-root", "根问题", 1);
    const child = node("node-child", "子问题", 2, root.id);
    const state = buildFloatingPanelState({
      project,
      nodes: [child, root],
      candidates: [],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.graphNodes).toEqual([
      {
        id: root.id,
        parentId: null,
        question: root.question,
        status: root.status,
      },
      {
        id: child.id,
        parentId: root.id,
        question: child.question,
        status: child.status,
      },
    ]);
  });

  it("does not leak the previous chat context when the current URL has no conversation", () => {
    const state = buildFloatingPanelState({
      project,
      nodes: [node("node-old", "旧聊天问题", 1)],
      candidates: [],
      mediumConfidence: 0.6,
    });

    expect(state.projectTitle).toBe("Chat Graph");
    expect(state.projects).toEqual([{ id: project.id, title: project.title }]);
    expect(state.currentQuestion).toBeUndefined();
    expect(state.parentState).toBe("empty");
  });

  it("shows a graph-selected node as Current without changing the project focus", () => {
    const root = node("node-root", "根问题", 1);
    const selected = node("node-selected", "需要修改 Parent 的历史问题", 2, root.id);
    const descendant = node("node-descendant", "历史问题的子节点", 3, selected.id);
    const latestNode = node("node-latest", "页面中的最新问题", 4, root.id);
    const state = buildFloatingPanelState({
      project: { ...project, focusNodeId: latestNode.id },
      nodes: [root, selected, descendant, latestNode],
      candidates: [],
      chatId: "chat-1",
      selectedNodeId: selected.id,
      mediumConfidence: 0.6,
    });

    expect(state.viewingNodeId).toBe(selected.id);
    expect(state.currentNodeId).toBe(selected.id);
    expect(state.currentQuestion).toBe(selected.question);
    expect(state.parentId).toBe(root.id);
    expect(state.focusedNodeId).toBe(latestNode.id);
    expect(state.latestQuestionKey).toBe(JSON.stringify([latestNode.chatId, latestNode.messageId]));
    expect(state.parentOptions.map(({ id }) => id)).not.toContain(selected.id);
    expect(state.parentOptions.map(({ id }) => id)).not.toContain(descendant.id);
  });

  it("allows a graph-selected node to be viewed without a conversation URL", () => {
    const selected = node("node-selected", "项目中的历史问题", 1);
    const state = buildFloatingPanelState({
      project,
      nodes: [selected],
      candidates: [],
      selectedNodeId: selected.id,
      mediumConfidence: 0.6,
    });

    expect(state.viewingNodeId).toBe(selected.id);
    expect(state.currentNodeId).toBe(selected.id);
    expect(state.currentQuestion).toBe(selected.question);
  });

  it("falls back to the latest question when the selected node no longer exists", () => {
    const latestNode = node("node-latest", "页面中的最新问题", 2);
    const state = buildFloatingPanelState({
      project,
      nodes: [latestNode],
      candidates: [],
      chatId: "chat-1",
      selectedNodeId: "missing-node",
      mediumConfidence: 0.6,
    });

    expect(state.viewingNodeId).toBeUndefined();
    expect(state.currentNodeId).toBe(latestNode.id);
  });

  it("shows a newly captured Candidate immediately while analysis is still running", () => {
    const parent = node("node-parent", "插件浮窗应该采用什么形式？", 1);
    const state = buildFloatingPanelState({
      project,
      nodes: [parent],
      candidates: [candidate()],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.currentCandidateId).toBe("candidate-1");
    expect(state.currentQuestion).toBe("浮窗应该展示什么？");
    expect(state.currentSummary).toBeUndefined();
    expect(state.parentState).toBe("processing");
  });

  it("keeps the latest-question key stable when a Candidate becomes a Node", () => {
    const pendingState = buildFloatingPanelState({
      project,
      nodes: [node("node-parent", "上一问", 1)],
      candidates: [candidate()],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });
    const promoted = {
      ...node("node-promoted", "浮窗应该展示什么？", 4),
      messageId: "message-new",
    };
    const promotedState = buildFloatingPanelState({
      project,
      nodes: [node("node-parent", "上一问", 1), promoted],
      candidates: [],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(pendingState.latestQuestionKey).toBe(promotedState.latestQuestionKey);
  });

  it("exposes only a small confirmation set for medium-confidence recommendations", () => {
    const parent = node("node-parent", "插件浮窗应该采用什么形式？", 1);
    const sibling = node("node-sibling", "插件整体 UI", 2);
    const state = buildFloatingPanelState({
      project,
      nodes: [parent, sibling],
      candidates: [
        candidate({
          status: "inbox",
          recommendations: [
            { nodeId: parent.id, confidence: 0.78 },
            { nodeId: sibling.id, confidence: 0.66 },
          ],
          noParentConfidence: 0.15,
        }),
      ],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.parentState).toBe("selecting");
    expect(state.recommendedParents.map(({ id }) => id)).toEqual([
      sibling.id,
      parent.id,
    ]);
    expect(state.recommendedParents[0]?.isPrevious).toBe(true);
    expect(state.rootConfidence).toBe(0.15);
  });

  it("puts the previous eligible question first before confidence-ranked alternatives", () => {
    const previous = node("node-previous", "上一问", 3);
    const strongestMatch = {
      ...node("node-strongest", "最高置信度匹配", 1),
      chatId: "chat-2",
    };
    const secondMatch = {
      ...node("node-second", "第二置信度匹配", 2),
      chatId: "chat-2",
    };
    const state = buildFloatingPanelState({
      project,
      nodes: [strongestMatch, secondMatch, previous],
      candidates: [
        candidate({
          createdAt: 4,
          updatedAt: 4,
          status: "inbox",
          recommendations: [
            { nodeId: secondMatch.id, confidence: 0.71 },
            { nodeId: previous.id, confidence: 0.32 },
            { nodeId: strongestMatch.id, confidence: 0.91 },
          ],
          noParentConfidence: 0.85,
        }),
      ],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.parentState).toBe("selecting");
    expect(state.recommendedParents).toEqual([
      {
        id: previous.id,
        question: previous.question,
        confidence: 0.32,
        isPrevious: true,
      },
      {
        id: strongestMatch.id,
        question: strongestMatch.question,
        confidence: 0.91,
      },
      {
        id: secondMatch.id,
        question: secondMatch.question,
        confidence: 0.71,
      },
    ]);
  });

  it("restores a completed previous question as a Parent candidate", () => {
    const completedPrevious = {
      ...node("node-completed-previous", "刚刚结束的上一问", 3),
      status: "resolved" as const,
    };
    const availableMatch = {
      ...node("node-available-match", "可用匹配", 2),
      chatId: "chat-2",
    };
    const state = buildFloatingPanelState({
      project,
      nodes: [availableMatch, completedPrevious],
      candidates: [
        candidate({
          createdAt: 4,
          updatedAt: 4,
          status: "inbox",
          recommendations: [
            { nodeId: completedPrevious.id, confidence: 0.95 },
            { nodeId: availableMatch.id, confidence: 0.74 },
          ],
        }),
      ],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.recommendedParents).toEqual([
      {
        id: completedPrevious.id,
        question: completedPrevious.question,
        confidence: 0.95,
        isPrevious: true,
      },
      {
        id: availableMatch.id,
        question: availableMatch.question,
        confidence: 0.74,
      },
    ]);
  });

  it("keeps completed nodes available in Parent choices", () => {
    const completed = { ...node("node-completed", "已结束问题", 1), status: "resolved" as const };
    const available = { ...node("node-available", "仍可继续的问题", 2), status: "pending" as const };
    const state = buildFloatingPanelState({
      project,
      nodes: [completed, available],
      candidates: [
        candidate({
          status: "inbox",
          recommendations: [
            { nodeId: completed.id, confidence: 0.91 },
            { nodeId: available.id, confidence: 0.76 },
          ],
        }),
      ],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.graphNodes.map(({ id }) => id)).toContain(completed.id);
    expect(state.recommendedParents.map(({ id }) => id)).toEqual([available.id, completed.id]);
    expect(state.parentOptions.map(({ id }) => id)).toEqual([available.id, completed.id]);
  });

  it("keeps Parent tied to Current even when Focus points elsewhere", () => {
    const root = node("node-root", "Root question", 1);
    const current = node("node-current", "Current question", 2, root.id);
    const child = node("node-child", "Child question", 1, current.id);
    const state = buildFloatingPanelState({
      project: { ...project, focusNodeId: root.id },
      nodes: [root, current, child],
      candidates: [],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.currentNodeId).toBe(current.id);
    expect(state.focusedNodeId).toBe(root.id);
    expect(state.parentId).toBe(root.id);
    expect(state.parentQuestion).toBe(root.question);
    expect(state.parentSummary).toBe(root.summary);
    expect(state.parentOptions.map(({ id }) => id)).not.toContain(child.id);
  });

  it("keeps Current usable and marks Parent unresolved after an API failure", () => {
    const state = buildFloatingPanelState({
      project,
      nodes: [],
      candidates: [candidate({ status: "failed" })],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.currentQuestion).toBe("浮窗应该展示什么？");
    expect(state.currentSummary).toBe("确定常驻浮窗中的核心信息。");
    expect(state.parentState).toBe("unresolved");
  });
});
