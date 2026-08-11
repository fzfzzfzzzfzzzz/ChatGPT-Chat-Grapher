import { describe, expect, it } from "vitest";
import { getGraphNodeActivation } from "../graph/graphNodeActivation";

describe("getGraphNodeActivation", () => {
  it("selects a node on the first click", () => {
    expect(getGraphNodeActivation(undefined, "node-1")).toBe("select");
    expect(getGraphNodeActivation("node-2", "node-1")).toBe("select");
  });

  it("requests navigation when the selected node is clicked again", () => {
    expect(getGraphNodeActivation("node-1", "node-1")).toBe("confirm_locate");
  });

  it("leaves the second click of a double-click to the collapse gesture", () => {
    expect(getGraphNodeActivation("node-1", "node-1", 2)).toBe("ignore");
  });
});
