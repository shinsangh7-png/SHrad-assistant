import base64

from google import genai
from google.genai import types

from app.config import settings
from app.llm.prompts import (
    clinical_checkpoints_system_prompt,
    clinical_context_analysis_system_prompt,
    free_question_system_prompt,
)
from app.llm.schemas import ClinicalCheckpointsResult, ClinicalContextAnalysisResult

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        # Gemini's API intermittently returns 503 "high demand" (seen repeatedly in practice).
        # Without an explicit bound, a retry chain can stall the request for minutes with no
        # feedback to the UI. Bound both the per-request timeout and the retry budget so a bad
        # patch fails fast with a clear error instead of hanging.
        _client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(
                timeout=20_000,
                retry_options=types.HttpRetryOptions(attempts=2, initial_delay=1.0, max_delay=5.0),
            ),
        )
    return _client


def get_clinical_checkpoints_gemini(
    patient_context: str,
    modality: str,
    body_region: str,
    findings_text: str,
    images: list[tuple[str, str]] | None = None,
) -> ClinicalCheckpointsResult:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되지 않았습니다. backend/.env 파일에 추가해주세요.")

    client = get_client()
    user_text = (
        f"Modality: {modality}\nBody region: {body_region}\n"
        f"Patient symptoms/history: {patient_context or '(not provided)'}\n\n"
        f"Findings:\n{findings_text}"
    )
    contents: list = [
        types.Part.from_bytes(data=base64.b64decode(data), mime_type=mime) for data, mime in (images or [])
    ]
    contents.append(user_text)

    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=clinical_checkpoints_system_prompt(),
            temperature=0.3,
            response_mime_type="application/json",
            response_schema=ClinicalCheckpointsResult,
        ),
    )
    return ClinicalCheckpointsResult.model_validate_json(response.text)


def analyze_clinical_context_gemini(
    patient_context: str,
    modality: str,
    body_region: str,
) -> ClinicalContextAnalysisResult:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되지 않았습니다. backend/.env 파일에 추가해주세요.")

    client = get_client()
    user_text = f"Modality: {modality}\nBody region: {body_region}\n\nClinical chart/history:\n{patient_context}"

    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[user_text],
        config=types.GenerateContentConfig(
            system_instruction=clinical_context_analysis_system_prompt(),
            temperature=0.3,
            response_mime_type="application/json",
            response_schema=ClinicalContextAnalysisResult,
        ),
    )
    return ClinicalContextAnalysisResult.model_validate_json(response.text)


def answer_question_gemini(
    question: str,
    modality: str = "",
    body_region: str = "",
    findings_text: str = "",
) -> str:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되지 않았습니다. backend/.env 파일에 추가해주세요.")

    client = get_client()
    context_lines = []
    if modality or body_region:
        context_lines.append(f"Modality: {modality or '(not specified)'}\nBody region: {body_region or '(not specified)'}")
    if findings_text.strip():
        context_lines.append(f"Findings written so far for the current case:\n{findings_text.strip()}")
    context = "\n\n".join(context_lines)
    user_content = f"{context}\n\nQuestion: {question}" if context else f"Question: {question}"

    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[user_content],
        config=types.GenerateContentConfig(
            system_instruction=free_question_system_prompt(),
            temperature=0.3,
        ),
    )
    return response.text.strip()
