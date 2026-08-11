import type { NodeStatus } from "../types/domain";

export const NODE_STATUS_OPTIONS: readonly NodeStatus[] = [
  "pending",
  "resolved",
];

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  pending: "待讨论",
  resolved: "已完结",
};
