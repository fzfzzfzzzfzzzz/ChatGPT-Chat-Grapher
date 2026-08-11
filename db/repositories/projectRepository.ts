import type { DiscussionMapDatabase } from "../database";
import type { Project } from "../../types/domain";
import { createId } from "../../utils/id";
import { requireText } from "../../utils/text";

export class ProjectRepository {
  constructor(private readonly database: DiscussionMapDatabase) {}

  async create(title: string, goal: string): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: createId("project"),
      title: requireText(title, "Project title"),
      goal: requireText(goal, "Project goal"),
      createdAt: now,
      updatedAt: now,
    };
    await this.database.projects.add(project);
    return project;
  }

  get(id: string): Promise<Project | undefined> {
    return this.database.projects.get(id);
  }

  list(): Promise<Project[]> {
    return this.database.projects.orderBy("updatedAt").reverse().toArray();
  }

  async update(
    id: string,
    input: Partial<Pick<Project, "title" | "goal" | "focusNodeId">>,
  ): Promise<Project> {
    const changes: Partial<Project> = { updatedAt: Date.now() };
    if (input.title !== undefined) changes.title = requireText(input.title, "Project title");
    if (input.goal !== undefined) changes.goal = requireText(input.goal, "Project goal");
    if (input.focusNodeId !== undefined) changes.focusNodeId = input.focusNodeId;
    const updated = await this.database.projects.update(id, changes);
    if (!updated) throw new Error("Project not found.");
    return (await this.database.projects.get(id))!;
  }

  async clearFocus(id: string): Promise<void> {
    const updated = await this.database.projects.where("id").equals(id).modify((project) => {
      delete project.focusNodeId;
      project.updatedAt = Date.now();
    });
    if (!updated) throw new Error("Project not found.");
  }
}
