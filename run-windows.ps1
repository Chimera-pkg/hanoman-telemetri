# Run from an extracted copy of the source code in PowerShell.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host ""; Write-Host " HANOMAN / TELEMETRI " -ForegroundColor DarkYellow
Write-Host " Checking prerequisites (Node.js, npm, cargo)..."
foreach ($tool in @("node", "npm", "cargo")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "Missing: $tool" -ForegroundColor Red
        Write-Host "See https://v2.tauri.app/start/prerequisites/" -ForegroundColor Yellow
        exit 1
    }
}
Write-Host "Synchronizing npm dependencies (includes v0.2 Document Studio)..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Launching desktop development build..." -ForegroundColor Cyan
npm run desktop:dev
exit $LASTEXITCODE
