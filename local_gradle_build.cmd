@echo off
cd /d "C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider"
set EXPO_PUBLIC_API_URL=https://api.ridevura.com
set EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyBGm-ZLGapWTSc2T9NUP9M5ytk6z-qzoHU
set EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=vura-a272c.firebaseapp.com
set EXPO_PUBLIC_FIREBASE_PROJECT_ID=vura-a272c
set EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=vura-a272c.firebasestorage.app
set EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=117456561164
set EXPO_PUBLIC_FIREBASE_APP_ID=1:117456561164:web:8406918a7420b82e0b3a29
echo [launcher] starting gradle assembleRelease at %date% %time% > "C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\local_gradle_build.log"
cd android
call gradlew.bat assembleRelease --no-daemon >> "C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\local_gradle_build.log" 2>&1
echo [launcher] exit code %errorlevel% at %date% %time% >> "C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\local_gradle_build.log"