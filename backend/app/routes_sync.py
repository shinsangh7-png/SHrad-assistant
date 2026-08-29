from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.sync import run_sync_cycle, sync_file_path

router = APIRouter(prefix="/api/sync", tags=["sync"])


class SyncStatus(BaseModel):
    enabled: bool
    synced_at: str


@router.post("/run", response_model=SyncStatus)
def run_sync(db: Session = Depends(get_db)):
    enabled = sync_file_path() is not None
    if enabled:
        run_sync_cycle(db)
    return SyncStatus(enabled=enabled, synced_at=datetime.utcnow().isoformat())
