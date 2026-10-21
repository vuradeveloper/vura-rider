@echo off
rem Build the RIDER Figma UI APK (Capacitor wrapper).
rem
rem WHY THIS SCRIPT EXISTS: `npx cap sync` REGENERATES android/app/capacitor.build.gradle
rem and re-pins Java 21, but this machine only has JDK 17 — so a plain
rem sync-then-gradle sequence fails with "invalid source release: 21".
rem This always re-applies the Java 17 patch AFTER the sync.
rem Named with a leading underscore so /.gitignore's /_*.cmd rule keeps it out of git.
setlocal
set ANDROID_HOME=C:\Android
cd /d C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\figma-ui

echo === 1/4 web build ===
call npm run build || exit /b 1

echo === 2/4 cap sync ===
call npx cap sync android || exit /b 1

echo === 3/4 re-patch Java 21 -> 17 ===
rem Every Capacitor module ships its own build.gradle pinning Java 21. The list of
rem files is DISCOVERED rather than hardcoded, so adding a plugin (e.g.
rem @capacitor/browser) cannot break the build with "invalid source release: 21".
powershell -NoProfile -Command "$fs=@('android\app\capacitor.build.gradle','android\capacitor-cordova-android-plugins\build.gradle') + @(Get-ChildItem 'node_modules\@capacitor' -Recurse -Filter build.gradle -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }); foreach($f in $fs){ if(Test-Path $f){ $t=Get-Content $f -Raw; $n=$t -replace 'JavaVersion\.VERSION_21','JavaVersion.VERSION_17'; if($t -ne $n){ Set-Content -Path $f -Value $n -NoNewline; Write-Host ('patched ' + $f) } } }"

echo === 3b/4 ensure LOCATION permissions (rider needs GPS) ===
powershell -NoProfile -Command "$m='android\app\src\main\AndroidManifest.xml'; if(Test-Path $m){ $t=Get-Content $m -Raw; if($t -notmatch 'ACCESS_FINE_LOCATION'){ $t=$t -replace '</manifest>', '    <uses-permission android:name=\"android.permission.ACCESS_FINE_LOCATION\" />' + [Environment]::NewLine + '    <uses-permission android:name=\"android.permission.ACCESS_COARSE_LOCATION\" />' + [Environment]::NewLine + '</manifest>'; Set-Content -Path $m -Value $t -NoNewline; Write-Host 'added location permissions' } else { Write-Host 'location permissions already present' } }"

echo === 4/4 gradle assembleDebug ===
cd /d C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\figma-ui\android
call gradlew.bat -Djava.net.preferIPv4Stack=true --no-daemon assembleDebug >> ..\figma_gradle_build.log 2>&1
echo FIGMA_GRADLE_EXITCODE=%ERRORLEVEL% >> ..\figma_gradle_build.log
endlocal