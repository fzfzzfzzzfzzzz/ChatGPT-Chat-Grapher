// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationReviewMessage,
  QuestionNode,
  ReviewCaptureReport,
  ReviewDocument,
  ReviewJob,
  ReviewScope,
  ReviewVersion,
} from "../types/domain";

const browserMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  cancelReviewJob: vi.fn(),
  listenForReviewJob: vi.fn(),
  requestReviewProviderPermission: vi.fn(),
  uploadReviewSourceAndStart: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: browserMocks.sendMessage,
    },
    storage: {
      local: {
        get: browserMocks.storageGet,
        set: browserMocks.storageSet,
      },
    },
  },
}));

vi.mock("../review/runtime", () => runtimeMocks);

import { useConversationReview } from "../components/useConversationReview";

beforeEach(() => {
  vi.clearAllMocks();
  browserMocks.storageGet.mockResolvedValue({});
  browserMocks.storageSet.mockResolvedValue(undefined);
  browserMocks.sendMessage.mockImplementation((message: { type?: string }) => {
    if (message.type === "GET_PROJECT_REVIEWS") {
      return Promise.resolve({ ok: true, documents: [], versions: [], jobs: [] });
    }
    return Promise.resolve({ ok: true });
  });
  runtimeMocks.requestReviewProviderPermission.mockResolvedValue(true);
  runtimeMocks.listenForReviewJob.mockReturnValue(() => undefined);
});

afterEach(cleanup);

describe("useConversationReview source lifecycle", () => {
  it("opens a saved document from persisted metadata without collecting source text", async () => {
    const collectSource = vi.fn();
    const savedScope = scope("chat-a", "a", "saved-snapshot");
    const savedVersion = version(savedScope);
    const savedDocument = document(savedScope);
    browserMocks.sendMessage.mockImplementation((message: { type?: string }) => {
      if (message.type === "GET_PROJECT_REVIEWS") {
        return Promise.resolve({
          ok: true,
          documents: [savedDocument],
          versions: [savedVersion],
          jobs: [],
        });
      }
      return Promise.resolve({ ok: true });
    });
    const { result } = renderHook(() => useConversationReview({
      projectId: "project-1",
      nodes: [node("a", "chat-a")],
      entrySource: "side_panel",
      defaultAnchorNodeId: "a",
      collectSource,
    }));

    act(() => result.current.openReview({
      documentId: savedDocument.id,
      anchorNodeId: "a",
    }));

    await waitFor(() => expect(result.current.dialogProps?.version?.id).toBe(savedVersion.id));
    expect(collectSource).not.toHaveBeenCalled();
    expect(result.current.dialogProps?.scope).toMatchObject({
      chatId: "chat-a",
      messageCount: 2,
      sourceSnapshotHash: "saved-snapshot",
    });
  });

  it("keeps a cross-chat node anchored to its source and never reuses the previous capture", async () => {
    const firstCapture = capture("chat-a", "a");
    const secondCollection = deferred<ReviewCaptureReport>();
    const collectSource = vi.fn()
      .mockResolvedValueOnce(firstCapture)
      .mockReturnValueOnce(secondCollection.promise);
    const onError = vi.fn();
    const nodes = [node("a", "chat-a"), node("b", "chat-b")];
    const { result } = renderHook(() => useConversationReview({
      projectId: "project-1",
      nodes,
      entrySource: "side_panel",
      defaultAnchorNodeId: "a",
      collectSource,
      onError,
    }));

    act(() => result.current.openReview({
      anchorNodeId: "a",
      entrySource: "node_menu",
    }));
    await waitFor(() => expect(result.current.dialogProps?.scope.messageCount).toBe(2));

    act(() => result.current.openReview({
      anchorNodeId: "b",
      entrySource: "node_menu",
    }));

    await waitFor(() => {
      expect(collectSource).toHaveBeenNthCalledWith(2, "chat-b");
      expect(result.current.dialogProps?.scope).toMatchObject({
        chatId: "chat-b",
        anchorNodeId: "b",
        messageCount: 0,
        completeness: "partial",
      });
    });

    await act(async () => {
      secondCollection.resolve(firstCapture);
      await secondCollection.promise;
    });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(
      "当前标签不是目标节点的来源会话，请打开对应的 ChatGPT 会话后重试。",
    ));
    expect(result.current.dialogProps?.scope).toMatchObject({
      chatId: "chat-b",
      messageCount: 0,
    });
  });

  it.each([
    "completed",
    "partial",
    "cancelled",
    "failed",
    "interrupted",
  ] as const)("releases capture at terminal state %s without degrading persisted scope metadata", async (
    terminalStatus,
  ) => {
    const collectSource = vi.fn().mockResolvedValue(capture("chat-a", "a"));
    const nodes = [node("a", "chat-a")];
    const { result } = renderHook(() => useConversationReview({
      projectId: "project-1",
      nodes,
      entrySource: "side_panel",
      defaultAnchorNodeId: "a",
      collectSource,
    }));

    act(() => result.current.openReview({
      anchorNodeId: "a",
      scopeType: "current_branch",
    }));
    await waitFor(() => expect(result.current.dialogProps?.scope.messageCount).toBe(2));
    const capturedScope = structuredClone(result.current.dialogProps!.scope);
    const persistedScope = capturedScope;
    const activeJob = job(persistedScope, "generating");
    const persistedVersion = version(persistedScope);
    runtimeMocks.uploadReviewSourceAndStart.mockResolvedValue({
      ok: true,
      job: activeJob,
      version: persistedVersion,
    });

    await act(async () => {
      await result.current.dialogProps?.onGenerate({
        scopeType: "current_branch",
        presetId: "general",
        moduleIds: ["discussion_overview"],
        allowPartial: false,
      });
    });
    await waitFor(() => {
      expect(result.current.dialogProps?.stale).toBe(false);
      expect(runtimeMocks.listenForReviewJob).toHaveBeenCalled();
    });

    const listener = runtimeMocks.listenForReviewJob.mock.calls.at(-1)?.[1] as (
      nextJob: ReviewJob,
      nextVersion?: ReviewVersion,
    ) => void;
    act(() => listener({
      ...activeJob,
      status: terminalStatus,
      completedAt: 3,
      updatedAt: 3,
    }, persistedVersion));

    await waitFor(() => {
      expect(result.current.dialogProps?.stale).toBe(false);
      expect(result.current.dialogProps?.scope).toMatchObject({
        chatId: "chat-a",
        messageCount: 2,
        completeness: "complete",
        sourceSnapshotHash: capturedScope.sourceSnapshotHash,
      });
    });
  });

  it.each(["permission", "upload"] as const)(
    "releases capture after a %s failure so the next generate recollects",
    async (failurePoint) => {
      const collectSource = vi.fn().mockResolvedValue(capture("chat-a", "a"));
      const onError = vi.fn();
      if (failurePoint === "permission") {
        runtimeMocks.requestReviewProviderPermission.mockRejectedValue(new Error("permission failed"));
      } else {
        runtimeMocks.uploadReviewSourceAndStart.mockResolvedValue({
          ok: false,
          error: "upload failed",
        });
      }
      const { result } = renderHook(() => useConversationReview({
        projectId: "project-1",
        nodes: [node("a", "chat-a")],
        entrySource: "side_panel",
        defaultAnchorNodeId: "a",
        collectSource,
        onError,
      }));

      act(() => result.current.openReview({ anchorNodeId: "a" }));
      await waitFor(() => expect(result.current.dialogProps?.scope.messageCount).toBe(2));
      const request = {
        scopeType: "current_branch" as const,
        presetId: "general" as const,
        moduleIds: ["discussion_overview" as const],
        allowPartial: false,
      };

      await act(async () => {
        await result.current.dialogProps?.onGenerate(request);
      });
      expect(collectSource).toHaveBeenCalledTimes(1);
      expect(result.current.dialogProps?.scope.messageCount).toBe(2);

      await act(async () => {
        await result.current.dialogProps?.onGenerate(request);
      });
      expect(collectSource).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalled();
    },
  );

  it("does not let a terminal update invalidate source collection during an explicit retry", async () => {
    const retryCapture = deferred<ReviewCaptureReport>();
    const collectSource = vi.fn()
      .mockResolvedValueOnce(capture("chat-a", "a"))
      .mockReturnValueOnce(retryCapture.promise);
    const { result } = renderHook(() => useConversationReview({
      projectId: "project-1",
      nodes: [node("a", "chat-a")],
      entrySource: "side_panel",
      defaultAnchorNodeId: "a",
      collectSource,
    }));

    act(() => result.current.openReview({ anchorNodeId: "a" }));
    await waitFor(() => expect(result.current.dialogProps?.scope.messageCount).toBe(2));
    const generatedScope = structuredClone(result.current.dialogProps!.scope);
    const activeJob = job(generatedScope, "generating");
    const generatedVersion = version(generatedScope);
    runtimeMocks.uploadReviewSourceAndStart
      .mockResolvedValueOnce({ ok: true, job: activeJob, version: generatedVersion })
      .mockResolvedValueOnce({
        ok: true,
        job: { ...activeJob, id: "job-retry", updatedAt: 4 },
        version: generatedVersion,
      });

    await act(async () => {
      await result.current.dialogProps?.onGenerate({
        scopeType: "current_branch",
        presetId: "general",
        moduleIds: ["discussion_overview"],
        allowPartial: false,
      });
    });
    await waitFor(() => expect(runtimeMocks.listenForReviewJob).toHaveBeenCalled());
    const listener = runtimeMocks.listenForReviewJob.mock.calls.at(-1)?.[1] as (
      nextJob: ReviewJob,
      nextVersion?: ReviewVersion,
    ) => void;

    let retryPromise!: Promise<void>;
    act(() => {
      retryPromise = Promise.resolve(result.current.dialogProps?.onRetryAll?.());
    });
    await waitFor(() => expect(collectSource).toHaveBeenCalledTimes(2));
    act(() => listener({
      ...activeJob,
      status: "completed",
      completedAt: 3,
      updatedAt: 3,
    }, generatedVersion));

    await act(async () => {
      retryCapture.resolve(capture("chat-a", "a"));
      await retryPromise;
    });

    expect(runtimeMocks.uploadReviewSourceAndStart).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.uploadReviewSourceAndStart.mock.calls[1]?.[1]).toMatchObject({
      retryJobId: "job-1",
    });
  });
});

function node(id: string, chatId: string): QuestionNode {
  return {
    id,
    projectId: "project-1",
    parentId: null,
    question: `Question ${id}`,
    summary: `Summary ${id}`,
    status: "pending",
    chatId,
    messageId: `message-${id}`,
    messageLocator: {
      version: 1,
      messageId: `message-${id}`,
      turnId: `turn-${id}`,
      ordinal: 0,
      fingerprint: `fingerprint-${id}`,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function capture(chatId: string, nodeId: string): ReviewCaptureReport {
  return {
    chatId,
    messages: [
      message(chatId, nodeId, "user", 0),
      message(chatId, nodeId, "assistant", 1),
    ],
    complete: true,
    missingSourceIds: [],
  };
}

function message(
  chatId: string,
  nodeId: string,
  role: "user" | "assistant",
  ordinal: number,
): ConversationReviewMessage {
  return {
    sourceId: `${chatId}-${role}`,
    chatId,
    role,
    content: `${role} private source text`,
    ordinal,
    locator: {
      version: 1,
      chatId,
      role,
      messageId: role === "user" ? `message-${nodeId}` : `answer-${nodeId}`,
      turnId: `turn-${nodeId}`,
      ordinal,
      fingerprint: `${role}-${nodeId}`,
    },
    ...(role === "user" ? { nodeId } : {}),
  };
}

function job(scope: ReviewScope, status: ReviewJob["status"]): ReviewJob {
  return {
    id: "job-1",
    projectId: "project-1",
    documentId: "document-1",
    scopeFamilyKey: "family-1",
    scope,
    selectedModuleIds: ["discussion_overview"],
    presetId: "general",
    status,
    progress: { current: 1, total: 1, message: "Generating" },
    moduleStates: { discussion_overview: "generating" },
    createdAt: 1,
    startedAt: 1,
    updatedAt: 2,
  };
}

function scope(chatId: string, anchorNodeId: string, sourceSnapshotHash: string): ReviewScope {
  return {
    type: "current_branch",
    chatId,
    anchorNodeId,
    rootNodeId: anchorNodeId,
    nodeIds: [anchorNodeId],
    messageSourceIds: [`${chatId}-user`, `${chatId}-assistant`],
    messageCount: 2,
    nodeCount: 1,
    includesOtherBranches: false,
    completeness: "complete",
    missingSourceIds: [],
    estimatedTokens: 20,
    sourceSnapshotHash,
  };
}

function document(savedScope: ReviewScope): ReviewDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    chatId: savedScope.chatId,
    scopeFamilyKey: "family-1",
    entrySource: "side_panel",
    activeVersionId: "version-1",
    ...(savedScope.anchorNodeId ? { graphAnchorNodeId: savedScope.anchorNodeId } : {}),
    savedAt: 2,
    createdAt: 1,
    updatedAt: 2,
  };
}

function version(scope: ReviewScope): ReviewVersion {
  const snapshot = { overview: "Summary", items: [] };
  return {
    id: "version-1",
    documentId: "document-1",
    projectId: "project-1",
    version: 1,
    title: "Conversation review",
    scope,
    moduleOrder: ["discussion_overview"],
    modules: [{
      moduleId: "discussion_overview",
      state: "completed",
      generated: snapshot,
      current: snapshot,
      editHistory: [],
    }],
    evidences: [],
    segmented: false,
    segmentCount: 1,
    missingRanges: [],
    generatedAt: 2,
    updatedAt: 2,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
