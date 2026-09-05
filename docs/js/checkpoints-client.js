import { storage } from "./storage.js";
import { checkPointSystemPrompt } from "./prompts.js";

const CHECKPOINT_SCHEMA_PROPERTIES = {
  title: { type: "string" },
  summary: { type: "string" },
  detail: { type: "string" },
};

function parseCheckpoints(raw) {
  const list = Array.isArray(raw?.checkpoints) ? raw.checkpoints : [];
  return list
    .filter((c) => c && c.title && c.summary)
    .slice(0, 5)
    .map((c) => ({
      title: String(c.title),
      summary: String(c.summary),
      detail: String(c.detail || ""),
    }));
}

export async function getCheckpointsClaude(text) {
  const key = storage.getSettings().anthropicApiKey;
  if (!key) throw new Error("Anthropic API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const tool = {
    name: "report_checkpoints",
    description: "Radiologist checkpoints for finalizing a report draft.",
    input_schema: {
      type: "object",
      properties: {
        checkpoints: {
          type: "array",
          maxItems: 5,
          items: { type: "object", properties: CHECKPOINT_SCHEMA_PROPERTIES, required: ["title", "summary", "detail"] },
        },
      },
      required: ["checkpoints"],
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
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      temperature: 0.3,
      system: checkPointSystemPrompt(),
      tools: [tool],
      tool_choice: { type: "tool", name: "report_checkpoints" },
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const toolUse = data.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("체크 결과를 가져오지 못했습니다.");
  return parseCheckpoints(toolUse.input);
}

export async function getCheckpointsGpt(text) {
  const key = storage.getSettings().openaiApiKey;
  if (!key) throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const fn = {
    name: "report_checkpoints",
    description: "Radiologist checkpoints for finalizing a report draft.",
    parameters: {
      type: "object",
      properties: {
        checkpoints: {
          type: "array",
          maxItems: 5,
          items: { type: "object", properties: CHECKPOINT_SCHEMA_PROPERTIES, required: ["title", "summary", "detail"] },
        },
      },
      required: ["checkpoints"],
    },
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      messages: [
        { role: "system", content: checkPointSystemPrompt() },
        { role: "user", content: text },
      ],
      tools: [{ type: "function", function: fn }],
      tool_choice: { type: "function", function: { name: "report_checkpoints" } },
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `GPT API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("체크 결과를 가져오지 못했습니다.");
  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("체크 결과 형식 오류.");
  }
  return parseCheckpoints(args);
}

export async function getCheckpointsGemini(text) {
  const key = storage.getSettings().geminiApiKey;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const model = "gemini-3.6-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: checkPointSystemPrompt() }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              checkpoints: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    summary: { type: "STRING" },
                    detail: { type: "STRING" },
                  },
                  required: ["title", "summary", "detail"],
                },
              },
            },
            required: ["checkpoints"],
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
  if (!textOut) throw new Error("체크 결과를 가져오지 못했습니다.");
  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    throw new Error("체크 결과 형식 오류.");
  }
  return parseCheckpoints(parsed);
}
