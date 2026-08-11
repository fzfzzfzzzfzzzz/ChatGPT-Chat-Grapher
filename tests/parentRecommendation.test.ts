import { describe, expect, it } from "vitest";
import { parseParentRecommendation } from "../ai/schemas";

describe("parseParentRecommendation", () => {
  it("keeps at most three unique candidates ordered by confidence", () => {
    const result = parseParentRecommendation(JSON.stringify({
      summary: "讨论消息监听机制。",
      candidates: [
        { node_id: "b", confidence: 0.64 },
        { node_id: "a", confidence: 0.91 },
        { node_id: "a", confidence: 0.7 },
        { node_id: "c", confidence: 1.4 },
        { node_id: "d", confidence: 0.2 },
      ],
      no_parent_confidence: -1,
    }));
    expect(result.candidates).toEqual([
      { nodeId: "c", confidence: 1 },
      { nodeId: "a", confidence: 0.91 },
      { nodeId: "b", confidence: 0.64 },
    ]);
    expect(result.noParentConfidence).toBe(0);
  });

  it("rejects non-JSON model output", () => {
    expect(() => parseParentRecommendation("not json")).toThrow("JSON");
  });
});
