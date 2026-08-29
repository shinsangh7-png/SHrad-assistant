from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from app.config import BASE_DIR
from app.db import SessionLocal, init_db
from app.routes_reports import router as reports_router
from app.routes_rules import router as rules_router
from app.routes_sync import router as sync_router
from app.routes_templates import router as templates_router
from app.routes_text import router as text_router
from app.stt import vad as stt_vad
from app.stt.model import get_model as get_whisper_model
from app.stt.websocket_handler import router as transcribe_router
from app.sync import run_sync_cycle, start_background_sync_loop

FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = FastAPI(title="SH Rad Assistant")


@app.middleware("http")
async def no_cache_static_files(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and "/api/" not in request.url.path:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
def on_startup():
    init_db()
    get_whisper_model()
    stt_vad.preload()

    db = SessionLocal()
    try:
        run_sync_cycle(db)
    finally:
        db.close()
    start_background_sync_loop()


app.include_router(templates_router)
app.include_router(reports_router)
app.include_router(rules_router)
app.include_router(sync_router)
app.include_router(text_router)
app.include_router(transcribe_router)

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
