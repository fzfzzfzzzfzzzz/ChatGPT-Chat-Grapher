import { useMemo, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { getParentSelectionCandidates } from "../graph/questionTree";
import type { QuestionNode } from "../types/domain";
import { Modal } from "./Modal";

type Props = {
  node: QuestionNode;
  nodes: QuestionNode[];
  onSave: (parentId: string | null) => Promise<boolean>;
  onClose: () => void;
};

export function ChangeParentDialog({ node, nodes, onSave, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const parentCandidates = useMemo(
    () => getParentSelectionCandidates(nodes, node.id),
    [node.id, nodes],
  );
  const [selectedId, setSelectedId] = useState(
    parentCandidates.latestConversationNodeId ?? node.parentId ?? "",
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredParents = normalizedQuery
    ? parentCandidates.nodes.filter((candidate) =>
        candidate.question.toLocaleLowerCase().includes(normalizedQuery),
      )
    : parentCandidates.nodes;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (await onSave(selectedId || null)) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="更换父节点"
      description={`为“${node.question}”选择新的直接父问题。`}
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label className="parent-dialog__search">
          <span>搜索父节点</span>
          <div className="parent-dialog__search-field">
            <Search size={14} aria-hidden="true" />
            <input
              autoFocus
              type="search"
              placeholder="搜索问题节点…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </label>

        <div className="parent-dialog__options" role="radiogroup" aria-label="选择新的父节点">
          {filteredParents.map((candidate) => (
            <label key={candidate.id} className="parent-dialog__option">
              <input
                type="radio"
                name="changed-parent"
                value={candidate.id}
                checked={selectedId === candidate.id}
                onChange={() => setSelectedId(candidate.id)}
              />
              <span title={candidate.question}>{candidate.question}</span>
              {candidate.id === parentCandidates.latestConversationNodeId ? (
                <small className="parent-dialog__latest">最后一次</small>
              ) : null}
            </label>
          ))}
          {!filteredParents.length && normalizedQuery ? (
            <p className="parent-dialog__empty">没有匹配的问题节点</p>
          ) : null}
          <label className="parent-dialog__option parent-dialog__option--root">
            <input
              type="radio"
              name="changed-parent"
              value=""
              checked={selectedId === ""}
              onChange={() => setSelectedId("")}
            />
            <span>无父节点 / 新根节点</span>
          </label>
        </div>

        <div className="form-actions">
          <button className="button" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="button button--primary" type="submit" disabled={saving}>
            {saving ? "保存中…" : "确认"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
