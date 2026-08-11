import { GitBranch, Plus } from "lucide-react";

type Props = {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
};

export function EmptyState({ title, description, actionLabel, onAction }: Props) {
  return (
    <section className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <GitBranch size={24} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="button button--primary" type="button" onClick={onAction}>
        <Plus size={15} />
        {actionLabel}
      </button>
    </section>
  );
}
