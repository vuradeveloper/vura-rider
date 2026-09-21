@echo off
rmdir /s /q "%TEMP%\metro-cache" 2>nul
cd /d C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider
set EXPO_PUBLIC_API_URL=https://api.ridevura.com
set EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyBGm-ZLGapWTSc2T9NUP9M5ytk6z-qzoHU
set EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=vura-a272c.firebaseapp.com
set EXPO_PUBLIC_FIREBASE_PROJECT_ID=vura-a272c
set EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=vura-a272c.firebasestorage.app
set EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=117456561164
set EXPO_PUBLIC_FIREBASE_APP_ID=1:117456561164:web:8406918a7420b82e0b3a29
rem EAS UPDATE config — WITHOUT these two the built app cannot check for updates
rem ("Couldn't check for updates") and OTA updates never reach the phone.
set EXPO_UPDATES_CHANNEL=preview
set EXPO_UPDATES_URL=https://u.expo.dev/ed31c62e-f459-43d5-bc27-d9407298848e
cd /d C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\android
call gradlew.bat -Djava.net.preferIPv4Stack=true --no-daemon assembleRelease >> ..\rider_gradle_build.log 2>&1
echo GRADLE_EXITCODE=%ERRORLEVEL% >> ..\rider_gradle_build.log