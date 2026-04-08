# ─── Jurassic Survival — Deploy to Samsung Galaxy Tab A9 ──────────────────────
# Device:   Samsung SM-X218U (Galaxy Tab A9)
# Serial:   R92X308ZVHF
# Screen:   1200x1920 @ 240dpi  (landscape: 1920x1200)
# Android:  16  (SDK 36)
#
# Run from the JurassicSurvival_Android folder:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1

$ErrorActionPreference = 'Stop'

$DEVICE      = 'R92X308ZVHF'   # Samsung Galaxy Tab A9
$ADB         = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$JAVA_HOME   = 'C:\Program Files\Android\Android Studio\jbr'
$ANDROID_SDK = "$env:LOCALAPPDATA\Android\Sdk"
$APK         = "$PSScriptRoot\android\app\build\outputs\apk\debug\app-debug.apk"
$PACKAGE     = 'com.jurassicsurvival.game'
$ACTIVITY    = "$PACKAGE/.MainActivity"

$env:JAVA_HOME    = $JAVA_HOME
$env:ANDROID_HOME = $ANDROID_SDK
$env:PATH         = "$JAVA_HOME\bin;$ANDROID_SDK\platform-tools;$env:PATH"

Write-Host "`n=== Jurassic Survival — Deploy to Galaxy Tab A9 ===" -ForegroundColor Cyan

# Check tablet is connected and authorized
$deviceStatus = & $ADB devices | Select-String -Pattern "\sdevice$"
if (-not $deviceStatus) {
    Write-Host "ERROR: No authorized Android device found. Plug it in and make sure USB debugging is enabled." -ForegroundColor Red
    exit 1
}
$DEVICE = $deviceStatus.ToString().Split("`t")[0].Trim()
Write-Host "Device detected: $DEVICE" -ForegroundColor Green

# 1. Sync www/ assets into the Android project
Write-Host "`n[1/3] Syncing www/ assets..." -ForegroundColor Yellow
node node_modules/@capacitor/cli/bin/capacitor copy android

# 2. Build debug APK
Write-Host "`n[2/3] Building APK..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot\android"
.\gradlew.bat assembleDebug
Pop-Location

# 3. Install + launch on tablet
Write-Host "`n[3/3] Installing on Galaxy Tab A9 and launching..." -ForegroundColor Yellow
& $ADB -s $DEVICE install -r $APK
& $ADB -s $DEVICE shell am start -n $ACTIVITY

Write-Host "`n=== Done! Jurassic Survival launched on Galaxy Tab A9. ===" -ForegroundColor Green
