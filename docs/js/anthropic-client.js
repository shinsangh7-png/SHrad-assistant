import { storage } from "./storage.js";
import { grammarCorrectionSystemPrompt, checkPointSystemPrompt } from "./prompts.js";

const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

const CHECKPOINTS_TOOL = {
  name: "report_checkpoints",
  description: "Differential diagnoses and checkpoints for a radiology report draft.",
  input_schema: {
    type: "object",
    properties: {
      differentials: { type: "array", items: { type: "string" }, maxItems: 3 },
      checkpoints: { type: "array", items: { type: "string" }, maxItems: 3 },
    },
    required: ["differentials", "checkpoints"],
  },
};

class MissingApiKeyError extends Error {}

function getApiKey() {
  const key = storage.getSettings().anthropicApiKey;
  if (!key) throw new MissingApiKeyError("Anthropic API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");
  return key;
}

export async function correctGrammar(text) {
  const settings = storage.getSettings();
  const body = {
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    system: grammarCorrectionSystemPrompt(settings.customTerms || ""),
    messages: [{ role: "user", content: text }],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getApiKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === "text");
  return (textBlock ? textBlock.text : "").trim();
}

export async function getCheckpoints(text) {
  const body = {
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.3,
    system: checkPointSystemPrompt(),
    tools: [CHECKPOINTS_TOOL],
    tool_choice: { type: "tool", name: "report_checkpoints" },
    messages: [{ role: "user", content: text }],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getApiKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const toolUse = data.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("체크 결과를 가져오지 못했습니다.");
  return {
    differentials: (toolUse.input.differentials || []).slice(0, 3),
    checkpoints: (toolUse.input.checkpoints || []).slice(0, 3),
  };
}

export { MissingApiKeyError };
