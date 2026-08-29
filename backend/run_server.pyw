import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

log_path = BASE_DIR / "data" / "server.log"
log_path.parent.mkdir(parents=True, exist_ok=True)
log_file = open(log_path, "a", encoding="utf-8", buffering=1)
sys.stdout = log_file
sys.stderr = log_file

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000)
