import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models_db import PostProcessingRule, RuleTombstone
from app.schemas import RuleCreate, RuleOut, RuleUpdate
from app.sync import write_sync_file

router = APIRouter(prefix="/api/rules", tags=["rules"])


@router.get("", response_model=list[RuleOut])
def list_rules(db: Session = Depends(get_db)):
    stmt = select(PostProcessingRule).order_by(PostProcessingRule.id)
    return db.scalars(stmt).all()


@router.post("", response_model=RuleOut)
def create_rule(payload: RuleCreate, db: Session = Depends(get_db)):
    rule = PostProcessingRule(sync_key=uuid.uuid4().hex, find_text=payload.find_text, replace_text=payload.replace_text)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    write_sync_file(db)
    return rule


@router.put("/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: int, payload: RuleUpdate, db: Session = Depends(get_db)):
    rule = db.get(PostProcessingRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    rule.find_text = payload.find_text
    rule.replace_text = payload.replace_text
    rule.is_active = payload.is_active
    db.commit()
    db.refresh(rule)
    write_sync_file(db)
    return rule


@router.delete("/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(PostProcessingRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    db.add(RuleTombstone(sync_key=rule.sync_key))
    db.delete(rule)
    db.commit()
    write_sync_file(db)
    return {"ok": True}
