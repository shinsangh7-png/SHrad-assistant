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

async function callClaude({ system, messages, model }) {
  const key = storage.getSettings().anthropicApiKey;
  if (!key) throw new Error("Anthropic API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
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
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === "text");
  return (textBlock ? textBlock.text : "").trim();
}

async function callGpt({ system, messages, model }) {
  const key = storage.getSettings().openaiApiKey;
  if (!key) throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
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
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `GPT API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function callGemini({ system, messages, model }) {
  const key = storage.getSettings().geminiApiKey;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [
            ...(m.images || []).map((im) => ({ inline_data: { mime_type: im.mime, data: base64Of(im.dataUrl) } })),
            { text: m.text || "(이미지만 첨부됨)" },
          ],
        })),
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts
    .map((p) => p.text || "")
    .join("")
    .trim();
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

  const tool = {
    name: "ppt_slides",
    description: "Slides summarizing the consult conversation.",
    input_schema: {
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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "ppt_slides" },
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const toolUse = data.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("요약 결과를 가져오지 못했습니다.");
  return parseSlidesResult(toolUse.input);
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

// Best-effort image lookup for the PPT export -- returns null (never throws) when the Google
// Custom Search keys aren't configured or the request fails, since a missing image should never
// block the text summary that's the actual point of that feature.
export async function searchTopImage(query) {
  const { googleSearchApiKey, googleSearchEngineId } = storage.getSettings();
  if (!googleSearchApiKey || !googleSearchEngineId) return null;

  try {
    const params = new URLSearchParams({
      key: googleSearchApiKey,
      cx: googleSearchEngineId,
      q: query,
      searchType: "image",
      num: "1",
      safe: "active",
    });
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0]?.link || null;
  } catch {
    return null;
  }
}
