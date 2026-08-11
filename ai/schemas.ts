import type { ParentCandidate, ParentRecommendation } from "../types/domain";

export function parseParentRecommendation(content: string): ParentRecommendation {
  const parsed = JSON.parse(extractJsonObject(content)) as unknown;
  if (!isRecord(parsed)) throw new Error("AI 返回的内容不是 JSON 对象。");

  const candidates = Array.isArray(parsed.candidates)
    ? parsed.candidates.flatMap((value): ParentCandidate[] => {
        if (!isRecord(value)) return [];
        const nodeId = stringValue(value.node_id);
        const confidence = numberValue(value.confidence);
        return nodeId && confidence !== undefined
          ? [{ nodeId, confidence: clamp(confidence) }]
          : [];
      })
    : [];

  const bestByNode = new Map<string, ParentCandidate>();
  for (const candidate of candidates) {
    const current = bestByNode.get(candidate.nodeId);
    if (!current || candidate.confidence > current.confidence) {
      bestByNode.set(candidate.nodeId, candidate);
    }
  }
  const uniqueCandidates = [...bestByNode.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  return {
    summary: stringValue(parsed.summary) ?? "",
    candidates: uniqueCandidates,
    noParentConfidence: clamp(numberValue(parsed.no_parent_confidence) ?? 0),
  };
}

function extractJsonObject(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未返回可解析的 JSON。");
  return content.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
