import io
import wave

import numpy as np
from google.genai import types

from app.config import settings
from app.llm.gemini_client import get_client
from app.stt.model import _apply_voice_commands

_TRANSCRIBE_PROMPT = (
    "Transcribe this audio verbatim, exactly as spoken. The speaker is a radiologist dictating "
    "a report, mixing Korean and English — a single sentence often contains both. Preserve "
    "that mixing exactly; do not translate anything.\n\n"
    "When the speaker says an English medical/anatomical term, always write it in English "
    "(Roman alphabet) — never spell it out phonetically in Hangul, even if that's what it "
    "sounds like.\n\n"
    "The speaker sometimes says a punctuation mark's name instead of pausing (a habit from "
    "older dictation systems) — e.g. '피리어드'/'period', '콤마'/'comma', '물음표'/'question "
    "mark'. When one of these clearly functions as a spoken command (typically at a sentence "
    "boundary) rather than as ordinary content, write the actual punctuation mark ('.', ',', "
    "'?') instead of the word.\n\n"
    "Output only the transcription, nothing else — no preamble, no translation, no commentary. "
    "If there is no speech in the audio, output nothing."
)


def _to_wav_bytes(audio: np.ndarray, sample_rate: int = 16000) -> bytes:
    pcm16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())
    return buf.getvalue()


def transcribe_chunk_gemini(audio: np.ndarray) -> str:
    """audio: float32 mono PCM at 16kHz, range [-1, 1]."""
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되지 않았습니다. backend/.env 파일에 추가해주세요.")

    client = get_client()
    wav_bytes = _to_wav_bytes(audio)
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[
            types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"),
            _TRANSCRIBE_PROMPT,
        ],
        config=types.GenerateContentConfig(temperature=0.0),
    )
    text = (response.text or "").strip()
    return _apply_voice_commands(text)
