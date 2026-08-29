# Creates a "SH Rad Assistant" shortcut on this machine's Desktop that opens
# the app in the default browser.
$desktop = [Environment]::GetFolderPath("Desktop")
$path = Join-Path $desktop "SH Rad Assistant.url"
@"
[InternetShortcut]
URL=http://127.0.0.1:8000
IconIndex=0
"@ | Set-Content -Path $path -Encoding ASCII
Write-Host "Created: $path"
