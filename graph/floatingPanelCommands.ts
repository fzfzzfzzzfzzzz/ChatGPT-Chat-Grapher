import type { DiscussionService } from "./discussionService";
import type {
  ExtensionMessage,
  FloatingPanelState,
  PanelActionContext,
  PanelActionErrorCode,
  PanelDeleteResult,
  PanelMutationResponse,
  PanelParentResult,
} from "../shared/messages";
import type { Project, QuestionNode } from "../types/domain";

export type FloatingPanelCommandMessage = Extract<
  ExtensionMessage,
  {
    type:
      | "SELECT_PANEL_PROJECT"
      | "CREATE_PANEL_PROJECT"
      | "RENAME_PANEL_PROJECT"
      | "DELETE_PANEL_PROJECT"
      | "DELETE_PANEL_NODE"
      | "SET_CAPTURE_SERVICE_ENABLED"
      | "IGNORE_PANEL_CURRENT"
      | "SET_PANEL_NODE_STATUS"
      | "SET_PANEL_PARENT";
  }
>;

export type FloatingPanelCommandResult =
  | Record<string, never>
  | { projectId?: string }
  | PanelDeleteResult
  | PanelParentResult
  | { nodeId: string; status: string }
  | { ignoredId: string; kind: "node" | "candidate" }
  | { captureEnabled: boolean };

export type FloatingPanelCommandDependencies = {
  service: DiscussionService;
  getSelectedProject: () => Promise<Project | undefined>;
  setSelectedProjectId: (projectId: string | undefined) => Promise<void>;
  setCaptureEnabled: (enabled: boolean) => Promise<void>;
  getState: (context: PanelActionContext) => Promise<FloatingPanelState>;
};

class PanelCommandError extends Error {
  constructor(
    readonly code: PanelActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export async function executeFloatingPanelCommand(
  message: FloatingPanelCommandMessage,
  dependencies: FloatingPanelCommandDependencies,
): Promise<PanelMutationResponse<FloatingPanelCommandResult>> {
  try {
    switch (message.type) {
      case "SELECT_PANEL_PROJECT":
        return await selectProject(message, dependencies);
      case "CREATE_PANEL_PROJECT":
        return await createProject(message, dependencies);
      case "RENAME_PANEL_PROJECT":
        return await renameProject(message, dependencies);
      case "DELETE_PANEL_PROJECT":
        return await deleteProject(message, dependencies);
      case "DELETE_PANEL_NODE":
        return await deleteNode(message, dependencies);
      case "SET_CAPTURE_SERVICE_ENABLED":
        return await setCaptureEnabled(message, dependencies);
      case "IGNORE_PANEL_CURRENT":
        return await ignoreCurrent(message, dependencies);
      case "SET_PANEL_NODE_STATUS":
        return await setNodeStatus(message, dependencies);
      case "SET_PANEL_PARENT":
        return await setParent(message, dependencies);
    }
  } catch (error) {
    return commandFailure(error);
  }
}

async function selectProject(
  message: Extract<FloatingPanelCommandMessage, { type: "SELECT_PANEL_PROJECT" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const project = await dependencies.service.projects.get(message.projectId);
  if (!project) throw new PanelCommandError("NOT_FOUND", "项目不存在或已被删除。");
  await dependencies.setSelectedProjectId(project.id);
  return success(dependencies, clearViewing(message.context), { projectId: project.id });
}

async function createProject(
  message: Extract<FloatingPanelCommandMessage, { type: "CREATE_PANEL_PROJECT" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const title = message.title.trim();
  if (!title) throw new PanelCommandError("INVALID_OPERATION", "项目名称不能为空。");
  const project = await dependencies.service.createProject(
    title,
    message.goal.trim() || `推进“${title}”相关讨论并保持问题主线清晰。`,
  );
  await dependencies.setSelectedProjectId(project.id);
  return success(dependencies, clearViewing(message.context), { projectId: project.id });
}

async function renameProject(
  message: Extract<FloatingPanelCommandMessage, { type: "RENAME_PANEL_PROJECT" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const title = message.title.trim();
  if (!title) throw new PanelCommandError("INVALID_OPERATION", "项目名称不能为空。");
  const project = await dependencies.service.projects.get(message.projectId);
  if (!project) throw new PanelCommandError("NOT_FOUND", "项目不存在或已被删除。");
  await dependencies.service.updateProject(project.id, { title });
  return success(dependencies, message.context, { projectId: project.id });
}

async function deleteProject(
  message: Extract<FloatingPanelCommandMessage, { type: "DELETE_PANEL_PROJECT" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const [project, selected] = await Promise.all([
    dependencies.service.projects.get(message.projectId),
    dependencies.getSelectedProject(),
  ]);
  if (!project) throw new PanelCommandError("NOT_FOUND", "项目不存在或已被删除。");

  await dependencies.service.deleteProject(project.id);
  let nextProjectId = selected?.id;
  if (selected?.id === project.id) {
    nextProjectId = (await dependencies.service.projects.list())[0]?.id;
    await dependencies.setSelectedProjectId(nextProjectId);
  }
  return success(dependencies, clearViewing(message.context), {
    ...(nextProjectId ? { projectId: nextProjectId } : {}),
  });
}

async function deleteNode(
  message: Extract<FloatingPanelCommandMessage, { type: "DELETE_PANEL_NODE" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const project = await requireSelectedProject(dependencies);
  const node = await dependencies.service.nodes.get(message.nodeId);
  if (!node || node.projectId !== project.id) {
    throw new PanelCommandError("STALE_STATE", "该节点不属于当前项目，请刷新后重试。");
  }
  const children = await dependencies.service.nodes.listChildren(project.id, node.id);
  const projectNodes = message.deleteDescendants
    ? await dependencies.service.nodes.listForProject(project.id)
    : [];
  const subtreeIds = message.deleteDescendants
    ? collectSubtreeIds(projectNodes, node.id)
    : new Set([node.id]);
  const nextViewingNodeId = message.context.viewingNodeId && subtreeIds.has(message.context.viewingNodeId)
    ? node.parentId ?? (message.deleteDescendants ? undefined : children[0]?.id)
    : await retainExistingViewingNode(message.context.viewingNodeId, project.id, dependencies);

  const deletedNodeIds = message.deleteDescendants
    ? await dependencies.service.deleteNodeWithDescendants(node.id)
    : (await dependencies.service.deleteNode(node.id), [node.id]);
  const context = withViewing(message.context, nextViewingNodeId);
  return success(dependencies, context, {
    deletedNodeId: node.id,
    deletedNodeCount: deletedNodeIds.length,
    ...(nextViewingNodeId ? { nextViewingNodeId } : {}),
  } satisfies PanelDeleteResult);
}

function collectSubtreeIds(
  nodes: QuestionNode[],
  rootId: string,
): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids;
}

async function setCaptureEnabled(
  message: Extract<FloatingPanelCommandMessage, { type: "SET_CAPTURE_SERVICE_ENABLED" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  await dependencies.setCaptureEnabled(message.enabled);
  return success(dependencies, message.context, { captureEnabled: message.enabled });
}

async function ignoreCurrent(
  message: Extract<FloatingPanelCommandMessage, { type: "IGNORE_PANEL_CURRENT" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const project = await requireSelectedProject(dependencies);
  if (message.currentCandidateId) {
    const candidate = await dependencies.service.candidates.get(message.currentCandidateId);
    if (!candidate || candidate.projectId !== project.id) {
      throw new PanelCommandError("STALE_STATE", "当前问题已发生变化，请刷新后重试。");
    }
    await dependencies.service.candidates.delete(candidate.id);
    return success(dependencies, clearViewing(message.context), {
      ignoredId: candidate.id,
      kind: "candidate" as const,
    });
  }
  if (message.currentNodeId) {
    const node = await dependencies.service.nodes.get(message.currentNodeId);
    if (!node || node.projectId !== project.id) {
      throw new PanelCommandError("STALE_STATE", "当前问题已发生变化，请刷新后重试。");
    }
    await dependencies.service.deleteNode(node.id);
    return success(dependencies, clearViewing(message.context), {
      ignoredId: node.id,
      kind: "node" as const,
    });
  }
  throw new PanelCommandError("INVALID_OPERATION", "当前没有可忽略的问题。");
}

async function setNodeStatus(
  message: Extract<FloatingPanelCommandMessage, { type: "SET_PANEL_NODE_STATUS" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const project = await requireSelectedProject(dependencies);
  const node = await dependencies.service.nodes.get(message.nodeId);
  if (!node || node.projectId !== project.id) {
    throw new PanelCommandError("STALE_STATE", "该节点不属于当前项目，请刷新后重试。");
  }
  const updated = await dependencies.service.setStatus(node.id, message.status);
  return success(dependencies, message.context, { nodeId: updated.id, status: updated.status });
}

async function setParent(
  message: Extract<FloatingPanelCommandMessage, { type: "SET_PANEL_PARENT" }>,
  dependencies: FloatingPanelCommandDependencies,
) {
  const project = await requireSelectedProject(dependencies);
  if (message.currentNodeId) {
    const node = await dependencies.service.nodes.get(message.currentNodeId);
    if (!node || node.projectId !== project.id) {
      throw new PanelCommandError("STALE_STATE", "当前节点已发生变化，请刷新后重试。");
    }
    try {
      const updated = await dependencies.service.changeParent(node.id, message.parentId, "user");
      return success(dependencies, message.context, {
        nodeId: updated.id,
        parentId: updated.parentId,
      } satisfies PanelParentResult);
    } catch (error) {
      throw parentChangeError(error);
    }
  }
  if (message.currentCandidateId) {
    const candidate = await dependencies.service.candidates.get(message.currentCandidateId);
    if (!candidate || candidate.projectId !== project.id) {
      throw new PanelCommandError("STALE_STATE", "当前候选问题已发生变化，请刷新后重试。");
    }
    try {
      const node = await dependencies.service.promoteCandidate(
        candidate.id,
        message.parentId,
        "user",
      );
      return success(dependencies, withViewing(message.context, node.id), {
        nodeId: node.id,
        parentId: node.parentId,
      } satisfies PanelParentResult);
    } catch (error) {
      throw parentChangeError(error);
    }
  }
  throw new PanelCommandError("INVALID_OPERATION", "当前问题尚不可修改父节点。");
}

async function requireSelectedProject(
  dependencies: FloatingPanelCommandDependencies,
): Promise<Project> {
  const project = await dependencies.getSelectedProject();
  if (!project) throw new PanelCommandError("NOT_FOUND", "当前没有可用项目。");
  return project;
}

async function retainExistingViewingNode(
  viewingNodeId: string | undefined,
  projectId: string,
  dependencies: FloatingPanelCommandDependencies,
): Promise<string | undefined> {
  if (!viewingNodeId) return undefined;
  const viewingNode = await dependencies.service.nodes.get(viewingNodeId);
  return viewingNode?.projectId === projectId ? viewingNode.id : undefined;
}

async function success<T extends FloatingPanelCommandResult>(
  dependencies: FloatingPanelCommandDependencies,
  context: PanelActionContext,
  result: T,
): Promise<PanelMutationResponse<T>> {
  return {
    ok: true,
    state: await dependencies.getState(context),
    result,
  };
}

function withViewing(
  context: PanelActionContext,
  viewingNodeId: string | undefined,
): PanelActionContext {
  const next = { ...context };
  if (viewingNodeId) next.viewingNodeId = viewingNodeId;
  else delete next.viewingNodeId;
  return next;
}

function clearViewing(context: PanelActionContext): PanelActionContext {
  return withViewing(context, undefined);
}

function parentChangeError(error: unknown): PanelCommandError {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("own parent")) {
    return new PanelCommandError("INVALID_OPERATION", "节点不能成为自己的父节点。");
  }
  if (message.includes("cycle")) {
    return new PanelCommandError("INVALID_OPERATION", "更换父节点会形成循环关系。");
  }
  if (message.includes("same project")) {
    return new PanelCommandError("INVALID_OPERATION", "父节点必须属于当前项目。");
  }
  return error instanceof PanelCommandError
    ? error
    : new PanelCommandError("INTERNAL_ERROR", "暂时无法更新父节点，请重试。");
}

function commandFailure(error: unknown): PanelMutationResponse<never> {
  if (error instanceof PanelCommandError) {
    return { ok: false, code: error.code, error: error.message };
  }
  return {
    ok: false,
    code: "INTERNAL_ERROR",
    error: error instanceof Error ? error.message : "操作失败，请重试。",
  };
}
