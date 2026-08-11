const rawBaseUrl = process.env.BAILIAN_BASE_URL?.trim() ?? "";
const apiKey = process.env.BAILIAN_API_KEY?.trim() ?? "";
const model = process.env.BAILIAN_MODEL?.trim() || "qwen-flash";

if (!rawBaseUrl) fail("缺少 BAILIAN_BASE_URL，请填写 .env.local。");
if (!apiKey) fail("缺少 BAILIAN_API_KEY，请填写 .env.local。");

let baseUrl;
try {
  baseUrl = new URL(rawBaseUrl);
} catch {
  fail("BAILIAN_BASE_URL 不是有效 URL。");
}

if (baseUrl.protocol !== "https:" || !baseUrl.hostname.endsWith(".aliyuncs.com")) {
  fail("仅允许测试阿里云官方 HTTPS 地址（*.aliyuncs.com）。");
}

const normalizedBaseUrl = baseUrl.toString().replace(/\/+$/, "");
const isAnthropic = baseUrl.pathname.replace(/\/+$/, "").endsWith("/apps/anthropic");
const endpoint = isAnthropic
  ? `${normalizedBaseUrl}/v1/messages`
  : `${normalizedBaseUrl}/chat/completions`;
const headers = isAnthropic
  ? { "Content-Type": "application/json", "x-api-key": apiKey }
  : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
const body = isAnthropic
  ? {
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "只回复 OK" }],
    }
  : {
      model,
      max_tokens: 16,
      temperature: 0,
      messages: [{ role: "user", content: "只回复 OK" }],
    };

console.log(`协议：${isAnthropic ? "Anthropic Messages" : "OpenAI Chat Completions"}`);
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
  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("x-dashscope-request-id");

  console.log(`状态：HTTP ${response.status} ${response.statusText}`);
  if (requestId) console.log(`Request ID：${requestId}`);

  if (!response.ok) {
    console.error(`响应：${redact(responseText).slice(0, 4_000) || "<空>"}`);
    if (response.status === 401 || response.status === 403) {
      console.error("提示：检查 API Key 是否与地域、计费方案和 Base URL 匹配。");
    }
    process.exitCode = 1;
  } else {
    const payload = JSON.parse(responseText);
    const content = isAnthropic
      ? payload.content?.find((item) => item?.type === "text")?.text
      : payload.choices?.[0]?.message?.content;
    console.log(`结果：连接成功${content ? `，模型回复 ${JSON.stringify(content)}` : ""}`);
    if (isAnthropic) {
      console.log(
        "注意：该地址验证的是 Anthropic 协议；当前扩展仍使用 OpenAI Chat Completions 协议。",
      );
    }
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
