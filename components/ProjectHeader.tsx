import {
  ChevronDown,
  FolderKanban,
  FileText,
  Pencil,
  PictureInPicture2,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import type { Project } from "../types/domain";

type Props = {
  projects: Project[];
  selectedProject?: Project;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFloatingPanel: () => void;
  onReview?: () => void;
  onSettings: () => void;
};

export function ProjectHeader({
  projects,
  selectedProject,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onOpenFloatingPanel,
  onReview,
  onSettings,
}: Props) {
  return (
    <header className="project-header">
      <div className="project-header__brand">
        <span className="brand-mark" aria-hidden="true">
          <FolderKanban size={16} />
        </span>
        <div>
          <div className="eyebrow">CHAT GRAPH</div>
          <div className="project-picker">
            {projects.length > 0 ? (
              <label>
                <span className="sr-only">当前项目</span>
                <select
                  value={selectedProject?.id ?? ""}
                  onChange={(event) => onSelect(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
            ) : (
              <strong>Chat Graph</strong>
            )}
          </div>
        </div>
      </div>
      <div className="project-header__actions">
        {selectedProject && onReview ? (
          <button className="icon-button" type="button" title="总结当前对话" aria-label="总结当前对话" onClick={onReview}>
            <FileText size={15} />
          </button>
        ) : null}
        <button
          className="icon-button"
          type="button"
          title="打开页面浮窗"
          aria-label="打开页面浮窗"
          onClick={onOpenFloatingPanel}
        >
          <PictureInPicture2 size={15} />
        </button>
        <button className="icon-button" type="button" title="设置" onClick={onSettings}>
          <Settings size={15} />
        </button>
        {selectedProject ? (
          <>
            <button className="icon-button" type="button" title="编辑项目" onClick={onEdit}>
              <Pencil size={15} />
            </button>
            <button
              className="icon-button icon-button--danger"
              type="button"
              title="删除项目"
              onClick={onDelete}
            >
              <Trash2 size={15} />
            </button>
          </>
        ) : null}
        <button className="icon-button icon-button--primary" type="button" title="新建项目" onClick={onCreate}>
          <Plus size={16} />
        </button>
      </div>
    </header>
  );
}
