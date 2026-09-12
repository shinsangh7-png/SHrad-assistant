# Creates a "Rad AI" shortcut on this machine's Desktop that launches the
# GitHub Pages-hosted consult app in a Chrome "app window" (no tabs/address
# bar), so it behaves like a real installed app that can stay open on its
# own, separate from the SH Rad transcribe app.
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
$shortcut.Arguments = "--app=`"$url`""
$shortcut.WorkingDirectory = Split-Path $chrome
$shortcut.IconLocation = "$chrome,0"
$shortcut.Description = "Rad AI - GPT/Gemini/Claude 영상의학 문의"
$shortcut.Save()

Write-Host "Created: $shortcutPath"
