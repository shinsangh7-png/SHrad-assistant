import concurrent.futures

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.llm.client import (
    analyze_clinical_context,
    answer_question,
    correct_grammar,
    generate_conclusion,
    get_clinical_checkpoints,
)
from app.llm.gemini_client import analyze_clinical_context_gemini, answer_question_gemini, get_clinical_checkpoints_gemini
from app.llm.schemas import ClinicalCheckpointsResult, ClinicalContextAnalysisResult
from app.postprocessing import apply_postprocessing_rules

router = APIRouter(prefix="/api/text", tags=["text"])


class GrammarRequest(BaseModel):
    text: str
    previous_report: str = ""
    mode: str = "local"  # "local" (English-only dictation) or "smc" (Korean/English mixed)


class GrammarResponse(BaseModel):
    corrected_text: str


class ConclusionRequest(BaseModel):
    findings_text: str
    modality: str
    body_region: str
    previous_report: str = ""


class ConclusionResponse(BaseModel):
    conclusion: str


class ImageInput(BaseModel):
    data: str  # base64-encoded, no data: URI prefix
    mime_type: str


class CheckpointsRequest(BaseModel):
    patient_context: str = ""
    modality: str
    body_region: str
    findings_text: str
    images: list[ImageInput] = []


class DualCheckpointsResponse(BaseModel):
    claude: ClinicalCheckpointsResult | None = None
    claude_error: str | None = None
    gemini: ClinicalCheckpointsResult | None = None
    gemini_error: str | None = None


class ClinicalContextRequest(BaseModel):
    patient_context: str
    modality: str = ""
    body_region: str = ""


class DualClinicalContextResponse(BaseModel):
    claude: ClinicalContextAnalysisResult | None = None
    claude_error: str | None = None
    gemini: ClinicalContextAnalysisResult | None = None
    gemini_error: str | None = None


class AskRequest(BaseModel):
    question: str
    modality: str = ""
    body_region: str = ""
    findings_text: str = ""


class DualAskResponse(BaseModel):
    claude: str | None = None
    claude_error: str | None = None
    gemini: str | None = None
    gemini_error: str | None = None


def _anthropic_error_message(e: Exception) -> str | None:
    if isinstance(e, anthropic.AuthenticationError):
        return "ANTHROPIC_API_KEY가 유효하지 않습니다."
    if isinstance(e, anthropic.RateLimitError):
        return "Claude API 요청 한도 초과. 잠시 후 다시 시도해주세요."
    if isinstance(e, anthropic.APIStatusError):
        return f"Claude API 오류: {e.message}"
    if isinstance(e, anthropic.APIConnectionError):
        return "Claude API에 연결할 수 없습니다."
    if isinstance(e, TypeError) and "authentication" in str(e).lower():
        return "ANTHROPIC_API_KEY가 설정되지 않았습니다. backend/.env 파일에 추가해주세요."
    return None


def _call(fn, *args):
    try:
        return fn(*args)
    except Exception as e:
        message = _anthropic_error_message(e)
        if message is None:
            raise
        status = 429 if isinstance(e, anthropic.RateLimitError) else 500
        raise HTTPException(status_code=status, detail=message)


# Gemini's SDK has been observed to hang indefinitely (not just error out) during API-side
# outages/high-demand periods, rather than failing fast — which would otherwise stall the whole
# request forever with no feedback to the UI even though Claude's side already succeeded. Enforce
# a hard wall-clock deadline in a throwaway thread so a stuck call can't block the response.
def _call_gemini_with_deadline(fn, *args, timeout: float = 25.0):
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(fn, *args)
    try:
        return future.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        raise RuntimeError("Gemini API 응답이 너무 오래 걸려 시간 초과되었습니다 (서비스 지연/장애로 추정). 잠시 후 다시 시도해주세요.")
    finally:
        executor.shutdown(wait=False)


@router.post("/correct", response_model=GrammarResponse)
def correct(payload: GrammarRequest, db: Session = Depends(get_db)):
    text = _call(correct_grammar, payload.text, payload.previous_report, payload.mode)
    text = apply_postprocessing_rules(text, db)
    return GrammarResponse(corrected_text=text)


@router.post("/conclusion", response_model=ConclusionResponse)
def conclusion(payload: ConclusionRequest):
    text = _call(
        generate_conclusion, payload.findings_text, payload.modality, payload.body_region, payload.previous_report
    )
    return ConclusionResponse(conclusion=text)


@router.post("/checkpoints", response_model=DualCheckpointsResponse)
def checkpoints(payload: CheckpointsRequest):
    result = DualCheckpointsResponse()

    images = [(img.data, img.mime_type) for img in payload.images]

    try:
        result.claude = get_clinical_checkpoints(
            payload.patient_context, payload.modality, payload.body_region, payload.findings_text, images
        )
    except Exception as e:
        result.claude_error = _anthropic_error_message(e) or f"Claude 오류: {e}"

    try:
        result.gemini = _call_gemini_with_deadline(
            get_clinical_checkpoints_gemini,
            payload.patient_context, payload.modality, payload.body_region, payload.findings_text, images,
        )
    except Exception as e:
        result.gemini_error = str(e)

    return result


@router.post("/clinical-context", response_model=DualClinicalContextResponse)
def clinical_context(payload: ClinicalContextRequest):
    if not payload.patient_context.strip():
        raise HTTPException(status_code=400, detail="Clinical information을 입력해주세요.")

    result = DualClinicalContextResponse()

    try:
        result.claude = analyze_clinical_context(payload.patient_context, payload.modality, payload.body_region)
    except Exception as e:
        result.claude_error = _anthropic_error_message(e) or f"Claude 오류: {e}"

    try:
        result.gemini = _call_gemini_with_deadline(
            analyze_clinical_context_gemini, payload.patient_context, payload.modality, payload.body_region
        )
    except Exception as e:
        result.gemini_error = str(e)

    return result


@router.post("/ask", response_model=DualAskResponse)
def ask(payload: AskRequest):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="질문을 입력해주세요.")

    result = DualAskResponse()

    try:
        result.claude = answer_question(payload.question, payload.modality, payload.body_region, payload.findings_text)
    except Exception as e:
        result.claude_error = _anthropic_error_message(e) or f"Claude 오류: {e}"

    try:
        result.gemini = _call_gemini_with_deadline(
            answer_question_gemini, payload.question, payload.modality, payload.body_region, payload.findings_text
        )
    except Exception as e:
        result.gemini_error = str(e)

    return result
