import logging
import os
import re
import sys

import numpy as np

# ctranslate2's GPU wheel bundles cuDNN but not cuBLAS; point it at the
# lightweight nvidia-cublas-cu12 pip package's DLLs before it tries to load.
_cublas_bin = os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "cublas", "bin")
if os.path.isdir(_cublas_bin):
    os.environ["PATH"] = _cublas_bin + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel

from app.config import settings

logger = logging.getLogger(__name__)

_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model
    if _model is not None:
        return _model

    logger.info(
        "Loading faster-whisper model=%s device=%s compute_type=%s",
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
    )
    try:
        model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
        )
        # Model construction can succeed even if the CUDA libs needed for actual
        # compute (e.g. cuBLAS) are missing/incompatible, so validate with a real
        # inference call before committing to this device.
        dummy = np.zeros(16000, dtype=np.float32)
        list(model.transcribe(dummy, language="en")[0])
        _model = model
    except Exception:
        logger.exception("GPU inference validation failed, falling back to CPU/int8")
        _model = WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")
    return _model


# Primes the model for Korean-carrier / English-medical-term code-switching so it
# is less likely to phonetically transliterate English terms into Hangul.
_INITIAL_PROMPT = (
    "양측 cerebral white matter에 non-specific T2 hyperintensity lesion이 있음. "
    "Brain atrophy나 hydrocephalus 없음. Midbrain에 old infarction 있음."
)

# Primes the model with dense, multi-region radiology vocabulary so uncommon
# multi-syllable terms (e.g. "myelopathy") don't get mis-heard as ordinary words
# ("yellowpathy") that just happen to sound similar. Whisper's generic language
# model has no strong prior for this vocabulary without an example to anchor on.
_INITIAL_PROMPT_EN = (
    "No acute intracranial hemorrhage, mass, or midline shift. Ventricles are normal in size. "
    "No evidence of myelopathy, radiculopathy, or nerve root compression. Disc herniation, "
    "spondylolisthesis, and spinal stenosis noted at multiple levels, causing neural foraminal "
    "narrowing. No hydronephrosis, cholelithiasis, or hepatosplenomegaly. Pulmonary nodule and "
    "mediastinal lymphadenopathy not identified. Osteoarthritis and osteopenia are present. "
    "Impression: no definite abnormality."
)

# Radiologists dictating with legacy voice-recognition habits say the punctuation
# mark's name instead of pausing for auto-punctuation; Whisper transcribes the
# literal word, so convert it back to the mark it stands for.
_VOICE_COMMANDS = [
    (re.compile(r"\s*(피리어드|period)\.?", re.IGNORECASE), "."),
    (re.compile(r"\s*(콤마|comma)\.?", re.IGNORECASE), ","),
    (re.compile(r"\s*(물음표|퀘스천\s*마크|question mark)\.?", re.IGNORECASE), "?"),
    (re.compile(r"\s*(뉴\s*라인|줄\s*바꿈|new\s*line)\.?", re.IGNORECASE), "\n"),
]


def _apply_voice_commands(text: str) -> str:
    for pattern, replacement in _VOICE_COMMANDS:
        text = pattern.sub(replacement, text)
    text = re.sub(r"\.{2,}", ".", text)
    return text.strip()


def _strip_auto_period(text: str) -> str:
    # Each chunk is one VAD-triggered segment, often just a fragment of a longer sentence the
    # radiologist is still dictating — Whisper still punctuates it as if it were complete,
    # producing a stray mid-sentence period every time the speaker takes a breath. Final
    # sentence punctuation is added later by the correction pass, which sees the whole text and
    # can tell real sentence boundaries from a pause; the raw transcript doesn't need periods
    # at each segment's end at all.
    text = text.rstrip()
    if text.endswith(".") and not text.endswith(".."):
        text = text[:-1].rstrip()
    return text


def transcribe_chunk(audio: np.ndarray, language: str | None = None) -> str:
    """audio: float32 mono PCM at 16kHz, range [-1, 1].

    language=None: auto-detect, primed for Korean-carrier/English-term code-switching.
    language="en": primed with English-only radiology vocabulary instead.
    """
    model = get_model()
    prompt = _INITIAL_PROMPT if language is None else _INITIAL_PROMPT_EN
    segments, _info = model.transcribe(
        audio,
        language=language,
        condition_on_previous_text=False,
        initial_prompt=prompt,
        beam_size=settings.whisper_beam_size,
        # Our own SpeechSegmenter (VAD-based) already trims this chunk to speech,
        # so skip faster-whisper's redundant internal VAD pass to save latency.
        vad_filter=False,
    )
    text = "".join(segment.text for segment in segments).strip()
    text = _apply_voice_commands(text)
    return _strip_auto_period(text)
