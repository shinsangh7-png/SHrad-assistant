import { storage } from "./storage.js";

const SILENCE_RMS_THRESHOLD = 0.02;
const SILENCE_DURATION_MS = 700;
const MAX_SEGMENT_MS = 15000;
const MIN_SEGMENT_MS = 300;

async function transcribeAudio(blob) {
  const settings = storage.getSettings();
  const apiKey = settings.openaiApiKey;
  if (!apiKey) throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정에서 입력해주세요.");

  const formData = new FormData();
  formData.append("file", blob, "audio.webm");
  formData.append("model", "gpt-4o-transcribe");
  formData.append("language", "en");
  const termsHint = settings.customTerms?.trim() ? ` Known terms: ${settings.customTerms.trim()}.` : "";
  formData.append(
    "prompt",
    `English radiology report dictation. Use correct radiology terminology and standard abbreviations.${termsHint}`
  );

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

// Records the mic via MediaRecorder, using simple volume-based voice-activity detection to cut
// the audio into one segment per utterance (segment ends after ~700ms of silence, or after a
// safety max duration), sending each segment to OpenAI's transcription API as soon as it ends —
// giving turn-by-turn dictation without needing the whole recording to finish first.
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
    this.isSpeaking = false;
    this.silenceStart = null;
    this.segmentStart = null;
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

  _startNewSegment() {
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
    this.segmentStart = performance.now();
    this.isSpeaking = false;
    this.silenceStart = null;
  }

  _finishSegment() {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;
    const chunks = this.chunks;
    const hadSpeech = this.isSpeaking;
    this.mediaRecorder.onstop = () => {
      if (hadSpeech) {
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size > 800) this._sendForTranscription(blob);
      }
      if (this.running) this._startNewSegment();
    };
    this.mediaRecorder.stop();
  }

  _loop() {
    if (!this.running) return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const now = performance.now();
    const elapsed = now - this.segmentStart;

    if (rms > SILENCE_RMS_THRESHOLD) {
      this.isSpeaking = true;
      this.silenceStart = null;
    } else if (this.isSpeaking) {
      if (this.silenceStart === null) this.silenceStart = now;
      if (now - this.silenceStart > SILENCE_DURATION_MS && elapsed > MIN_SEGMENT_MS) {
        this._finishSegment();
      }
    }

    if (elapsed > MAX_SEGMENT_MS) {
      this._finishSegment();
    }

    this.rafId = requestAnimationFrame(() => this._loop());
  }

  async _sendForTranscription(blob) {
    this.onStatus?.("transcribing");
    try {
      const text = await transcribeAudio(blob);
      if (text.trim()) this.onTranscript?.(text.trim());
    } catch (e) {
      this.onError?.(e.message || String(e));
    } finally {
      if (this.running) this.onStatus?.("listening");
    }
  }
}
