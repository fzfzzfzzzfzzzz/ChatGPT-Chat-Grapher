import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { searchProjectNodes } from "../graph/nodeSearch";
import { getCurrentPath } from "../graph/questionTree";
import type { QuestionNode } from "../types/domain";
import { StatusPill } from "./StatusPill";

type Props = {
  nodes: QuestionNode[];
  onLocate: (node: QuestionNode) => void;
};

export function ProjectSearchPanel({ nodes, onLocate }: Props) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchProjectNodes(nodes, query), [nodes, query]);
  const normalizedQuery = query.replace(/\s+/g, " ").trim();

  return (
    <section className="project-search-panel">
      <label className="project-search-box">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">搜索当前项目的问题和摘要</span>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="搜索问题或摘要…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {!normalizedQuery ? (
        <div className="search-empty">输入关键词，查找当前项目中的问题和摘要。</div>
      ) : results.length ? (
        <div className="project-search-results" aria-live="polite">
          <div className="project-search-count">找到 {results.length} 个节点</div>
          {results.map(({ node, field }) => {
            const ancestors = getCurrentPath(nodes, node.id).slice(0, -1);
            return (
              <button key={node.id} type="button" onClick={() => onLocate(node)}>
                <div className="project-search-result__topline">
                  <span>{field === "question" ? "问题命中" : "摘要命中"}</span>
                  <StatusPill status={node.status} />
                </div>
                {ancestors.length ? (
                  <div className="project-search-result__path">
                    {ancestors.map((ancestor) => ancestor.question).join(" › ")}
                  </div>
                ) : <div className="project-search-result__path">根节点</div>}
                <h3>{highlightMatch(node.question, normalizedQuery)}</h3>
                <p>{highlightMatch(node.summary, normalizedQuery)}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="search-empty">当前项目没有匹配的节点。</div>
      )}
    </section>
  );
}

function highlightMatch(value: string, query: string): ReactNode {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!terms.length) return value;
  const match = new RegExp(terms.join("\\s+"), "i").exec(value);
  if (!match || match.index === undefined) return value;
  const index = match.index;
  return (
    <>
      {value.slice(0, index)}
      <mark>{match[0]}</mark>
      {value.slice(index + match[0].length)}
    </>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
