from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models_db import ReportDraft
from app.schemas import ReportCreate, ReportOut, ReportUpdate

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("", response_model=list[ReportOut])
def list_reports(limit: int = 50, db: Session = Depends(get_db)):
    stmt = select(ReportDraft).order_by(ReportDraft.updated_at.desc()).limit(limit)
    return db.scalars(stmt).all()


@router.get("/{report_id}", response_model=ReportOut)
def get_report(report_id: int, db: Session = Depends(get_db)):
    report = db.get(ReportDraft, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.post("", response_model=ReportOut)
def create_report(payload: ReportCreate, db: Session = Depends(get_db)):
    report = ReportDraft(**payload.model_dump())
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.put("/{report_id}", response_model=ReportOut)
def update_report(report_id: int, payload: ReportUpdate, db: Session = Depends(get_db)):
    report = db.get(ReportDraft, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(report, field, value)
    db.commit()
    db.refresh(report)
    return report


@router.delete("/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db)):
    report = db.get(ReportDraft, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    db.delete(report)
    db.commit()
    return {"ok": True}
