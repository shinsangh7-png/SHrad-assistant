# Creates a "Rad AI" Desktop shortcut that launches the app in its own
# dedicated Chrome profile ("RadAI"), not the default profile. A plain
# "--app=<url>" shortcut (or an incomplete PWA install) can still end up
# sharing Chrome's generic app-window identity with other app shortcuts,
# which is what caused Rad AI and SH Rad to group under one taskbar icon.
# A separate --profile-directory reliably gets Windows to treat it as a
# fully distinct app, so it never groups with anything else.
#
# Trade-off: this profile is isolated storage, so the Rad AI API keys need
# to be entered once inside this window (Settings gear) even if they're
# already saved in your regular Chrome profile.
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Rad AI.lnk"
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
    $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
    $chrome = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
    Write-Error "Chrome을 찾을 수 없습니다. Chrome 설치 경로를 확인해주세요."
    exit 1
}

$url = "https://shinsangh7-png.github.io/SHrad-assistant/consult.html"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $chrome
$shortcut.Arguments = "--profile-directory=`"RadAI`" --app=`"$url`""
$shortcut.WorkingDirectory = Split-Path $chrome
$shortcut.IconLocation = "$chrome,0"
$shortcut.Description = "Rad AI - GPT/Gemini/Claude 영상의학 문의 (별도 Chrome 프로필)"
$shortcut.Save()

Write-Host "Created: $shortcutPath"
