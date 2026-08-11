import type { NodeStatus } from "../types/domain";

export const NODE_STATUS_OPTIONS: readonly NodeStatus[] = [
  "active",
  "pending",
  "resolved",
  "parked",
  "rejected",
];

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  active: "讨论中",
  pending: "待继续",
  resolved: "已解决",
  parked: "暂时搁置",
  rejected: "不再继续",
};
