import { storage } from "./storage.js";

const BASE_SILENCE_RMS_THRESHOLD = 0.02;
const NOISE_FLOOR_MULTIPLIER = 3;
const NOISE_FLOOR_MARGIN = 0.01;
const CALIBRATION_MS = 400;
const SILENCE_DURATION_MS = 700;
const MAX_SEGMENT_MS = 15000;
const MIN_SEGMENT_MS = 300;
const MIN_SPEECH_CONFIRM_MS = 150;
const MIN_SPEECH_ACTIVE_MS = 250;
const MAX_TERMS_PROMPT_CHARS = 300;
const MAX_PLAUSIBLE_WORDS_PER_SEC = 4.5;
const SUSPECT_WORD_MARGIN = 3;

// Hangul, Hiragana/Katakana, CJK ideographs -- none belong in an English-only transcript.
// gpt-4o-transcribe occasionally renders a jargon word/phrase in one of these scripts even
// with language=en and an English prompt set (confirmed happening on real dictation; not
// reproducible with synthetic TTS audio in this environment, so the trigger is presumably
// something about real speech -- accent, mic, prosody -- that clean TTS doesn't have). Since
// the same input doesn't fail every time, retrying once resolves most occurrences.
const NON_LATIN_SCRIPT_RE = /[぀-ヿ가-힣一-鿿]/;
const MAX_LANGUAGE_LOCK_ATTEMPTS = 2;

// gpt-4o-transcribe never returns "no speech" for non-speech audio — it fabricates a
// plausible-sounding sentence instead (confirmed by feeding it pure noise: it invented
// full clinical findings, drawing vocabulary straight from the `prompt` hint). Capping
// how much of the custom-terms list goes into the prompt limits how much clinically
// specific content a hallucination on noise/silence can draw on.
function truncateTermsForPrompt(str, maxChars) {
  if (str.length <= maxChars) return str;
  const cut = str.slice(0, maxChars);
  const lastComma = cut.lastIndexOf(",");
  return (lastComma > 0 ? cut.slice(0, lastComma) : cut).trim();
}

async function callTranscriptionApi(blob, apiKey, prompt) {
  const formData = new FormData();
  formData.append("file", blob, "audio.webm");
  formData.append("model", "gpt-4o-transcribe");
  formData.append("language", "en");
  formData.append("prompt", prompt);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `전사 API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.text || "";
}

async function transcribeAudio(blob) {
  const settings = storage.getSettings();
  const apiKey = settings.openaiApiKey;
  if (!apiKey) throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const rawTerms = settings.customTerms?.trim() || "";
  const cappedTerms = truncateTermsForPrompt(rawTerms, MAX_TERMS_PROMPT_CHARS);
  const termsHint = cappedTerms ? ` Known terms: ${cappedTerms}.` : "";
  const prompt = `English radiology report dictation. Use correct radiology terminology and standard abbreviations.${termsHint}`;

  let text = "";
  for (let attempt = 1; attempt <= MAX_LANGUAGE_LOCK_ATTEMPTS; attempt++) {
    text = await callTranscriptionApi(blob, apiKey, prompt);
    if (!NON_LATIN_SCRIPT_RE.test(text)) return text;
  }
  return text;
}

// Records the mic via MediaRecorder, using volume-based voice-activity detection to cut
// the audio into one segment per utterance (segment ends after ~700ms of silence, or after a
// safety max duration), sending each segment to OpenAI's transcription API as soon as it ends —
// giving turn-by-turn dictation without needing the whole recording to finish first.
//
// Two defenses against the STT model hallucinating on non-speech audio (confirmed behavior,
// not hypothetical — see dictation.js history): (1) an adaptive noise floor calibrated at
// start(), plus a minimum sustained-above-threshold duration before a sound counts as speech
// at all, so brief noise blips never trigger a segment; (2) a post-hoc plausibility check that
// flags a transcript when it's far too long for how little confirmed speech time produced it.
export class Dictation {
  constructor({ onTranscript, onStatus, onError }) {
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.onError = onError;
    this.running = false;
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.threshold = BASE_SILENCE_RMS_THRESHOLD;
    this.isSpeaking = false;
    this.aboveThresholdMs = 0;
    this.speechActiveMs = 0;
    this.silenceStart = null;
    this.segmentStart = null;
    this.lastFrameTime = null;
    this.rafId = null;
  }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);

    this.onStatus?.("calibrating");
    const noiseFloor = await this._calibrateNoiseFloor();
    this.threshold = Math.max(BASE_SILENCE_RMS_THRESHOLD, noiseFloor * NOISE_FLOOR_MULTIPLIER + NOISE_FLOOR_MARGIN);

    this.running = true;
    this._startNewSegment();
    this._loop();
    this.onStatus?.("listening");
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._finishSegment();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();
    this.onStatus?.("stopped");
  }

  // Force whatever's been captured so far to be cut off and sent for transcription right
  // now, without stopping the mic or ending the dictation session -- lets the user manually
  // mark a segment boundary (e.g. pressing F6 between phrases) instead of waiting on the
  // silence timer, with no mic-teardown/recalibration cost since the stream stays open.
  cutNow() {
    if (!this.running) return;
    this._finishSegment();
  }

  async _calibrateNoiseFloor() {
    const samples = [];
    const start = performance.now();
    await new Promise((resolve) => {
      const sample = () => {
        samples.push(this._readRms());
        if (performance.now() - start < CALIBRATION_MS) {
          requestAnimationFrame(sample);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(sample);
    });
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)] || 0;
  }

  _readRms() {
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    return Math.sqrt(sumSquares / data.length);
  }

  _startNewSegment() {
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
    this.segmentStart = performance.now();
    this.lastFrameTime = this.segmentStart;
    this.isSpeaking = false;
    this.aboveThresholdMs = 0;
    this.speechActiveMs = 0;
    this.silenceStart = null;
  }

  _finishSegment() {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;
    const chunks = this.chunks;
    const hadEnoughSpeech = this.speechActiveMs >= MIN_SPEECH_ACTIVE_MS;
    const speechActiveMs = this.speechActiveMs;
    this.mediaRecorder.onstop = () => {
      if (hadEnoughSpeech) {
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size > 800) this._sendForTranscription(blob, speechActiveMs);
      }
      if (this.running) this._startNewSegment();
    };
    this.mediaRecorder.stop();
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;

    const rms = this._readRms();
    const elapsed = now - this.segmentStart;

    if (rms > this.threshold) {
      this.aboveThresholdMs += dt;
      this.silenceStart = null;
      if (!this.isSpeaking && this.aboveThresholdMs >= MIN_SPEECH_CONFIRM_MS) {
        this.isSpeaking = true;
        // credit the whole above-threshold run, including the confirm window itself --
        // otherwise a short word barely longer than MIN_SPEECH_CONFIRM_MS would be undercounted.
        this.speechActiveMs += this.aboveThresholdMs;
      } else if (this.isSpeaking) {
        this.speechActiveMs += dt;
      }
    } else {
      this.aboveThresholdMs = 0;
      if (this.isSpeaking) {
        if (this.silenceStart === null) this.silenceStart = now;
        if (now - this.silenceStart > SILENCE_DURATION_MS && elapsed > MIN_SEGMENT_MS) {
          this._finishSegment();
        }
      }
    }

    if (elapsed > MAX_SEGMENT_MS) {
      this._finishSegment();
    }

    this.rafId = requestAnimationFrame(() => this._loop());
  }

  async _sendForTranscription(blob, speechActiveMs) {
    this.onStatus?.("transcribing");
    try {
      const text = await transcribeAudio(blob);
      const trimmed = text.trim();
      if (!trimmed) return;

      if (NON_LATIN_SCRIPT_RE.test(trimmed)) {
        this.onError?.("영어가 아닌 문자로 인식되어 해당 구간을 건너뛰었습니다 — 다시 말씀해주세요.");
        return;
      }

      const wordCount = trimmed.split(/\s+/).length;
      const maxPlausibleWords = Math.ceil((speechActiveMs / 1000) * MAX_PLAUSIBLE_WORDS_PER_SEC) + SUSPECT_WORD_MARGIN;
      if (wordCount > maxPlausibleWords) {
        this.onError?.("말한 길이에 비해 인식된 문장이 너무 길어 해당 구간을 건너뛰었습니다 — 오인식(환청) 가능성, 다시 말씀해주세요.");
      } else {
        this.onTranscript?.(trimmed);
      }
    } catch (e) {
      this.onError?.(e.message || String(e));
    } finally {
      if (this.running) this.onStatus?.("listening");
    }
  }
}
