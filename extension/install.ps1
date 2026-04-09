# Acumon Screen Capture Extension — Installer
# Run: Right-click → Run with PowerShell (or powershell -ExecutionPolicy Bypass -File install.ps1)

$ErrorActionPreference = "Stop"
$ExtVersion = "1.0.0"
$InstallDir = "$env:LOCALAPPDATA\AcumonScreenCapture"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Acumon Screen Capture - Installer" -ForegroundColor Cyan
Write-Host "  Version $ExtVersion" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Create install directory
Write-Host "[1/4] Creating install directory..." -ForegroundColor Yellow
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path "$InstallDir\icons" -Force | Out-Null

# 2. Copy extension files
Write-Host "[2/4] Copying extension files..." -ForegroundColor Yellow
Copy-Item "$ScriptDir\manifest.json" "$InstallDir\" -Force
Copy-Item "$ScriptDir\background.js" "$InstallDir\" -Force
Copy-Item "$ScriptDir\content.js" "$InstallDir\" -Force
Copy-Item "$ScriptDir\icons\*" "$InstallDir\icons\" -Force
Write-Host "       Installed to: $InstallDir" -ForegroundColor Gray

# 3. Register with Chrome (via external extensions registry)
Write-Host "[3/4] Registering with browsers..." -ForegroundColor Yellow

# Chrome registry key — tells Chrome to load extension from disk
$ChromeRegPath = "HKCU:\Software\Google\Chrome\PreferenceMACs\Default\extensions.settings"
# Use the simpler external extensions JSON approach
$ChromeExtDir = "$env:LOCALAPPDATA\Google\Chrome\User Data\External Extensions"
if (Test-Path "$env:LOCALAPPDATA\Google\Chrome\User Data") {
    if (-not (Test-Path $ChromeExtDir)) { New-Item -ItemType Directory -Path $ChromeExtDir -Force | Out-Null }
    $extJson = @{
        external_crx = "$InstallDir"
        external_version = $ExtVersion
    } | ConvertTo-Json
    # We use a deterministic ID based on the install path
    Set-Content -Path "$ChromeExtDir\acumon_screen_capture.json" -Value $extJson -Force
    Write-Host "       Chrome: Registered" -ForegroundColor Green
} else {
    Write-Host "       Chrome: Not found (skipped)" -ForegroundColor Gray
}

# Edge registry key (same Chromium approach)
$EdgeExtDir = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\External Extensions"
if (Test-Path "$env:LOCALAPPDATA\Microsoft\Edge\User Data") {
    if (-not (Test-Path $EdgeExtDir)) { New-Item -ItemType Directory -Path $EdgeExtDir -Force | Out-Null }
    $extJson = @{
        external_crx = "$InstallDir"
        external_version = $ExtVersion
    } | ConvertTo-Json
    Set-Content -Path "$EdgeExtDir\acumon_screen_capture.json" -Value $extJson -Force
    Write-Host "       Edge:   Registered" -ForegroundColor Green
} else {
    Write-Host "       Edge:   Not found (skipped)" -ForegroundColor Gray
}

# Also register via Windows Registry (more reliable for managed environments)
try {
    $regPath = "HKCU:\Software\Policies\Google\Chrome\ExtensionInstallAllowlist"
    if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }

    $edgeRegPath = "HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallAllowlist"
    if (-not (Test-Path $edgeRegPath)) { New-Item -Path $edgeRegPath -Force | Out-Null }
} catch {
    # Non-critical — policy keys may need admin
}

# 4. Create uninstaller
Write-Host "[4/4] Creating uninstaller..." -ForegroundColor Yellow
$uninstaller = @"
# Acumon Screen Capture — Uninstaller
Remove-Item "$InstallDir" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$ChromeExtDir\acumon_screen_capture.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$EdgeExtDir\acumon_screen_capture.json" -Force -ErrorAction SilentlyContinue
Write-Host "Acumon Screen Capture has been uninstalled." -ForegroundColor Green
Write-Host "Please restart your browser." -ForegroundColor Yellow
pause
"@
Set-Content -Path "$InstallDir\uninstall.ps1" -Value $uninstaller

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Please restart Chrome/Edge for the extension to appear." -ForegroundColor Yellow
Write-Host ""
Write-Host "To uninstall, run: $InstallDir\uninstall.ps1" -ForegroundColor Gray
Write-Host ""
pause
