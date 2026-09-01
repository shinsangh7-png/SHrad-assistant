import { storage } from "./storage.js";
import { clinicalCheckpointsSystemPrompt } from "./prompts.js";

const MODEL = "gemini-flash-latest";

class MissingApiKeyError extends Error {}

function getApiKey() {
  const key = storage.getSettings().geminiApiKey;
  if (!key) throw new MissingApiKeyError("Gemini API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");
  return key;
}

async function callGemini({ systemInstruction, parts, temperature, responseSchema, timeoutMs = 25000 }) {
  const apiKey = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const generationConfig = {};
  if (temperature !== undefined) generationConfig.temperature = temperature;
  if (responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = responseSchema;
  }

  const body = {
    contents: [{ parts }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Gemini API 응답이 너무 오래 걸려 시간 초과되었습니다. 잠시 후 다시 시도해주세요.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text === undefined) throw new Error("Gemini API가 빈 응답을 반환했습니다.");
  return text;
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
      },
    },
    differential_diagnoses: {
      type: "array",
      items: {
        type: "object",
        properties: { diagnosis: { type: "string" }, supporting_findings: { type: "string" } },
        required: ["diagnosis", "supporting_findings"],
      },
    },
  },
  required: ["checkpoints", "differential_diagnoses"],
};

export async function getClinicalCheckpointsGemini(patientContext, modality, bodyRegion, reportText, images = []) {
  const userText =
    `Modality: ${modality}\nBody region: ${bodyRegion}\n` +
    `Patient symptoms/history: ${patientContext || "(not provided)"}\n\nReport:\n${reportText}`;

  const parts = images.map(({ data, mime_type }) => ({
    inlineData: { mimeType: mime_type, data },
  }));
  parts.push({ text: userText });

  const result = await callGemini({
    systemInstruction: clinicalCheckpointsSystemPrompt(),
    parts,
    temperature: 0.3,
    responseSchema: CHECKPOINTS_SCHEMA,
  });
  return JSON.parse(result);
}

export { MissingApiKeyError };
