# Registers a Windows Scheduled Task that starts the SH Rad Assistant server
# silently at login, independent of any terminal window staying open.
# Run this from inside the backend/ folder, after setup_laptop.ps1 has completed:
#   .\register_autostart.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$pythonw = Join-Path $root "venv\Scripts\pythonw.exe"
$script = Join-Path $root "run_server.pyw"

if (-not (Test-Path $pythonw)) {
    Write-Host "venv not found — run setup_laptop.ps1 first."
    exit 1
}

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "SHRadAssistant" -Action $action -Trigger $trigger -Settings $settings -Description "SH Rad Assistant backend server (auto-start on login)" -Force

Write-Host "Registered. Starting it now..."
Start-ScheduledTask -TaskName "SHRadAssistant"
Write-Host "Done. It will also start automatically at every login from now on."
