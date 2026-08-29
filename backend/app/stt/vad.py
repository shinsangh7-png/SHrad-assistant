from collections import deque

import numpy as np
import torch
from silero_vad import load_silero_vad

from app.config import settings

SAMPLE_RATE = 16000
FRAME_SAMPLES = 512  # Silero VAD requires exactly 512 samples per call at 16kHz
FRAME_MS = FRAME_SAMPLES / SAMPLE_RATE * 1000  # 32ms

_vad_model = None


def _get_vad_model():
    global _vad_model
    if _vad_model is None:
        _vad_model = load_silero_vad(onnx=True)
    return _vad_model


def preload():
    _get_vad_model()


class SpeechSegmenter:
    """Feeds raw float32 16kHz mono audio frame-by-frame and flushes finalized
    utterances once enough trailing silence is observed (sentence-level chunking,
    since faster-whisper has no native streaming mode)."""

    def __init__(self):
        self.model = _get_vad_model()
        self.model.reset_states()

        self.threshold = settings.vad_threshold
        self.silence_flush_ms = settings.vad_silence_flush_ms
        self.trailing_pad_ms = settings.vad_trailing_pad_ms
        self.max_buffer_ms = settings.vad_max_buffer_s * 1000
        self.min_buffer_samples = int(settings.vad_min_buffer_ms / 1000 * SAMPLE_RATE)

        preroll_frames = max(1, round(settings.vad_preroll_ms / FRAME_MS))
        self.preroll: deque[np.ndarray] = deque(maxlen=preroll_frames)

        self.state = "silence"
        self.utterance: list[np.ndarray] = []
        self.silence_run_ms = 0.0
        self.silence_start_idx: int | None = None

        self._leftover = np.zeros(0, dtype=np.float32)

    def _infer(self, frame: np.ndarray) -> float:
        tensor = torch.from_numpy(frame)
        return self.model(tensor, SAMPLE_RATE).item()

    def _reset_to_silence(self):
        self.state = "silence"
        self.utterance = []
        self.silence_run_ms = 0.0
        self.silence_start_idx = None

    def _maybe_emit(self, audio: np.ndarray) -> np.ndarray | None:
        if audio.size >= self.min_buffer_samples:
            return audio
        return None

    def _process_frame(self, frame: np.ndarray) -> np.ndarray | None:
        prob = self._infer(frame)

        if self.state == "silence":
            self.preroll.append(frame)
            if prob >= self.threshold:
                self.state = "speech"
                self.utterance = list(self.preroll)
                self.silence_run_ms = 0.0
                self.silence_start_idx = None
            return None

        # state == "speech"
        self.utterance.append(frame)

        if prob >= self.threshold:
            self.silence_run_ms = 0.0
            self.silence_start_idx = None
        else:
            if self.silence_start_idx is None:
                self.silence_start_idx = len(self.utterance) - 1
            self.silence_run_ms += FRAME_MS
            if self.silence_run_ms >= self.silence_flush_ms:
                pad_frames = max(1, round(self.trailing_pad_ms / FRAME_MS))
                cut_idx = min(len(self.utterance), self.silence_start_idx + pad_frames)
                audio = np.concatenate(self.utterance[:cut_idx])
                self._reset_to_silence()
                return self._maybe_emit(audio)

        utter_ms = len(self.utterance) * FRAME_MS
        if utter_ms >= self.max_buffer_ms:
            audio = np.concatenate(self.utterance)
            self.utterance = []
            self.silence_run_ms = 0.0
            self.silence_start_idx = None
            return self._maybe_emit(audio)

        return None

    def feed(self, pcm: np.ndarray) -> list[np.ndarray]:
        """pcm: float32 mono 16kHz audio of arbitrary length. Returns zero or more
        finalized utterance audio arrays ready to transcribe."""
        buf = np.concatenate([self._leftover, pcm])
        n_frames = len(buf) // FRAME_SAMPLES
        usable = n_frames * FRAME_SAMPLES
        self._leftover = buf[usable:].copy()

        results = []
        for i in range(n_frames):
            frame = buf[i * FRAME_SAMPLES : (i + 1) * FRAME_SAMPLES]
            result = self._process_frame(frame)
            if result is not None:
                results.append(result)
        return results

    def flush(self) -> np.ndarray | None:
        """Force-flush any buffered speech, e.g. on client 'stop'."""
        if self.state == "speech" and self.utterance:
            audio = np.concatenate(self.utterance)
            self._reset_to_silence()
            return self._maybe_emit(audio)
        return None
