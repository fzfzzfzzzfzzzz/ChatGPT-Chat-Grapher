const providers = {
  bailian: { label: "阿里云百炼", transport: "openai-chat", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-flash" },
  openai: { label: "OpenAI", transport: "openai-chat", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna" },
  anthropic: { label: "Anthropic", transport: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5" },
  gemini: { label: "Google Gemini", transport: "openai-chat", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite" },
  deepseek: { label: "DeepSeek", transport: "openai-chat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  openrouter: { label: "OpenRouter", transport: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", model: "~openai/gpt-latest" },
  "custom-openai": { label: "自定义 OpenAI 兼容服务", transport: "openai-chat", baseUrl: "", model: "" },
};

const providerId = process.env.AI_PROVIDER?.trim() || "bailian";
const provider = providers[providerId];
if (!provider) fail(`不支持 AI_PROVIDER=${providerId}。`);

const rawBaseUrl = process.env.AI_BASE_URL?.trim()
  || process.env.BAILIAN_BASE_URL?.trim()
  || provider.baseUrl;
const apiKey = process.env.AI_API_KEY?.trim()
  || process.env.BAILIAN_API_KEY?.trim()
  || "";
const model = process.env.AI_MODEL?.trim()
  || process.env.BAILIAN_MODEL?.trim()
  || provider.model;

if (!rawBaseUrl) fail("缺少 AI_BASE_URL。");
if (!apiKey) fail("缺少 AI_API_KEY。");
if (!model) fail("缺少 AI_MODEL。");

let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(rawBaseUrl);
} catch {
  fail("AI_BASE_URL 不是有效 URL。");
}
if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.username || parsedBaseUrl.password) {
  fail("AI_BASE_URL 必须是未包含凭据的 HTTPS 地址。");
}

const baseUrl = parsedBaseUrl.toString().replace(/\/+$/, "");
const anthropic = provider.transport === "anthropic-messages";
const endpoint = `${baseUrl}/${anthropic ? "messages" : "chat/completions"}`;
const system = "只输出 JSON 对象，字段为 summary、candidates、no_parent_confidence。";
const input = JSON.stringify({
  new_question: "测试多厂商父节点推荐连接",
  fallback_summary: "测试连接",
  current_path: [],
  candidate_nodes: [],
});
const headers = anthropic
  ? { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey }
  : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
const body = anthropic
  ? { model, max_tokens: 256, system, messages: [{ role: "user", content: input }] }
  : {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
    };

console.log(`厂商：${provider.label}`);
console.log(`协议：${anthropic ? "Anthropic Messages" : "OpenAI Chat Completions"}`);
console.log(`模型：${model}`);
console.log(`请求：POST ${endpoint}`);

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const responseText = await response.text();
  console.log(`状态：HTTP ${response.status} ${response.statusText}`);
  if (!response.ok) {
    console.error(`响应：${redact(responseText).slice(0, 2_000) || "<空>"}`);
    process.exitCode = 1;
  } else {
    const payload = JSON.parse(responseText);
    const content = anthropic
      ? payload.content?.filter((item) => item?.type === "text").map((item) => item.text).join("\n")
      : payload.choices?.[0]?.message?.content;
    if (!content || !content.includes("{") || !content.includes("}")) {
      throw new Error("模型未返回可解析的推荐 JSON。");
    }
    console.log("结果：连接成功，模型返回了结构化推荐。");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`请求异常：${redact(message)}`);
  process.exitCode = 1;
}

function redact(value) {
  return value.split(apiKey).join("[REDACTED]");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
