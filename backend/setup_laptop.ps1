# One-time setup for a new machine (e.g. laptop) with no NVIDIA GPU.
# Run this from inside the backend/ folder after cloning the repo:
#   cd radiology-assist\backend
#   .\setup_laptop.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Host "1) Creating virtual environment..."
python -m venv venv

Write-Host "2) Installing dependencies (this can take a few minutes)..."
& ".\venv\Scripts\pip.exe" install -r requirements.txt

if (-not (Test-Path ".env")) {
    Write-Host "3) Creating .env from .env.example..."
    Copy-Item ".env.example" ".env"
} else {
    Write-Host "3) .env already exists, leaving it as-is."
}

$envContent = Get-Content ".env" -Raw
if ($envContent -notmatch "WHISPER_DEVICE") {
    Add-Content ".env" "`nWHISPER_DEVICE=cpu"
    Add-Content ".env" "WHISPER_COMPUTE_TYPE=int8"
    Write-Host "4) Added CPU-mode Whisper settings to .env (no GPU on this machine)."
} else {
    Write-Host "4) .env already has WHISPER_DEVICE set, leaving it as-is."
}

Write-Host ""
Write-Host "Setup done. Next steps:"
Write-Host "  1. Open backend\.env in Notepad and fill in ANTHROPIC_API_KEY and GEMINI_API_KEY:"
Write-Host "       notepad .env"
Write-Host "  2. Start the server:"
Write-Host "       .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
Write-Host "  3. Open http://127.0.0.1:8000 in your browser."
