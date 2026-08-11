import { useState, type FormEvent } from "react";
import type { Project } from "../types/domain";
import { Modal } from "./Modal";

type Props = {
  project?: Project;
  onSubmit: (input: { title: string; goal: string }) => Promise<void>;
  onClose: () => void;
};

export function ProjectDialog({ project, onSubmit, onClose }: Props) {
  const [title, setTitle] = useState(project?.title ?? "");
  const [goal, setGoal] = useState(project?.goal ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ title, goal });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={project ? "编辑项目" : "创建讨论项目"} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label>
          项目名称
          <input
            autoFocus
            required
            maxLength={80}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：面试评分方案"
          />
        </label>
        <label>
          核心目标
          <textarea
            required
            rows={4}
            maxLength={600}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="这次讨论最终要解决什么？"
          />
        </label>
        <div className="form-actions">
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button button--primary" type="submit" disabled={saving}>
            {saving ? "保存中…" : project ? "保存修改" : "创建项目"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
