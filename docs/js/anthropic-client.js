import { storage } from "./storage.js";
import { grammarCorrectionSystemPrompt, conclusionGenerationSystemPrompt } from "./prompts.js";

const MODEL = "claude-haiku-4-5-20251001";
// Conclusion generation has been observed dropping a real positive finding from the checklist
// (e.g. a hedged "Deltoid ligament : r/o partial tear, Gr II" entry) even though the prompt only
// tells it to skip plain negatives -- Haiku under-complying on this specific task, not a prompt
// gap. Give it the stronger model; grammar correction stays on Haiku since that task hasn't
// shown this failure mode.
const CONCLUSION_MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

class MissingApiKeyError extends Error {}

function getApiKey() {
  const key = storage.getSettings().anthropicApiKey;
  if (!key) throw new MissingApiKeyError("Anthropic API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");
  return key;
}

async function callClaude(system, text, model = MODEL) {
  const body = {
    model,
    max_tokens: 4096,
    system,
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

export async function correctGrammar(text) {
  const settings = storage.getSettings();
  return callClaude(grammarCorrectionSystemPrompt(settings.customTerms || ""), text);
}

export async function generateConclusion(text) {
  return callClaude(conclusionGenerationSystemPrompt(), text, CONCLUSION_MODEL);
}

export { MissingApiKeyError };
