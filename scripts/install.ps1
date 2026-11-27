#Requires -Version 5.1
<#
.SYNOPSIS
  Installs antigravity-hud and patches the Antigravity CLI settings to use it.

.DESCRIPTION
  1. Checks that antigravity-hud is available on PATH (via npm install -g antigravity-hud).
  2. Patches ~/.gemini/antigravity-cli/settings.json to set the statusLine command (preserving padding & stack_with_default).
  3. Optionally enables live terminal window titles with -WithTitle.
  4. Backs up the existing settings file before patching.

.EXAMPLE
  .\install.ps1
  .\install.ps1 -WithTitle
#>
param(
  [switch]$WithTitle
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$settingsDir = Join-Path $env:USERPROFILE ".gemini\antigravity-cli"
$settingsFile = Join-Path $settingsDir "settings.json"

Write-Host ""
Write-Host "  antigravity-hud installer" -ForegroundColor Cyan
Write-Host "  =========================" -ForegroundColor DarkGray
Write-Host ""

# ── Check that antigravity-hud is on PATH ──────────────────────────────
$hudBin = Get-Command "antigravity-hud" -ErrorAction SilentlyContinue
if (-not $hudBin) {
  Write-Host "  [!] antigravity-hud not found on PATH." -ForegroundColor Yellow
  Write-Host "      Run: npm install -g antigravity-hud" -ForegroundColor Gray
  Write-Host ""
  exit 1
}
Write-Host "  [OK] Found antigravity-hud at: $($hudBin.Source)" -ForegroundColor Green

# ── Ensure settings directory exists ────────────────────────────────────
if (-not (Test-Path $settingsDir)) {
  New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
  Write-Host "  [OK] Created $settingsDir" -ForegroundColor Green
}

# ── Load or create settings ─────────────────────────────────────────────
if (Test-Path $settingsFile) {
  $backupFile = Join-Path $settingsDir "settings.json.backup-antigravity-hud-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $settingsFile $backupFile -Force
  Write-Host "  [OK] Backed up settings to: $(Split-Path $backupFile -Leaf)" -ForegroundColor Green

  try {
    $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json
  } catch {
    Write-Host "  [!] Failed to parse settings.json - creating fresh config" -ForegroundColor Yellow
    $settings = [pscustomobject]@{}
  }
} else {
  $settings = [pscustomobject]@{}
  Write-Host "  [..] No existing settings.json - creating new one" -ForegroundColor Gray
}

# ── Patch statusLine (preserving padding & stack_with_default) ──────────
$statusLineMap = [ordered]@{
  type    = "command"
  command = "antigravity-hud"
  enabled = $true
}

if ($settings.PSObject.Properties["statusLine"] -and $settings.statusLine -is [pscustomobject]) {
  if ($settings.statusLine.PSObject.Properties["padding"]) {
    $statusLineMap["padding"] = $settings.statusLine.padding
  }
  if ($settings.statusLine.PSObject.Properties["stack_with_default"]) {
    $statusLineMap["stack_with_default"] = $settings.statusLine.stack_with_default
  }
}

$statusLine = [pscustomobject]$statusLineMap

if ($settings.PSObject.Properties["statusLine"]) {
  $settings.statusLine = $statusLine
} else {
  $settings | Add-Member -NotePropertyName "statusLine" -NotePropertyValue $statusLine
}

if ($WithTitle) {
  $titleObj = [pscustomobject]@{
    type    = "command"
    command = "antigravity-hud title"
    enabled = $true
  }
  if ($settings.PSObject.Properties["title"]) {
    $settings.title = $titleObj
  } else {
    $settings | Add-Member -NotePropertyName "title" -NotePropertyValue $titleObj
  }
}

# ── Write settings ──────────────────────────────────────────────────────
$json = $settings | ConvertTo-Json -Depth 10
Set-Content -Path $settingsFile -Value $json -Encoding utf8
Write-Host "  [OK] Patched statusLine in settings.json" -ForegroundColor Green
if ($WithTitle) {
  Write-Host "  [OK] Patched title in settings.json" -ForegroundColor Green
}
Write-Host ""
Write-Host "  Done! Restart your Antigravity CLI session (or run /statusline enable) to see the HUD." -ForegroundColor Cyan
Write-Host ""
