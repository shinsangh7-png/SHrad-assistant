import { storage } from "./storage.js";
import { clinicalCheckpointsSystemPrompt, grammarCorrectionSystemPrompt, sequenceExtractionSystemPrompt } from "./prompts.js";

const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

class MissingApiKeyError extends Error {}

function getApiKey() {
  const key = storage.getSettings().anthropicApiKey;
  if (!key) throw new MissingApiKeyError("Anthropic API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");
  return key;
}

async function callClaude({ system, messages, maxTokens = 2048, temperature, outputSchema }) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (outputSchema) {
    body.output_config = { format: { type: "json_schema", schema: outputSchema } };
  }

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
  return textBlock ? textBlock.text : "";
}

export async function correctGrammar(text) {
  const result = await callClaude({
    system: grammarCorrectionSystemPrompt(),
    messages: [{ role: "user", content: text }],
    maxTokens: 4096,
    temperature: 0.2,
  });
  return result.trim();
}

const CHECKPOINTS_SCHEMA = {
  type: "object",
  properties: {
    checkpoints: {
      type: "array",
      items: {
        type: "object",
        properties: { point: { type: "string" }, rationale: { type: "string" } },
        required: ["point", "rationale"],
        additionalProperties: false,
      },
    },
    differential_diagnoses: {
      type: "array",
      items: {
        type: "object",
        properties: { diagnosis: { type: "string" }, supporting_findings: { type: "string" } },
        required: ["diagnosis", "supporting_findings"],
        additionalProperties: false,
      },
    },
  },
  required: ["checkpoints", "differential_diagnoses"],
  additionalProperties: false,
};

export async function getClinicalCheckpoints(patientContext, modality, bodyRegion, reportText, images = []) {
  const userText =
    `Modality: ${modality}\nBody region: ${bodyRegion}\n` +
    `Patient symptoms/history: ${patientContext || "(not provided)"}\n\nReport:\n${reportText}`;

  const content = images.map(({ data, mime_type }) => ({
    type: "image",
    source: { type: "base64", media_type: mime_type, data },
  }));
  content.push({ type: "text", text: userText });

  const result = await callClaude({
    system: clinicalCheckpointsSystemPrompt(),
    messages: [{ role: "user", content: images.length ? content : userText }],
    temperature: 0.3,
    outputSchema: CHECKPOINTS_SCHEMA,
  });
  return JSON.parse(result);
}

export async function extractSequence(imageBase64, imageMimeType) {
  const content = [
    { type: "image", source: { type: "base64", media_type: imageMimeType, data: imageBase64 } },
    { type: "text", text: "Extract and format the sequence protocol from this screenshot." },
  ];
  const result = await callClaude({
    system: sequenceExtractionSystemPrompt(),
    messages: [{ role: "user", content }],
    temperature: 0.2,
  });
  return result.trim();
}

export { MissingApiKeyError };
