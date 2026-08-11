import { Inbox, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import type { QuestionCandidate, QuestionNode } from "../types/domain";

type Props = {
  candidates: QuestionCandidate[];
  nodes: QuestionNode[];
  mediumConfidence: number;
  onPromote: (candidate: QuestionCandidate, parentId: string | null) => Promise<void>;
  onDelete: (candidate: QuestionCandidate) => Promise<void>;
};

export function InboxPanel({ candidates, nodes, mediumConfidence, onPromote, onDelete }: Props) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string>();

  if (!candidates.length) {
    return (
      <section className="empty-state empty-state--compact">
        <span className="empty-state__icon" aria-hidden="true"><Inbox size={22} /></span>
        <h2>待讨论已清空</h2>
        <p>低置信度问题和 AI 处理失败的问题会在这里等待确认父节点。</p>
      </section>
    );
  }

  return (
    <section className="inbox-panel">
      <div className="section-heading">
        <div><div className="section-label">待讨论</div><h2>等待确认的问题</h2></div>
        <span>{candidates.length}</span>
      </div>
      <div className="candidate-list">
        {candidates.map((candidate) => {
          const suggested = candidate.recommendations.find(
            (item) => item.confidence >= mediumConfidence,
          );
          const selected = choices[candidate.id] ?? suggested?.nodeId ?? "root";
          return (
            <article className="candidate-card" key={candidate.id}>
              <h3>{candidate.question}</h3>
              <p>{candidate.summary}</p>
              {candidate.status === "processing" ? (
                <div className="candidate-card__hint">正在分析父节点…</div>
              ) : (
                <>
                  <label>
                    挂到
                    <select
                      value={selected}
                      onChange={(event) =>
                        setChoices((current) => ({ ...current, [candidate.id]: event.target.value }))
                      }
                    >
                      <option value="root">无父节点 / 新根节点</option>
                      {candidate.recommendations.map((recommendation) => {
                        const node = nodes.find((item) => item.id === recommendation.nodeId);
                        return node ? (
                          <option value={node.id} key={node.id}>
                            {Math.round(recommendation.confidence * 100)}% · {node.question}
                          </option>
                        ) : null;
                      })}
                      <optgroup label="其他问题">
                        {nodes
                          .filter((node) => !candidate.recommendations.some((item) => item.nodeId === node.id))
                          .map((node) => <option value={node.id} key={node.id}>{node.question}</option>)}
                      </optgroup>
                    </select>
                  </label>
                  <div className="candidate-card__actions">
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={busyId === candidate.id}
                      onClick={() => {
                        setBusyId(candidate.id);
                        void onPromote(candidate, selected === "root" ? null : selected)
                          .finally(() => setBusyId(undefined));
                      }}
                    >
                      <Link2 size={14} /> {selected === "root" ? "设为根节点" : "确认父节点"}
                    </button>
                    <button
                      className="button button--danger"
                      type="button"
                      disabled={busyId === candidate.id}
                      onClick={() => {
                        setBusyId(candidate.id);
                        void onDelete(candidate).finally(() => setBusyId(undefined));
                      }}
                    >
                      <Trash2 size={14} /> 忽略
                    </button>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
