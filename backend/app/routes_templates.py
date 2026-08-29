import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models_db import NormalTemplate
from app.schemas import TemplateCreate, TemplateOut
from app.sync import write_sync_file

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=list[TemplateOut])
def list_active_templates(db: Session = Depends(get_db)):
    stmt = select(NormalTemplate).where(NormalTemplate.is_active.is_(True)).order_by(
        NormalTemplate.modality, NormalTemplate.body_region, NormalTemplate.title
    )
    return db.scalars(stmt).all()


@router.get("/by-region", response_model=list[TemplateOut])
def list_templates_by_region(modality: str, body_region: str, db: Session = Depends(get_db)):
    # "All" templates are common templates meant to show up regardless of which specific
    # body region is selected for that modality.
    region_filter = (
        NormalTemplate.body_region == "All"
        if body_region == "All"
        else or_(NormalTemplate.body_region == body_region, NormalTemplate.body_region == "All")
    )
    stmt = select(NormalTemplate).where(
        NormalTemplate.modality == modality,
        region_filter,
        NormalTemplate.is_active.is_(True),
    ).order_by(NormalTemplate.body_region, NormalTemplate.title)
    return db.scalars(stmt).all()


@router.get("/history", response_model=list[TemplateOut])
def get_template_history(group_id: int, db: Session = Depends(get_db)):
    stmt = (
        select(NormalTemplate)
        .where(NormalTemplate.group_id == group_id)
        .order_by(NormalTemplate.version.desc())
    )
    return db.scalars(stmt).all()


@router.post("", response_model=TemplateOut)
def save_template(payload: TemplateCreate, db: Session = Depends(get_db)):
    next_version = 1
    group_id = payload.group_id

    sync_key = uuid.uuid4().hex

    if group_id is not None:
        stmt = select(NormalTemplate).where(
            NormalTemplate.group_id == group_id,
            NormalTemplate.is_active.is_(True),
        )
        current = db.scalars(stmt).first()
        if current is None:
            raise HTTPException(status_code=404, detail="해당 템플릿을 찾을 수 없습니다.")
        current.is_active = False
        next_version = current.version + 1
        sync_key = current.sync_key

    new_template = NormalTemplate(
        group_id=group_id if group_id is not None else 0,  # placeholder, fixed below if new group
        sync_key=sync_key,
        modality=payload.modality,
        body_region=payload.body_region,
        title=payload.title,
        findings_text=payload.findings_text,
        conclusion_text=payload.conclusion_text,
        seq_text=payload.seq_text,
        version=next_version,
        is_active=True,
    )
    db.add(new_template)
    db.flush()
    if group_id is None:
        new_template.group_id = new_template.id
    db.commit()
    db.refresh(new_template)
    write_sync_file(db)
    return new_template


@router.delete("/{group_id}")
def deactivate_template(group_id: int, db: Session = Depends(get_db)):
    stmt = select(NormalTemplate).where(
        NormalTemplate.group_id == group_id,
        NormalTemplate.is_active.is_(True),
    )
    current = db.scalars(stmt).first()
    if current is None:
        raise HTTPException(status_code=404, detail="해당 템플릿을 찾을 수 없습니다.")
    current.is_active = False
    db.commit()
    write_sync_file(db)
    return {"ok": True}
