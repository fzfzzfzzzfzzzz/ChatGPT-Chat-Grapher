import type { ProjectRepository } from "../db/repositories/projectRepository";
import type { Project } from "../types/domain";

export const TAB_PROJECT_KEY_PREFIX = "tabProjectId:";
export const TAB_CAPTURE_KEY_PREFIX = "tabCaptureEnabled:";

export type SessionStorage = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

/**
 * Runtime-only state for a ChatGPT tab. A new tab intentionally has no
 * selected project, while capture defaults to enabled once a project is
 * explicitly selected.
 */
export class TabDiscussionSession {
  constructor(
    private readonly projects: Pick<ProjectRepository, "get">,
    private readonly storage: SessionStorage,
  ) {}

  async getProject(tabId: number): Promise<Project | undefined> {
    const key = tabProjectKey(tabId);
    const stored = await this.storage.get(key);
    const projectId = stored[key];
    if (typeof projectId !== "string") return undefined;

    const project = await this.projects.get(projectId);
    if (project) return project;
    await this.storage.remove(key);
    return undefined;
  }

  async setProjectId(tabId: number, projectId: string | undefined): Promise<void> {
    const key = tabProjectKey(tabId);
    if (projectId) await this.storage.set({ [key]: projectId });
    else await this.storage.remove(key);
  }

  async isCaptureEnabled(tabId: number): Promise<boolean> {
    const key = tabCaptureKey(tabId);
    const stored = await this.storage.get(key);
    return stored[key] !== false;
  }

  async setCaptureEnabled(tabId: number, enabled: boolean): Promise<void> {
    await this.storage.set({ [tabCaptureKey(tabId)]: enabled });
  }

  clear(tabId: number): Promise<void> {
    return this.storage.remove([tabProjectKey(tabId), tabCaptureKey(tabId)]);
  }
}

export function tabProjectKey(tabId: number): string {
  return `${TAB_PROJECT_KEY_PREFIX}${tabId}`;
}

export function tabCaptureKey(tabId: number): string {
  return `${TAB_CAPTURE_KEY_PREFIX}${tabId}`;
}
