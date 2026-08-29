"""Cross-machine sync for normal templates and post-processing rules.

Each machine periodically exports its current templates/rules to a single JSON
file living in a cloud-synced folder (e.g. OneDrive), and merges in whatever
the file contains. Local `group_id`/`id` values are per-machine autoincrement
integers and can collide across machines, so matching across machines is done
via a `sync_key` UUID that is generated once per template-group/rule and never
reused. Merges are last-writer-wins by `updated_at`. Rule deletions are hard
deletes, so a small tombstone table records deleted `sync_key`s to stop a
stale copy on another machine from being resurrected by a later import.
"""

import json
import os
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models_db import NormalTemplate, PostProcessingRule, RuleTombstone


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def sync_file_path() -> Path | None:
    if settings.sync_dir is None:
        return None
    return settings.sync_dir / "sync.json"


def export_state(db: Session) -> dict:
    templates = []
    seen_groups = set()
    stmt = select(NormalTemplate).order_by(NormalTemplate.group_id, NormalTemplate.version.desc())
    for t in db.scalars(stmt).all():
        if t.group_id in seen_groups:
            continue
        seen_groups.add(t.group_id)
        templates.append(
            {
                "sync_key": t.sync_key,
                "modality": t.modality,
                "body_region": t.body_region,
                "title": t.title,
                "findings_text": t.findings_text,
                "conclusion_text": t.conclusion_text,
                "seq_text": t.seq_text,
                "is_active": t.is_active,
                "updated_at": t.updated_at.isoformat(),
            }
        )

    rules = [
        {
            "sync_key": r.sync_key,
            "find_text": r.find_text,
            "replace_text": r.replace_text,
            "is_active": r.is_active,
            "updated_at": r.updated_at.isoformat(),
        }
        for r in db.scalars(select(PostProcessingRule)).all()
    ]

    rule_tombstones = [
        {"sync_key": tb.sync_key, "deleted_at": tb.deleted_at.isoformat()}
        for tb in db.scalars(select(RuleTombstone)).all()
    ]

    return {"templates": templates, "rules": rules, "rule_tombstones": rule_tombstones}


def apply_import(db: Session, incoming: dict) -> None:
    _apply_rule_tombstones(db, incoming.get("rule_tombstones", []))
    tombstoned_keys = {tb["sync_key"] for tb in incoming.get("rule_tombstones", [])}

    for r in incoming.get("rules", []):
        if r["sync_key"] in tombstoned_keys:
            continue
        _merge_rule(db, r)

    for t in incoming.get("templates", []):
        _merge_template(db, t)

    db.commit()


def _apply_rule_tombstones(db: Session, tombstones: list[dict]) -> None:
    if not tombstones:
        return
    local_keys = {tb.sync_key for tb in db.scalars(select(RuleTombstone)).all()}
    for tb in tombstones:
        if tb["sync_key"] not in local_keys:
            db.add(RuleTombstone(sync_key=tb["sync_key"], deleted_at=_parse_dt(tb["deleted_at"])))
            local_keys.add(tb["sync_key"])
        existing = db.scalars(
            select(PostProcessingRule).where(PostProcessingRule.sync_key == tb["sync_key"])
        ).first()
        if existing is not None:
            db.delete(existing)


def _merge_rule(db: Session, incoming: dict) -> None:
    existing = db.scalars(
        select(PostProcessingRule).where(PostProcessingRule.sync_key == incoming["sync_key"])
    ).first()
    incoming_updated = _parse_dt(incoming["updated_at"])

    if existing is None:
        db.add(
            PostProcessingRule(
                sync_key=incoming["sync_key"],
                find_text=incoming["find_text"],
                replace_text=incoming["replace_text"],
                is_active=incoming["is_active"],
                created_at=incoming_updated,
                updated_at=incoming_updated,
            )
        )
    elif incoming_updated > existing.updated_at:
        existing.find_text = incoming["find_text"]
        existing.replace_text = incoming["replace_text"]
        existing.is_active = incoming["is_active"]
        existing.updated_at = incoming_updated


def _merge_template(db: Session, incoming: dict) -> None:
    versions = db.scalars(
        select(NormalTemplate)
        .where(NormalTemplate.sync_key == incoming["sync_key"])
        .order_by(NormalTemplate.version.desc())
    ).all()
    incoming_updated = _parse_dt(incoming["updated_at"])

    if not versions:
        new_row = NormalTemplate(
            group_id=0,
            sync_key=incoming["sync_key"],
            modality=incoming["modality"],
            body_region=incoming["body_region"],
            title=incoming["title"],
            findings_text=incoming["findings_text"],
            conclusion_text=incoming["conclusion_text"],
            seq_text=incoming.get("seq_text", ""),
            version=1,
            is_active=incoming["is_active"],
            created_at=incoming_updated,
            updated_at=incoming_updated,
        )
        db.add(new_row)
        db.flush()
        new_row.group_id = new_row.id
        return

    latest = versions[0]
    if incoming_updated <= latest.updated_at:
        return

    if latest.is_active:
        latest.is_active = False

    db.add(
        NormalTemplate(
            group_id=latest.group_id,
            sync_key=incoming["sync_key"],
            modality=incoming["modality"],
            body_region=incoming["body_region"],
            title=incoming["title"],
            findings_text=incoming["findings_text"],
            conclusion_text=incoming["conclusion_text"],
            seq_text=incoming.get("seq_text", ""),
            version=latest.version + 1,
            is_active=incoming["is_active"],
            created_at=incoming_updated,
            updated_at=incoming_updated,
        )
    )


def write_sync_file(db: Session) -> None:
    path = sync_file_path()
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    state = export_state(db)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def read_and_apply_sync_file(db: Session) -> bool:
    path = sync_file_path()
    if path is None or not path.exists():
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            incoming = json.load(f)
    except (json.JSONDecodeError, OSError):
        # File may be mid-write by the cloud sync client; just retry next cycle.
        return False
    apply_import(db, incoming)
    return True


def run_sync_cycle(db: Session) -> None:
    read_and_apply_sync_file(db)
    write_sync_file(db)


def start_background_sync_loop(interval_seconds: int = 20) -> None:
    if sync_file_path() is None:
        print("[sync] OneDrive folder not detected — cross-machine template/rule sync is disabled.")
        return

    from app.db import SessionLocal

    def _loop():
        while True:
            time.sleep(interval_seconds)
            db = SessionLocal()
            try:
                run_sync_cycle(db)
            except Exception as e:
                print(f"[sync] background sync failed: {e}")
            finally:
                db.close()

    threading.Thread(target=_loop, daemon=True).start()
    print(f"[sync] cross-machine sync enabled: {sync_file_path()}")
