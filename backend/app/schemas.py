from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TemplateCreate(BaseModel):
    modality: str
    body_region: str
    title: str = ""
    findings_text: str
    conclusion_text: str = ""
    seq_text: str = ""
    # None -> create a brand-new template. Set to an existing template's group_id -> save a new
    # version of that same template instead of creating a separate one.
    group_id: int | None = None


class TemplateUpdate(BaseModel):
    title: str = ""
    findings_text: str
    conclusion_text: str = ""
    seq_text: str = ""


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    modality: str
    body_region: str
    title: str
    findings_text: str
    conclusion_text: str
    seq_text: str
    version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RuleCreate(BaseModel):
    find_text: str
    replace_text: str = ""


class RuleUpdate(BaseModel):
    find_text: str
    replace_text: str = ""
    is_active: bool = True


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    find_text: str
    replace_text: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ReportCreate(BaseModel):
    modality: str
    body_region: str
    patient_context: str = ""
    template_id: int | None = None
    findings_text: str = ""
    transcript_text: str = ""


class ReportUpdate(BaseModel):
    patient_context: str | None = None
    transcript_text: str | None = None
    findings_text: str | None = None
    conclusion_text: str | None = None
    status: str | None = None


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    modality: str
    body_region: str
    patient_context: str
    transcript_text: str
    findings_text: str
    conclusion_text: str
    template_id: int | None
    status: str
    created_at: datetime
    updated_at: datetime
