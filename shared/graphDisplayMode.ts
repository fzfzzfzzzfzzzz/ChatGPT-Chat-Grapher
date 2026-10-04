export type GraphDisplayMode = "nodes" | "questions";

export const SIDE_PANEL_GRAPH_DISPLAY_MODE_KEY = "sidePanelGraphDisplayMode";
export const DEFAULT_GRAPH_DISPLAY_MODE: GraphDisplayMode = "nodes";

export function graphDisplayModeFromStorage(value: unknown): GraphDisplayMode {
  return value === "questions" ? "questions" : DEFAULT_GRAPH_DISPLAY_MODE;
}
