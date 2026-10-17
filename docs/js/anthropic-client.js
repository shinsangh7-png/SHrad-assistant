import { storage } from "./storage.js";
import { grammarCorrectionSystemPrompt, conclusionGenerationSystemPrompt } from "./prompts.js";
import { numberLines, applyLineChanges, getFindingText } from "./report-text.js";

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

async function postMessages(body) {
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
  return res.json();
}

async function callClaude(system, text, model = MODEL, maxTokens = 1024) {
  const data = await postMessages({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: text }],
  });
  const textBlock = data.content.find((b) => b.type === "text");
  return (textBlock ? textBlock.text : "").trim();
}

// Forces the model to answer through a tool call, which gives back parsed JSON instead of text
// that would need to be scraped.
async function callClaudeTool(system, text, tool, model = MODEL, maxTokens = 4096) {
  const data = await postMessages({
    model,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: text }],
  });
  const toolUse = data.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("모델 응답 형식 오류 (도구 호출 없음). 다시 시도해주세요.");
  return toolUse.input;
}

const CORRECTION_TOOL = {
  name: "apply_corrections",
  description:
    "The lines of the report that need changing. Any line not listed stays exactly as it is.",
  input_schema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "integer", description: "1-based line number, as shown in the input." },
            text: {
              type: "string",
              description:
                "The full corrected content of that line, without the 'N| ' number prefix. May contain a line break only when one run-on line is being split into several.",
            },
            delete: { type: "boolean", description: "true to remove this line entirely." },
          },
          required: ["line"],
        },
      },
    },
    required: ["changes"],
  },
};

// Returns { text, changed }: the report with the model's line edits applied, and how many lines
// it touched. The model only lists lines that need a change (instead of re-typing the whole
// report), which is what makes this fast -- and lines it doesn't list can't be altered at all.
export async function correctGrammar(text) {
  const settings = storage.getSettings();
  const input = await callClaudeTool(
    grammarCorrectionSystemPrompt(settings.customTerms || ""),
    numberLines(text),
    CORRECTION_TOOL
  );
  let changes = input?.changes;
  if (typeof changes === "string") {
    try {
      changes = JSON.parse(changes);
    } catch {
      changes = null;
    }
  }
  if (!Array.isArray(changes)) throw new Error("교정 결과 형식 오류. 다시 시도해주세요.");
  return applyLineChanges(text, changes);
}

// Returns just the Conclusion list (the body that goes under [ Conclusion ]). Only the Finding
// section is sent and only the list comes back -- the caller splices it into the report.
export async function generateConclusion(text) {
  const finding = getFindingText(text);
  if (!finding) throw new Error("[ Finding ] 내용이 없습니다.");
  return callClaude(conclusionGenerationSystemPrompt(), `[ Finding ]\n${finding}`, CONCLUSION_MODEL, 1024);
}

export { MissingApiKeyError };
