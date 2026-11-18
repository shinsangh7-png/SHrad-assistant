import { storage } from "./storage.js";

// message shape used across all three providers: { role: 'user'|'assistant', text, images: [{dataUrl, mime}] }

export async function readFileAsImage(file, maxDim = 1568) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  return downscaleDataUrl(dataUrl, maxDim);
}

// Large PACS screenshots easily exceed what's worth sending over the wire (and some APIs cap
// image dimensions outright), so anything bigger than maxDim on its long edge gets redrawn onto
// a canvas and re-encoded as JPEG. Small images are passed through untouched.
function downscaleDataUrl(dataUrl, maxDim) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (width <= maxDim && height <= maxDim) {
        const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
        resolve({ dataUrl, mime });
        return;
      }
      const scale = maxDim / Math.max(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.9), mime: "image/jpeg" });
    };
    img.src = dataUrl;
  });
}

function base64Of(dataUrl) {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

// --- Streaming + retry plumbing shared by all three chat providers ---------------------------
// Every reply streams (SSE) so text appears as soon as the model starts writing instead of after
// the whole answer is done -- by far the biggest perceived-speed win, especially for Claude/Gemini.
// Transient failures (429 rate limit, 5xx "overloaded") are retried automatically with backoff,
// which is what most of Gemini's red errors were: momentary overload or per-minute limits.

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, options, { label, onRetry, delays = RETRY_DELAYS_MS }) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      if (attempt >= delays.length) throw new Error(`${label} 연결 실패: ${e.message || e}`);
      onRetry?.(attempt + 1, "연결 실패", delays.length);
      await sleep(delays[attempt]);
      continue;
    }
    if (res.ok) return res;
    const detail = await res.json().catch(() => ({}));
    const rawMsg = (Array.isArray(detail) ? detail[0] : detail)?.error?.message || "";
    // A daily quota that's used up won't come back in a few seconds -- don't make the user wait
    // through pointless retries for it.
    const dailyQuota = /per\s*day|PerDay|daily/i.test(rawMsg);
    if (RETRY_STATUSES.has(res.status) && !dailyQuota && attempt < delays.length) {
      const retryAfter = Number(res.headers.get("retry-after"));
      onRetry?.(attempt + 1, res.status === 429 ? "요청 한도" : "서버 과부하", delays.length);
      await sleep(retryAfter > 0 && retryAfter <= 30 ? retryAfter * 1000 : delays[attempt]);
      continue;
    }
    const err = new Error(friendlyError(label, res.status, rawMsg, dailyQuota));
    err.status = res.status;
    throw err;
  }
}

function friendlyError(label, status, rawMsg, dailyQuota) {
  let hint = "";
  if (status === 429 && dailyQuota) hint = "오늘 사용 한도를 다 썼습니다 (무료 등급 일일 한도). 내일 풀리거나, 유료 결제 설정이 필요합니다.";
  else if (status === 429) hint = "요청 한도에 걸렸습니다 (분당 한도). 잠시 후 다시 보내주세요.";
  else if (status >= 500) hint = "서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 보내주세요.";
  const base = hint ? `${label}: ${hint}` : `${label} API 오류 (HTTP ${status})`;
  return rawMsg ? `${base}\n(${rawMsg.slice(0, 200)})` : base;
}

// Yields each parsed `data:` JSON payload from a server-sent-events response body.
async function* readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // partial/garbled line -- skip
      }
    }
  }
}

// Claude 5.5 models: low effort keeps the quick-colleague-question latency down (they think far
// less before answering); Opus is the deliberate "take your time" pick, so it gets medium.
function claudeEffort(model) {
  return /opus/.test(model) ? "medium" : "low";
}

async function callClaude({ system, messages, model, onDelta, onRetry }) {
  const key = storage.getSettings().anthropicApiKey;
  if (!key) throw new Error("Anthropic API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const res = await fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        stream: true,
        output_config: { effort: claudeEffort(model) },
        system,
        messages: messages.map((m) => ({
          role: m.role,
          content: [
            ...(m.images || []).map((im) => ({
              type: "image",
              source: { type: "base64", media_type: im.mime, data: base64Of(im.dataUrl) },
            })),
            { type: "text", text: m.text || "(이미지만 첨부됨)" },
          ],
        })),
      }),
    },
    { label: "Claude", onRetry }
  );

  let text = "";
  for await (const ev of readSse(res)) {
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      text += ev.delta.text;
      onDelta?.(text);
    } else if (ev.type === "message_delta" && ev.delta?.stop_reason === "refusal") {
      text += text ? "\n\n(응답이 중단되었습니다)" : "(Claude가 이 질문에 답하지 않았습니다. 다른 AI로 보내보세요.)";
      onDelta?.(text);
    } else if (ev.type === "error") {
      throw new Error(friendlyError("Claude", ev.error?.type === "overloaded_error" ? 529 : 500, ev.error?.message || "", false));
    }
  }
  return text.trim();
}

async function callGpt({ system, messages, model, onDelta, onRetry }) {
  const key = storage.getSettings().openaiApiKey;
  if (!key) throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const res = await fetchWithRetry(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: system },
          ...messages.map((m) => ({
            role: m.role,
            content: [
              { type: "text", text: m.text || "(이미지만 첨부됨)" },
              ...(m.images || []).map((im) => ({ type: "image_url", image_url: { url: im.dataUrl } })),
            ],
          })),
        ],
      }),
    },
    { label: "GPT", onRetry }
  );

  let text = "";
  for await (const ev of readSse(res)) {
    const delta = ev.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta?.(text);
    }
  }
  return text.trim();
}

// Tried in order when the chosen Gemini model is overloaded. Aliases, so they keep pointing at
// current models; any that don't exist for this key are skipped.
const GEMINI_FALLBACK_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

// Gemini 3 flash models think before answering by default, which is most of why they felt so slow
// here. "low" thinking keeps the accuracy that made Gemini the favourite while cutting the wait a
// lot. If a model ever rejects the setting, the request is retried once without it.
async function callGemini({ system, messages, model, onDelta, onRetry }) {
  const key = storage.getSettings().geminiApiKey;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const body = (withThinkingConfig) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [
          ...(m.images || []).map((im) => ({ inline_data: { mime_type: im.mime, data: base64Of(im.dataUrl) } })),
          { text: m.text || "(이미지만 첨부됨)" },
        ],
      })),
      ...(withThinkingConfig ? { generationConfig: { thinkingConfig: { thinkingLevel: "low" } } } : {}),
    });

  const urlFor = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse&key=${key}`;
  const opts = (withThinking) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: body(withThinking) });

  async function open(m, delays) {
    try {
      return await fetchWithRetry(urlFor(m), opts(true), { label: "Gemini", onRetry, delays });
    } catch (e) {
      if (!/thinking/i.test(e.message)) throw e;
      return fetchWithRetry(urlFor(m), opts(false), { label: "Gemini", onRetry, delays });
    }
  }

  // Google's free tier gets "model is overloaded" (503) a lot at busy hours -- even on the very first
  // question -- and waiting on the same model rarely helps. So: one quick retry on the chosen model,
  // then switch to the other flash models, which run on separate capacity.
  let res;
  let usedModel = model;
  try {
    res = await open(model, [1500]);
  } catch (e) {
    if (!(e.status >= 500)) throw e;
    for (const fb of GEMINI_FALLBACK_MODELS.filter((m) => m !== model)) {
      onRetry?.(0, `과부하 — ${fb}로 전환 중`, 0);
      try {
        res = await open(fb, [2000]);
        usedModel = fb;
        break;
      } catch (e2) {
        // A retired/unknown alias (404/400) or another overload: just try the next one.
        if (e2.status === 429) throw e2;
      }
    }
    if (!res) throw e;
  }

  let text = "";
  let finishReason = "";
  for await (const ev of readSse(res)) {
    if (ev.error) throw new Error(friendlyError("Gemini", ev.error.code || 500, ev.error.message || "", false));
    const cand = ev.candidates?.[0];
    const parts = cand?.content?.parts || [];
    // Skip thought-summary parts; only the actual answer goes on screen.
    const delta = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
    if (delta) {
      text += delta;
      onDelta?.(text);
    }
    if (cand?.finishReason) finishReason = cand.finishReason;
    if (ev.promptFeedback?.blockReason) finishReason = `BLOCKED_${ev.promptFeedback.blockReason}`;
  }
  if (!text.trim()) {
    throw new Error(
      finishReason && finishReason !== "STOP"
        ? `Gemini가 답변을 생성하지 않았습니다 (${finishReason}). 다시 보내거나 다른 AI로 보내보세요.`
        : "Gemini 응답이 비어 있습니다. 다시 보내주세요."
    );
  }
  if (usedModel !== model) {
    text = `${text.trim()}

(${model} 과부하로 ${usedModel}가 대신 답변했습니다)`;
    onDelta?.(text);
  }
  return text.trim();
}

export const CHAT_CLIENTS = { claude: callClaude, gpt: callGpt, gemini: callGemini };

export const PROVIDER_LABELS = { claude: "Claude", gpt: "GPT", gemini: "Gemini" };

// --- Structured slide generation for the PPT export -----------------------------------------
// Asking a model to "output raw JSON" as plain text occasionally comes back malformed (an
// unescaped quote inside a bullet breaks JSON.parse). Using each provider's native structured-
// output mechanism (tool calling / response schema) instead means the API itself guarantees
// syntactically valid JSON, the same fix already used for the REFER checkpoints feature.

const SLIDES_SCHEMA_PROPERTIES = {
  title: { type: "string" },
  bullets: { type: "array", items: { type: "string" } },
};

function parseSlidesResult(raw) {
  const slides = Array.isArray(raw?.slides) ? raw.slides : [];
  return slides
    .filter((s) => s && s.title)
    .map((s) => ({ title: String(s.title), bullets: (s.bullets || []).map(String) }));
}

async function generateSlidesClaude({ system, text, model }) {
  const key = storage.getSettings().anthropicApiKey;
  if (!key) throw new Error("Anthropic API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  // Structured outputs (not a forced tool call -- the 5.5 models reject forced tool_choice) so the
  // API itself guarantees valid JSON in the shape below.
  const schema = {
    type: "object",
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: SLIDES_SCHEMA_PROPERTIES,
          required: ["title", "bullets"],
          additionalProperties: false,
        },
      },
    },
    required: ["slides"],
    additionalProperties: false,
  };

  const res = await fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: text }],
      }),
    },
    { label: "Claude" }
  );
  const data = await res.json();
  const textOut = data.content?.find((b) => b.type === "text")?.text;
  if (!textOut) throw new Error("요약 결과를 가져오지 못했습니다.");
  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    throw new Error("요약 결과 형식 오류.");
  }
  return parseSlidesResult(parsed);
}

async function generateSlidesGpt({ system, text, model }) {
  const key = storage.getSettings().openaiApiKey;
  if (!key) throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const fn = {
    name: "ppt_slides",
    description: "Slides summarizing the consult conversation.",
    parameters: {
      type: "object",
      properties: {
        slides: {
          type: "array",
          items: { type: "object", properties: SLIDES_SCHEMA_PROPERTIES, required: ["title", "bullets"] },
        },
      },
      required: ["slides"],
    },
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
      tools: [{ type: "function", function: fn }],
      tool_choice: { type: "function", function: { name: "ppt_slides" } },
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `GPT API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("요약 결과를 가져오지 못했습니다.");
  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("요약 결과 형식 오류.");
  }
  return parseSlidesResult(args);
}

async function generateSlidesGemini({ system, text, model }) {
  const key = storage.getSettings().geminiApiKey;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              slides: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    bullets: { type: "ARRAY", items: { type: "STRING" } },
                  },
                  required: ["title", "bullets"],
                },
              },
            },
            required: ["slides"],
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const textOut = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  if (!textOut) throw new Error("요약 결과를 가져오지 못했습니다.");
  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    throw new Error("요약 결과 형식 오류.");
  }
  return parseSlidesResult(parsed);
}

export const SLIDES_CLIENTS = { claude: generateSlidesClaude, gpt: generateSlidesGpt, gemini: generateSlidesGemini };
