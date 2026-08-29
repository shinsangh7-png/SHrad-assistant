import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


def _default_sync_dir() -> Path | None:
    onedrive = os.environ.get("OneDrive") or os.environ.get("OneDriveConsumer")
    if not onedrive:
        return None
    return Path(onedrive) / "SHRadAssistant-sync"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    db_path: Path = BASE_DIR / "data" / "radiology.db"
    # Folder (ideally inside a cloud-synced drive like OneDrive) where templates/rules are
    # exported to and imported from, so multiple machines under the same account stay in sync.
    # Falls back to None (sync disabled) if no OneDrive folder is detected.
    sync_dir: Path | None = _default_sync_dir()

    whisper_model: str = "large-v3-turbo"
    whisper_device: str = "cuda"
    whisper_compute_type: str = "float16"
    whisper_beam_size: int = 2

    vad_threshold: float = 0.5
    vad_silence_flush_ms: int = 500
    vad_trailing_pad_ms: int = 200
    vad_preroll_ms: int = 300
    vad_max_buffer_s: float = 15.0
    vad_min_buffer_ms: int = 300

    anthropic_api_key: str = ""

    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    gemini_live_model: str = "gemini-3.1-flash-live-preview"

    host: str = "127.0.0.1"
    port: int = 8000


settings = Settings()
