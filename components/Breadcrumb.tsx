import { ChevronDown } from "lucide-react";
import type { QuestionNode } from "../types/domain";

type Props = {
  path: QuestionNode[];
  onSelect: (node: QuestionNode) => void;
};

export function Breadcrumb({ path, onSelect }: Props) {
  if (!path.length) return null;
  const visible = path.length > 4 ? [path[0], null, ...path.slice(-3)] : path;
  return (
    <nav className="current-path" aria-label="当前问题路径">
      {visible.map((node, index) =>
        node ? (
          <div
            key={node.id}
            className={`current-path__item ${node.id === path.at(-1)?.id ? "is-current" : ""}`}
          >
            {index > 0 ? <ChevronDown size={14} aria-hidden="true" /> : null}
            <button type="button" onClick={() => onSelect(node)} title={node.question}>
              {node.question}
            </button>
          </div>
        ) : (
          <div key="ellipsis" className="current-path__ellipsis" aria-label="已折叠中间路径">
            <ChevronDown size={14} aria-hidden="true" />…
          </div>
        ),
      )}
    </nav>
  );
}
