# Builds the signed Vura Rider Android release (AAB + APK).
# Run from figma-ui:  powershell -ExecutionPolicy Bypass -File scripts\build-android-release.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Capacitor 8.5.2 compiles its Android library with Java 21. Always prefer a
# JDK 21 install; an inherited JAVA_HOME pointing at JDK 17 will fail the build.
$candidates = @(
    'C:\Users\mbofh\AppData\Local\Programs\jdk-21\jdk-21.0.12.1+1'
) + (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-21*' } | ForEach-Object { $_.FullName })
$jdk = $candidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
if (-not $jdk) { throw 'JDK 21 not found. Install Temurin 21 and set JAVA_HOME to it.' }
$env:JAVA_HOME = $jdk
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'C:\Android' }

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"

npm run build
if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }

npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed' }

Push-Location android
try {
    .\gradlew.bat '-Djava.net.preferableIPv4Stack=true' --no-daemon bundleRelease assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Gradle release build failed' }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path release-artifacts | Out-Null
Copy-Item android\app\build\outputs\bundle\release\app-release.aab release-artifacts\vura-rider-1.5-release.aab -Force
Copy-Item android\app\build\outputs\apk\release\app-release.apk release-artifacts\vura-rider-1.5-release.apk -Force

Write-Host ''
Write-Host 'Release artifacts:'
Get-ChildItem release-artifacts | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
