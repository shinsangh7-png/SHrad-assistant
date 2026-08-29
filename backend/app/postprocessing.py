import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models_db import PostProcessingRule


def apply_postprocessing_rules(text: str, db: Session) -> str:
    stmt = select(PostProcessingRule).where(PostProcessingRule.is_active.is_(True))
    rules = db.scalars(stmt).all()
    for rule in rules:
        if not rule.find_text:
            continue
        pattern = re.compile(r"\b" + re.escape(rule.find_text) + r"\b", re.IGNORECASE)
        text = pattern.sub(rule.replace_text, text)
    return text
