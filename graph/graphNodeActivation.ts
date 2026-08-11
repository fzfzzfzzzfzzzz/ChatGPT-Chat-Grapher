export type GraphNodeActivation = "select" | "confirm_locate" | "ignore";

export function getGraphNodeActivation(
  selectedNodeId: string | undefined,
  clickedNodeId: string,
  clickCount = 1,
): GraphNodeActivation {
  if (clickCount > 1) return "ignore";
  return selectedNodeId === clickedNodeId ? "confirm_locate" : "select";
}
