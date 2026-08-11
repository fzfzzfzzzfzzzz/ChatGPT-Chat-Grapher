import { ArrowUp, ChevronDown, Crosshair } from "lucide-react";
import { useEffect, useState } from "react";
import type { NodeStatus, QuestionNode } from "../types/domain";
import { StatusPill } from "./StatusPill";

type Props = {
  current: QuestionNode;
  parent?: QuestionNode;
  onEdit: () => void;
  onLocate: () => void;
  onSetStatus: (status: NodeStatus) => void;
};

export function CurrentParentPanel({
  current,
  parent,
  onEdit,
  onLocate,
  onSetStatus,
}: Props) {
  const [currentSummaryExpanded, setCurrentSummaryExpanded] = useState(true);
  const [parentSummaryExpanded, setParentSummaryExpanded] = useState(true);

  useEffect(() => {
    setCurrentSummaryExpanded(true);
    setParentSummaryExpanded(true);
  }, [current.id]);

  return (
    <>
      <section className="focus-context-card focus-context-card--current">
        <div className="focus-context-card__topline">
          <div className="section-label section-label--current">CURRENT</div>
          <div className="focus-context-card__meta">
            <StatusPill status={current.status} />
            <button className="text-button" type="button" onClick={onEdit}>编辑节点</button>
          </div>
        </div>
        <h2>{current.question}</h2>
        <div className="focus-summary">
          <button
            className="focus-summary__toggle"
            type="button"
            aria-expanded={currentSummaryExpanded}
            aria-controls="sidepanel-current-summary"
            onClick={() => setCurrentSummaryExpanded((expanded) => !expanded)}
          >
            <span>CURRENT SUMMARY</span>
            <ChevronDown className={currentSummaryExpanded ? "is-expanded" : undefined} size={14} />
          </button>
          {currentSummaryExpanded ? (
            <p id="sidepanel-current-summary">{current.summary || "摘要生成中…"}</p>
          ) : null}
        </div>
        <div className="focus-context-card__actions">
          <button className="button" type="button" onClick={onLocate}>
            <Crosshair size={14} /> 原始消息
          </button>
          <select
            aria-label="修改问题状态"
            value={current.status}
            onChange={(event) => onSetStatus(event.target.value as NodeStatus)}
          >
            <option value="pending">待讨论</option>
            <option value="resolved">已完结</option>
          </select>
        </div>
      </section>

      <div className="focus-context-connector" aria-hidden="true">
        <span />
        <ArrowUp size={14} />
      </div>

      <section className="focus-context-card focus-context-card--parent">
        <div className="focus-context-card__topline">
          <div className="section-label">PARENT</div>
        </div>
        {parent ? (
          <>
            <h2>{parent.question}</h2>
            <div className="focus-summary focus-summary--parent">
              <button
                className="focus-summary__toggle"
                type="button"
                aria-expanded={parentSummaryExpanded}
                aria-controls="sidepanel-parent-summary"
                onClick={() => setParentSummaryExpanded((expanded) => !expanded)}
              >
                <span>PARENT SUMMARY</span>
                <ChevronDown className={parentSummaryExpanded ? "is-expanded" : undefined} size={14} />
              </button>
              {parentSummaryExpanded ? (
                <p id="sidepanel-parent-summary">{parent.summary || "暂无摘要"}</p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="focus-context-card__empty">无父节点 / 当前为根节点</p>
        )}
      </section>
    </>
  );
}
