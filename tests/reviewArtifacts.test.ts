import { describe, expect, it } from "vitest";
import { projectGraphToFlow } from "../graph/layout";
import {
  buildReviewGraphArtifacts,
  reviewArtifactFlowNodeId,
  type ReviewGraphArtifact,
} from "../graph/reviewArtifacts";
import type { QuestionNode, ReviewDocument, ReviewVersion } from "../types/domain";

describe("review graph artifacts", () => {
  it("only projects saved, anchored documents with a valid active version", () => {
    const active = version("active", "visible", "Visible review");
    const stale = version("stale", "visible", "Stale review", 1);
    const documents = [
      document("visible", { activeVersionId: active.id, graphAnchorNodeId: "node-1", savedAt: 0 }),
      document("draft", { activeVersionId: "draft-version", graphAnchorNodeId: "node-1" }),
      document("unanchored", { activeVersionId: "unanchored-version", savedAt: 2 }),
      document("missing-version", {
        activeVersionId: "not-found",
        graphAnchorNodeId: "node-1",
        savedAt: 3,
      }),
    ];

    const artifacts = buildReviewGraphArtifacts(documents, [stale, active]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: "review",
      id: "visible",
      graphAnchorNodeId: "node-1",
      savedAt: 0,
      version: active,
    });
  });

  it("rejects an active version owned by another document or project", () => {
    const mismatchedDocument = version("wrong-document", "other", "Other");
    const mismatchedProject = {
      ...version("wrong-project", "target", "Other project"),
      projectId: "project-2",
    };
    const documents = [
      document("target", {
        activeVersionId: mismatchedDocument.id,
        graphAnchorNodeId: "node-1",
        savedAt: 1,
      }),
      document("target-2", {
        activeVersionId: mismatchedProject.id,
        graphAnchorNodeId: "node-1",
        savedAt: 2,
      }),
    ];

    expect(buildReviewGraphArtifacts(documents, [mismatchedDocument, mismatchedProject])).toEqual([]);
  });

  it("lays out document nodes separately and connects them with a purple dashed source edge", () => {
    const root = question("root");
    const review = artifact("review-1", "root", "Branch retrospective");

    const flow = projectGraphToFlow([root], [review]);
    const reviewNode = flow.nodes.find((node) => node.id === reviewArtifactFlowNodeId(review.id));
    const rootNode = flow.nodes.find((node) => node.id === root.id);
    const reviewEdge = flow.edges.find((edge) => edge.target === reviewNode?.id);

    expect(reviewNode?.data.kind).toBe("review");
    expect(reviewNode?.ariaLabel).toBe("总结：Branch retrospective");
    expect(reviewNode?.style?.background).toBe("#f5f3ff");
    expect(reviewNode?.position.x).toBe((rootNode?.position.x ?? 0) + 270);
    expect(reviewEdge).toMatchObject({
      source: root.id,
      target: reviewArtifactFlowNodeId(review.id),
      animated: false,
      style: { stroke: "#8b5cf6", strokeDasharray: "6 4" },
    });
  });

  it("keeps a saved review visible as an orphan when its source question was deleted", () => {
    const review = artifact("orphan", "deleted-node", "Preserved review");

    const flow = projectGraphToFlow([], [review], undefined, "nodes");

    expect(flow.nodes).toHaveLength(1);
    expect(flow.nodes[0]?.className).toContain("graph-flow-node--review-compact");
    expect(flow.nodes[0]?.style?.background).toBe("#8b5cf6");
    expect(flow.edges).toEqual([]);
  });

  it("marks a saved branch review stale after a later descendant appears", () => {
    const active = {
      ...version("version-1", "review-1", "Branch review"),
      generatedAt: 10,
      scope: {
        ...version("version-1", "review-1", "Branch review").scope,
        anchorNodeId: "node-1",
      },
    };
    const reviewDocument = document("review-1", {
      activeVersionId: active.id,
      graphAnchorNodeId: "node-1",
      savedAt: 10,
    });
    const root = question("node-1");
    const later = {
      ...question("node-2"),
      parentId: root.id,
      messageId: "message-later",
      createdAt: 20,
      updatedAt: 20,
    };

    expect(buildReviewGraphArtifacts([reviewDocument], [active], [root, later])[0]?.stale).toBe(true);
  });
});

function document(
  id: string,
  changes: Partial<ReviewDocument> = {},
): ReviewDocument {
  return {
    id,
    projectId: "project-1",
    chatId: "chat-1",
    scopeFamilyKey: `scope-${id}`,
    entrySource: "side_panel",
    createdAt: 1,
    updatedAt: 1,
    ...changes,
  };
}

function version(
  id: string,
  documentId: string,
  title: string,
  versionNumber = 2,
): ReviewVersion {
  return {
    id,
    documentId,
    projectId: "project-1",
    version: versionNumber,
    title,
    scope: {
      type: "current_branch",
      chatId: "chat-1",
      nodeIds: ["node-1"],
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
    modules: [],
    evidences: [],
    segmented: false,
    segmentCount: 1,
    missingRanges: [],
    generatedAt: 1,
    updatedAt: 1,
  };
}

function artifact(id: string, graphAnchorNodeId: string, title: string): ReviewGraphArtifact {
  const activeVersion = version(`${id}-version`, id, title);
  const reviewDocument = document(id, {
    activeVersionId: activeVersion.id,
    graphAnchorNodeId,
    savedAt: 2,
  });
  return {
    kind: "review",
    id,
    graphAnchorNodeId,
    savedAt: 2,
    document: reviewDocument,
    version: activeVersion,
  };
}

function question(id: string): QuestionNode {
  return {
    id,
    projectId: "project-1",
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
