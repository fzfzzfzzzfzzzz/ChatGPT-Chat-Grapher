import { describe, expect, it } from "vitest";
import {
  buildFloatingPanelReviewArtifacts,
  buildFloatingPanelState,
} from "../graph/floatingPanelState";
import type {
  Project,
  QuestionNode,
  ReviewDocument,
  ReviewVersion,
} from "../types/domain";

const project: Project = {
  id: "project-1",
  title: "Review graph",
  goal: "Keep saved summaries visible.",
  createdAt: 1,
  updatedAt: 1,
};

describe("floating review artifact projection", () => {
  it("projects only saved documents with their valid active versions", () => {
    const savedVersion = version("version-saved", "review-saved", "Branch review");
    const staleVersion = version("version-stale", "review-saved", "Old title");
    const documents = [
      document("review-saved", {
        activeVersionId: savedVersion.id,
        graphAnchorNodeId: "root",
        savedAt: 9,
      }),
      document("review-draft", {
        activeVersionId: "draft-version",
        graphAnchorNodeId: "root",
      }),
      document("review-invalid", {
        activeVersionId: "missing-version",
        graphAnchorNodeId: "root",
        savedAt: 10,
      }),
    ];

    expect(buildFloatingPanelReviewArtifacts(
      project.id,
      documents,
      [staleVersion, savedVersion],
    )).toEqual([{
      id: "review-artifact:review-saved",
      title: "Branch review",
      anchorNodeId: "root",
      documentId: "review-saved",
      versionId: "version-saved",
      savedAt: 9,
    }]);
  });

  it("adds the lightweight artifact projection without exposing review contents", () => {
    const activeVersion = version("version-1", "review-1", "Decision log");
    const state = buildFloatingPanelState({
      project,
      nodes: [question("root")],
      candidates: [],
      reviewDocuments: [document("review-1", {
        activeVersionId: activeVersion.id,
        graphAnchorNodeId: "root",
        savedAt: 12,
      })],
      reviewVersions: [activeVersion],
      chatId: "chat-1",
      mediumConfidence: 0.6,
    });

    expect(state.reviewArtifacts).toEqual([expect.objectContaining({
      documentId: "review-1",
      versionId: "version-1",
      title: "Decision log",
    })]);
    expect(JSON.stringify(state.reviewArtifacts)).not.toContain("Generated overview");
    expect(JSON.stringify(state.reviewArtifacts)).not.toContain("Evidence excerpt");
  });
});

function document(
  id: string,
  changes: Partial<ReviewDocument> = {},
): ReviewDocument {
  return {
    id,
    projectId: project.id,
    chatId: "chat-1",
    scopeFamilyKey: `scope-${id}`,
    entrySource: "floating_panel",
    createdAt: 1,
    updatedAt: 1,
    ...changes,
  };
}

function version(id: string, documentId: string, title: string): ReviewVersion {
  return {
    id,
    documentId,
    projectId: project.id,
    version: 1,
    title,
    scope: {
      type: "current_branch",
      chatId: "chat-1",
      nodeIds: ["root"],
      messageSourceIds: [],
      messageCount: 0,
      nodeCount: 1,
      includesOtherBranches: false,
      completeness: "complete",
      missingSourceIds: [],
      estimatedTokens: 0,
      sourceSnapshotHash: "hash",
    },
    moduleOrder: [],
    modules: [{
      moduleId: "discussion_overview",
      state: "completed",
      generated: { overview: "Generated overview", items: [] },
      current: { overview: "Generated overview", items: [] },
      editHistory: [],
    }],
    evidences: [{
      id: "evidence-1",
      sourceId: "source-1",
      chatId: "chat-1",
      role: "assistant",
      excerpt: "Evidence excerpt",
      ordinal: 1,
      locator: {
        version: 1,
        chatId: "chat-1",
        role: "assistant",
        ordinal: 1,
        fingerprint: "fingerprint",
      },
    }],
    segmented: false,
    segmentCount: 1,
    missingRanges: [],
    generatedAt: 1,
    updatedAt: 1,
  };
}

function question(id: string): QuestionNode {
  return {
    id,
    projectId: project.id,
    parentId: null,
    question: "Root question",
    summary: "Root summary",
    status: "pending",
    chatId: "chat-1",
    messageId: "message-root",
    createdAt: 1,
    updatedAt: 1,
  };
}
