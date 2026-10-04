import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_DISPLAY_MODE,
  graphDisplayModeFromStorage,
} from "../shared/graphDisplayMode";

describe("side panel graph display preference", () => {
  it("defaults missing or invalid preferences to compact nodes", () => {
    expect(graphDisplayModeFromStorage(undefined)).toBe(DEFAULT_GRAPH_DISPLAY_MODE);
    expect(graphDisplayModeFromStorage("invalid")).toBe("nodes");
  });

  it("restores the saved question detail mode", () => {
    expect(graphDisplayModeFromStorage("questions")).toBe("questions");
  });
});
