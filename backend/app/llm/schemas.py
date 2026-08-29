from pydantic import BaseModel


class CheckpointItem(BaseModel):
    point: str
    rationale: str


class DifferentialDiagnosis(BaseModel):
    diagnosis: str
    supporting_findings: str


class ClinicalCheckpointsResult(BaseModel):
    checkpoints: list[CheckpointItem]
    differential_diagnoses: list[DifferentialDiagnosis]


class ClinicalImpressionItem(BaseModel):
    impression: str
    rationale: str


class ImagingConsiderationItem(BaseModel):
    point: str
    rationale: str


class ClinicalContextAnalysisResult(BaseModel):
    clinical_impressions: list[ClinicalImpressionItem]
    imaging_considerations: list[ImagingConsiderationItem]
