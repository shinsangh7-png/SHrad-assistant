import json
import re

import anthropic

from app.config import settings
from app.llm.prompts import (
    clinical_checkpoints_system_prompt,
    clinical_context_analysis_system_prompt,
    conclusion_generation_system_prompt,
    free_question_system_prompt,
    grammar_correction_system_prompt,
    style_reference_block,
)
from app.llm.schemas import ClinicalCheckpointsResult, ClinicalContextAnalysisResult

MODEL = "claude-haiku-4-5-20251001"
# Conclusion generation has repeatedly seen Haiku under-comply with instructions on it (dropping
# content, leaking meta-commentary, format drift) in ways it doesn't for grammar correction — so
# it gets the stronger model.
CONCLUSION_MODEL = "claude-sonnet-5"

_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        if settings.anthropic_api_key:
            _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        else:
            _client = anthropic.Anthropic()  # falls back to ANTHROPIC_API_KEY env var
    return _client


def _first_text(response) -> str:
    return next(b.text for b in response.content if b.type == "text")


def correct_grammar(text: str, previous_report: str = "", mode: str = "local") -> str:
    client = get_client()
    user_content = text + style_reference_block(previous_report)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        temperature=0.2,
        system=grammar_correction_system_prompt(mode),
        messages=[{"role": "user", "content": user_content}],
    )
    return _first_text(response).strip()


def _format_conclusion_lines(lines: list[str]) -> str:
    if len(lines) == 1:
        return lines[0]
    return "\n".join(f"{i}. {line}" for i, line in enumerate(lines, 1))


_LEADING_NUMBER_RE = re.compile(r"^\s*(\d+[.)]|[-*•])\s*")
_HEADER_ONLY_RE = re.compile(r"^\**\s*(impression|conclusion)s?\s*:?\s*\**$", re.IGNORECASE)

# Matches only generic, routine "nothing found in this specific item" phrasing — deliberately
# narrow so it never touches a pertinent negative (e.g. "No hydrocephalus.", "No evidence of
# tumor recurrence.", "No significant interval change.") which must always be kept.
_GENERIC_NEGATIVE_RE = re.compile(
    r"^(no\s+(?:(?:definite|significant|acute)\s+)?abnormalit(y|ies)\b"
    r"|(?:not\s+)?unremarkable\b"
    r"|normal\b"
    r"|no\s+(?:significant\s+)?(central\s+canal|neural\s+foraminal)\s+stenosis\b"
    r"|no\s+(?:significant\s+)?finding[s]?\b"
    r"|no\s+remarkable\s+finding[s]?\b)",
    re.IGNORECASE,
)


# Strips a leading subject clause like "Sacrum and coccyx are ..." or "The pancreas shows ..."
# so the generic-negative check below also catches subject-first phrasing, not just "No ..."/
# "Label: ..." phrasing.
_SUBJECT_COPULA_RE = re.compile(r"^.+?\s+(?:is|are|shows?)\s+", re.IGNORECASE)


def _is_routine_negative_line(line: str) -> bool:
    body = line.strip().rstrip(".")
    if ":" in body:
        body = body.rsplit(":", 1)[-1].strip()
    body = _SUBJECT_COPULA_RE.sub("", body, count=1).strip()
    return bool(_GENERIC_NEGATIVE_RE.match(body))


def _drop_routine_negative_lines(lines: list[str]) -> list[str]:
    kept = [ln for ln in lines if not _is_routine_negative_line(ln)]
    return kept if kept else ["No significant abnormality."]


# A bare section header — e.g. "2. Interosseous ligaments." followed by its own sub-items
# ("Scapholunate ligament: Unremarkable.", ...) each on their own line — carries no clinical
# content of its own and must not be sent to the translator as if it were a finding, or it comes
# back as a meaningless conclusion line like "Interosseous ligaments." Detected as: a short,
# colon-free numbered line immediately followed by an un-numbered line (its sub-item), as
# opposed to a real numbered finding, which either has its own "label: value" content or is
# followed by the next top-level number.
_BARE_HEADER_RE = re.compile(r"^\d+[.)]\s*[A-Za-z][A-Za-z\s\-/]{0,45}\.?$")
_NUMBERED_ITEM_RE = re.compile(r"^\d+[.)]\s")


def _is_bare_section_header(line: str, next_line: str | None) -> bool:
    if ":" in line or next_line is None:
        return False
    if not _BARE_HEADER_RE.match(line):
        return False
    return not _NUMBERED_ITEM_RE.match(next_line)


def _drop_bare_section_headers(lines: list[str]) -> list[str]:
    return [ln for i, ln in enumerate(lines) if not _is_bare_section_header(ln, lines[i + 1] if i + 1 < len(lines) else None)]


def _parse_conclusion_lines(raw: str) -> list[str]:
    lines = []
    for raw_line in raw.splitlines():
        line = raw_line.strip().strip("*").strip()
        if not line or _HEADER_ONLY_RE.match(line):
            continue
        line = _LEADING_NUMBER_RE.sub("", line).strip()
        if line:
            lines.append(line)
    return lines


def generate_conclusion(findings_text: str, modality: str, body_region: str, previous_report: str = "") -> str:
    client = get_client()
    lines = [ln.strip() for ln in findings_text.splitlines() if ln.strip()]
    lines = _drop_bare_section_headers(lines)
    if not lines:
        return ""

    numbered = "\n".join(f"{i}. {ln}" for i, ln in enumerate(lines, 1))
    user_content = (
        f"Modality: {modality}\nBody region: {body_region}\n\n"
        f"Findings ({len(lines)} sentences):\n{numbered}"
        + style_reference_block(previous_report)
    )
    messages = [{"role": "user", "content": user_content}]
    response = client.messages.create(
        model=CONCLUSION_MODEL,
        max_tokens=2048,
        system=conclusion_generation_system_prompt(),
        messages=messages,
    )
    raw = _first_text(response).strip()
    out_lines = _parse_conclusion_lines(raw)

    if len(out_lines) != len(lines):
        retry_messages = messages + [
            {"role": "assistant", "content": raw},
            {
                "role": "user",
                "content": (
                    f"That was {len(out_lines)} lines but the input had exactly {len(lines)} "
                    "sentences. Every single sentence must become exactly one output line — "
                    "output again, translating all of them, nothing omitted."
                ),
            },
        ]
        retry_response = client.messages.create(
            model=CONCLUSION_MODEL,
            max_tokens=2048,
            system=conclusion_generation_system_prompt(),
            messages=retry_messages,
        )
        retry_raw = _first_text(retry_response).strip()
        retry_lines = _parse_conclusion_lines(retry_raw)
        if abs(len(retry_lines) - len(lines)) < abs(len(out_lines) - len(lines)):
            out_lines = retry_lines

    out_lines = _drop_routine_negative_lines(out_lines)
    return _format_conclusion_lines(out_lines)


def get_clinical_checkpoints(
    patient_context: str,
    modality: str,
    body_region: str,
    findings_text: str,
    images: list[tuple[str, str]] | None = None,
) -> ClinicalCheckpointsResult:
    client = get_client()
    user_text = (
        f"Modality: {modality}\nBody region: {body_region}\n"
        f"Patient symptoms/history: {patient_context or '(not provided)'}\n\n"
        f"Findings:\n{findings_text}"
    )
    content: list = [
        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}}
        for data, mime in (images or [])
    ]
    content.append({"type": "text", "text": user_text})
    user_content = content if images else user_text

    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        temperature=0.3,
        system=clinical_checkpoints_system_prompt(),
        output_config={
            "format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "properties": {
                        "checkpoints": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "point": {"type": "string"},
                                    "rationale": {"type": "string"},
                                },
                                "required": ["point", "rationale"],
                                "additionalProperties": False,
                            },
                        },
                        "differential_diagnoses": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "diagnosis": {"type": "string"},
                                    "supporting_findings": {"type": "string"},
                                },
                                "required": ["diagnosis", "supporting_findings"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["checkpoints", "differential_diagnoses"],
                    "additionalProperties": False,
                },
            }
        },
        messages=[{"role": "user", "content": user_content}],
    )
    data = json.loads(_first_text(response))
    return ClinicalCheckpointsResult(**data)


def analyze_clinical_context(
    patient_context: str,
    modality: str,
    body_region: str,
) -> ClinicalContextAnalysisResult:
    client = get_client()
    user_text = f"Modality: {modality}\nBody region: {body_region}\n\nClinical chart/history:\n{patient_context}"

    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        temperature=0.3,
        system=clinical_context_analysis_system_prompt(),
        output_config={
            "format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "properties": {
                        "clinical_impressions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "impression": {"type": "string"},
                                    "rationale": {"type": "string"},
                                },
                                "required": ["impression", "rationale"],
                                "additionalProperties": False,
                            },
                        },
                        "imaging_considerations": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "point": {"type": "string"},
                                    "rationale": {"type": "string"},
                                },
                                "required": ["point", "rationale"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["clinical_impressions", "imaging_considerations"],
                    "additionalProperties": False,
                },
            }
        },
        messages=[{"role": "user", "content": user_text}],
    )
    data = json.loads(_first_text(response))
    return ClinicalContextAnalysisResult(**data)


def answer_question(
    question: str,
    modality: str = "",
    body_region: str = "",
    findings_text: str = "",
) -> str:
    client = get_client()
    context_lines = []
    if modality or body_region:
        context_lines.append(f"Modality: {modality or '(not specified)'}\nBody region: {body_region or '(not specified)'}")
    if findings_text.strip():
        context_lines.append(f"Findings written so far for the current case:\n{findings_text.strip()}")
    context = "\n\n".join(context_lines)
    user_content = f"{context}\n\nQuestion: {question}" if context else f"Question: {question}"

    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        temperature=0.3,
        system=free_question_system_prompt(),
        messages=[{"role": "user", "content": user_content}],
    )
    return _first_text(response).strip()
