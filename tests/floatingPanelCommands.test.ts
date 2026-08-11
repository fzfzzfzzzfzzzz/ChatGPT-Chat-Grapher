import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiscussionMapDatabase } from "../db/database";
import { DiscussionService } from "../graph/discussionService";
import { executeFloatingPanelCommand } from "../graph/floatingPanelCommands";
import { buildFloatingPanelState, emptyFloatingPanelState } from "../graph/floatingPanelState";
import type { PanelActionContext } from "../shared/messages";

describe("floating panel commands", () => {
  let database: DiscussionMapDatabase;
  let service: DiscussionService;
  let selectedProjectId: string | undefined;
  let captureEnabled: boolean;

  beforeEach(() => {
    database = new DiscussionMapDatabase(`panel-commands-${crypto.randomUUID()}`);
    service = new DiscussionService(database);
    selectedProjectId = undefined;
    captureEnabled = true;
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  function captured(question: string, index: number, chatId = "chat-1") {
    return {
      question,
      chatId,
      messageId: `message-${index}`,
      messageAnchor: `user:${index}:anchor-${index}`,
    };
  }

  function dependencies() {
    return {
      service,
      getSelectedProject: async () => selectedProjectId
        ? service.projects.get(selectedProjectId)
        : undefined,
      setSelectedProjectId: async (projectId: string | undefined) => {
        selectedProjectId = projectId;
      },
      setCaptureEnabled: async (enabled: boolean) => {
        captureEnabled = enabled;
      },
      getState: async (context: PanelActionContext) => {
        const projects = await service.projects.list();
        const project = selectedProjectId
          ? await service.projects.get(selectedProjectId)
          : undefined;
        if (!project) return emptyFloatingPanelState("Chat Graph", projects, captureEnabled);
        const [nodes, candidates] = await Promise.all([
          service.nodes.listForProject(project.id),
          service.candidates.listForProject(project.id),
        ]);
        return buildFloatingPanelState({
          project,
          projects,
          nodes,
          candidates,
          captureEnabled,
          mediumConfidence: 0.5,
          ...(context.chatId ? { chatId: context.chatId } : {}),
          ...(context.viewingNodeId ? { selectedNodeId: context.viewingNodeId } : {}),
        });
      },
    };
  }

  it("returns authoritative state when status changes without changing project focus", async () => {
    const project = await service.createProject("Project", "Goal");
    selectedProjectId = project.id;
    const first = await service.createNode({ projectId: project.id, ...captured("First", 1) });
    const second = await service.createNode({
      projectId: project.id,
      parentId: first.id,
      ...captured("Second", 2),
    });

    const response = await executeFloatingPanelCommand({
      type: "SET_PANEL_NODE_STATUS",
      nodeId: first.id,
      status: "pending",
      context: { chatId: "chat-1", viewingNodeId: first.id },
    }, dependencies());

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.state.viewingNodeId).toBe(first.id);
    expect(response.state.focusedNodeId).toBe(second.id);
    expect(response.state.graphNodes.find((node) => node.id === first.id)?.status).toBe("pending");
    expect(response.state.graphNodes.find((node) => node.id === second.id)?.status).toBe("pending");
  });

  it("deletes a viewed node, reparents children and returns the next viewed node", async () => {
    const project = await service.createProject("Project", "Goal");
    selectedProjectId = project.id;
    const root = await service.createNode({ projectId: project.id, ...captured("Root", 1) });
    const parent = await service.createNode({
      projectId: project.id,
      parentId: root.id,
      ...captured("Parent", 2),
    });
    const child = await service.createNode({
      projectId: project.id,
      parentId: parent.id,
      ...captured("Child", 3),
    });

    const response = await executeFloatingPanelCommand({
      type: "DELETE_PANEL_NODE",
      nodeId: parent.id,
      context: { chatId: "chat-1", viewingNodeId: parent.id },
    }, dependencies());

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result).toMatchObject({
      deletedNodeId: parent.id,
      nextViewingNodeId: root.id,
    });
    expect(response.state.viewingNodeId).toBe(root.id);
    expect((await service.nodes.get(child.id))?.parentId).toBe(root.id);
  });

  it("deletes a viewed node and all descendants when requested", async () => {
    const project = await service.createProject("Project", "Goal");
    selectedProjectId = project.id;
    const root = await service.createNode({ projectId: project.id, ...captured("Root", 1) });
    const parent = await service.createNode({ projectId: project.id, parentId: root.id, ...captured("Parent", 2) });
    const child = await service.createNode({ projectId: project.id, parentId: parent.id, ...captured("Child", 3) });

    const response = await executeFloatingPanelCommand({
      type: "DELETE_PANEL_NODE",
      nodeId: parent.id,
      deleteDescendants: true,
      context: { chatId: "chat-1", viewingNodeId: parent.id },
    }, dependencies());

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result).toMatchObject({
      deletedNodeId: parent.id,
      deletedNodeCount: 2,
      nextViewingNodeId: root.id,
    });
    expect(await service.nodes.get(parent.id)).toBeUndefined();
    expect(await service.nodes.get(child.id)).toBeUndefined();
    expect(response.state.graphNodes.map((node) => node.id)).toEqual([root.id]);
  });

  it("promotes a candidate while changing its parent and returns the new node", async () => {
    const project = await service.createProject("Project", "Goal");
    selectedProjectId = project.id;
    const root = await service.createNode({ projectId: project.id, ...captured("Root", 1) });
    const candidate = await service.createCandidate(project.id, captured("Candidate", 2));

    const response = await executeFloatingPanelCommand({
      type: "SET_PANEL_PARENT",
      currentCandidateId: candidate.id,
      parentId: root.id,
      context: { chatId: "chat-1" },
    }, dependencies());

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result).toMatchObject({ parentId: root.id });
    expect(response.state.viewingNodeId).toBe("nodeId" in response.result
      ? response.result.nodeId
      : undefined);
    expect(await service.candidates.get(candidate.id)).toBeUndefined();
  });

  it("returns fresh state for project and capture commands without a broadcast", async () => {
    const first = await service.createProject("First", "Goal");
    const second = await service.createProject("Second", "Goal");
    selectedProjectId = first.id;

    const selected = await executeFloatingPanelCommand({
      type: "SELECT_PANEL_PROJECT",
      projectId: second.id,
      context: {},
    }, dependencies());
    expect(selected.ok && selected.state.projectId).toBe(second.id);

    const paused = await executeFloatingPanelCommand({
      type: "SET_CAPTURE_SERVICE_ENABLED",
      enabled: false,
      context: {},
    }, dependencies());
    expect(paused.ok && paused.state.captureEnabled).toBe(false);

    const removed = await executeFloatingPanelCommand({
      type: "DELETE_PANEL_PROJECT",
      projectId: second.id,
      context: {},
    }, dependencies());
    expect(removed.ok && removed.state.projectId).toBe(first.id);
  });

  it("renames an existing project and returns the updated project list", async () => {
    const project = await service.createProject("Old name", "Goal");
    selectedProjectId = project.id;

    const response = await executeFloatingPanelCommand({
      type: "RENAME_PANEL_PROJECT",
      projectId: project.id,
      title: "  New name  ",
      context: {},
    }, dependencies());

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.state.projectTitle).toBe("New name");
    expect(response.state.projects).toContainEqual({ id: project.id, title: "New name" });
    expect((await service.projects.get(project.id))?.title).toBe("New name");
  });

  it("rejects stale cross-project node operations without changing data", async () => {
    const first = await service.createProject("First", "Goal");
    const second = await service.createProject("Second", "Goal");
    selectedProjectId = first.id;
    const otherNode = await service.createNode({
      projectId: second.id,
      ...captured("Other", 1),
    });

    const response = await executeFloatingPanelCommand({
      type: "DELETE_PANEL_NODE",
      nodeId: otherNode.id,
      context: {},
    }, dependencies());

    expect(response).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(await service.nodes.get(otherNode.id)).toBeDefined();
  });
});
