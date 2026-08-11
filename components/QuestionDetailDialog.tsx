import { useState, type FormEvent } from "react";
import { Crosshair, Trash2 } from "lucide-react";
import { isDescendant } from "../graph/questionTree";
import type { NodeStatus, QuestionNode } from "../types/domain";
import { Modal } from "./Modal";
import { STATUS_LABELS } from "./StatusPill";

type Props = {
  node: QuestionNode;
  nodes: QuestionNode[];
  onSave: (input: { summary: string; status: NodeStatus; parentId: string | null }) => Promise<boolean>;
  onFocus: () => Promise<void>;
  onLocate: () => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
};

export function QuestionDetailDialog({
  node,
  nodes,
  onSave,
  onFocus,
  onLocate,
  onDelete,
  onClose,
}: Props) {
  const [summary, setSummary] = useState(node.summary);
  const [status, setStatus] = useState<NodeStatus>(node.status);
  const [parentId, setParentId] = useState(node.parentId ?? "");
  const [saving, setSaving] = useState(false);
  const validParents = nodes.filter(
    (candidate) =>
      candidate.id !== node.id && !isDescendant(nodes, candidate.id, node.id),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (await onSave({ summary, status, parentId: parentId || null })) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Question Node" description="Node 内容只保留 question、summary 和 status。" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <div className="question-readonly">
          <span>Question</span>
          <p>{node.question}</p>
        </div>
        <label>
          Summary
          <textarea
            required
            rows={3}
            maxLength={180}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as NodeStatus)}>
              {(Object.keys(STATUS_LABELS) as NodeStatus[]).map((value) => (
                <option key={value} value={value}>{STATUS_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Parent
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">No Parent / Root</option>
              {validParents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.question}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="question-dialog__nav">
          <button className="button" type="button" onClick={() => void onFocus()}>设为当前焦点</button>
          <button className="button" type="button" onClick={() => void onLocate()}>
            <Crosshair size={14} /> 回到原消息
          </button>
        </div>
        <div className="form-actions form-actions--between">
          <button className="button button--danger" type="button" onClick={onDelete}>
            <Trash2 size={14} /> 删除 Node
          </button>
          <div>
            <button className="button" type="button" onClick={onClose}>取消</button>
            <button className="button button--primary" type="submit" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
