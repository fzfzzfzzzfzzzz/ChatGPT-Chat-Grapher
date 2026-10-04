import { useState, type FormEvent } from "react";
import { Crosshair, Trash2 } from "lucide-react";
import { getValidParentNodes } from "../graph/questionTree";
import type { NodeStatus, QuestionNode, QuestionReference } from "../types/domain";
import { Modal } from "./Modal";
import { STATUS_LABELS } from "./StatusPill";
import { QuestionReferenceList } from "./QuestionReferenceList";

type Props = {
  node: QuestionNode;
  nodes: QuestionNode[];
  onSave: (input: { summary: string; status: NodeStatus; parentId: string | null }) => Promise<boolean>;
  onFocus: () => Promise<void>;
  onLocate: () => Promise<void>;
  onLocateReference?: (reference: QuestionReference) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
};

export function QuestionDetailDialog({
  node,
  nodes,
  onSave,
  onFocus,
  onLocate,
  onLocateReference,
  onDelete,
  onClose,
}: Props) {
  const [summary, setSummary] = useState(node.summary);
  const [status, setStatus] = useState<NodeStatus>(node.status);
  const [parentId, setParentId] = useState(node.parentId ?? "");
  const [saving, setSaving] = useState(false);
  const validParents = getValidParentNodes(nodes, node.id);

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
    <Modal title="问题节点" description="节点保留问题、摘要、状态和轻量引用信息。" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <div className="question-readonly">
          <span>问题</span>
          <p>{node.question}</p>
        </div>
        <QuestionReferenceList
          references={node.references ?? []}
          {...(onLocateReference ? { onLocate: onLocateReference } : {})}
        />
        <label>
          摘要
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
            状态
            <select value={status} onChange={(event) => setStatus(event.target.value as NodeStatus)}>
              {(Object.keys(STATUS_LABELS) as NodeStatus[]).map((value) => (
                <option key={value} value={value}>{STATUS_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            父节点
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">无父节点 / 根节点</option>
              {validParents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.question}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="question-dialog__nav">
          <button className="button" type="button" onClick={() => void onFocus()}>设为当前焦点</button>
          <button className="button" type="button" disabled={node.kind === "planned"} onClick={() => void onLocate()}>
            <Crosshair size={14} /> {node.kind === "planned" ? "发送后可定位" : "回到原消息"}
          </button>
        </div>
        <div className="form-actions form-actions--between">
          <button className="button button--danger" type="button" onClick={onDelete}>
            <Trash2 size={14} /> 删除节点
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
