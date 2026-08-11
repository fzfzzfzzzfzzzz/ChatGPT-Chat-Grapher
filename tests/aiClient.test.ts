import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendParentWithConfig, testAIProvider } from "../ai/client";
import type { ParentRecommendationInput } from "../types/domain";

const input: ParentRecommendationInput = {
  question: "新的问题",
  fallbackSummary: "新问题摘要",
  currentPath: [],
  candidateNodes: [{
    id: "parent-1",
    question: "父问题",
    summary: "父问题摘要",
    status: "pending",
  }],
};

const recommendation = JSON.stringify({
  summary: "结构化摘要",
  candidates: [{ node_id: "parent-1", confidence: 0.9 }],
  no_parent_confidence: 0.1,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("multi-provider AI client", () => {
  it("uses OpenAI Chat Completions with JSON mode for a supported provider", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: recommendation } }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await recommendParentWithConfig(input, {
      providerId: "bailian",
      profile: {
        apiKey: "secret-bailian",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-flash",
      },
      timeoutMs: 30_000,
    });

    expect(result).toMatchObject({ summary: "结构化摘要", model: "qwen-flash" });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer secret-bailian");
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).not.toHaveProperty("temperature");
  });

  it("omits model-dependent JSON mode for a custom OpenAI-compatible service", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: recommendation } }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await recommendParentWithConfig(input, {
      providerId: "custom-openai",
      profile: {
        apiKey: "custom-secret",
        baseUrl: "https://gateway.example.com/v1/",
        model: "local-compatible-model",
      },
      timeoutMs: 30_000,
    });

    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gateway.example.com/v1/chat/completions");
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("response_format");
  });

  it("uses Anthropic Messages headers and joins text response blocks", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      content: [
        { type: "text", text: "这里是结果：" },
        { type: "text", text: recommendation },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await recommendParentWithConfig(input, {
      providerId: "anthropic",
      profile: {
        apiKey: "anthropic-secret",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-haiku-4-5",
      },
      timeoutMs: 30_000,
    });

    expect(result.candidates[0]).toEqual({ nodeId: "parent-1", confidence: 0.9 });
    const [url, request] = fetchMock.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers.get("x-api-key")).toBe("anthropic-secret");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(1024);
    expect(body).not.toHaveProperty("temperature");
  });

  it("maps provider errors without leaking the API key or response body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret-provider-body", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = recommendParentWithConfig(input, {
      providerId: "openai",
      profile: {
        apiKey: "super-secret-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.6-luna",
      },
      timeoutMs: 30_000,
    });

    await expect(promise).rejects.toThrow("OpenAI API Key 无效");
    await expect(promise).rejects.not.toThrow("super-secret-key");
    await expect(promise).rejects.not.toThrow("secret-provider-body");
  });

  it("reports rate limits without exposing the provider response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("private quota details", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(recommendParentWithConfig(input, {
      providerId: "gemini",
      profile: {
        apiKey: "test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-3.5-flash-lite",
      },
      timeoutMs: 30_000,
    })).rejects.toThrow("请求过于频繁或额度不足");
  });

  it("aborts a provider request at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, request) =>
      new Promise((_resolve, reject) => {
        request?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = recommendParentWithConfig(input, {
      providerId: "deepseek",
      profile: {
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
      },
      timeoutMs: 5_000,
    });
    const assertion = expect(request).rejects.toThrow("DeepSeek 分析超时");
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it("rejects empty and invalid structured output", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "" } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "not json" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      providerId: "deepseek" as const,
      profile: {
        apiKey: "deepseek-secret",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
      },
      timeoutMs: 30_000,
    };

    await expect(recommendParentWithConfig(input, config)).rejects.toThrow("未返回分析内容");
    await expect(recommendParentWithConfig(input, config)).rejects.toThrow("推荐格式无效");
  });

  it("requires a complete structured recommendation for connection tests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: "{}" } }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(testAIProvider({
      providerId: "openai",
      profile: {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.6-luna",
      },
      timeoutMs: 30_000,
    })).rejects.toThrow("推荐格式无效");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
