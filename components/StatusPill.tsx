import { NODE_STATUS_LABELS } from "../shared/nodeStatus";
import type { NodeStatus } from "../types/domain";

export const STATUS_LABELS = NODE_STATUS_LABELS;

export function StatusPill({ status }: { status: NodeStatus }) {
  return <span className={`status-pill status-pill--${status}`}>{STATUS_LABELS[status]}</span>;
}
