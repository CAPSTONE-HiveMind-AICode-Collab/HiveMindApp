@echo off
echo ========================================
echo Firebase Deployment Script
echo ========================================
echo.

echo Step 1: Installing Functions dependencies...
cd functions
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install functions dependencies
    pause
    exit /b 1
)
cd ..
echo Functions dependencies installed!
echo.

echo Step 2: Building Next.js app...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Failed to build Next.js app
    pause
    exit /b 1
)
echo Build complete!
echo.

echo Step 3: Checking Firebase CLI...
call firebase --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Firebase CLI not found. Installing...
    call npm install -g firebase-tools
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Firebase CLI
        pause
        exit /b 1
    )
)
echo Firebase CLI ready!
echo.

echo Step 4: Logging in to Firebase...
call firebase login
if %errorlevel% neq 0 (
    echo ERROR: Firebase login failed
    pause
    exit /b 1
)
echo.

echo Step 5: Deploying to Firebase...
call firebase deploy
if %errorlevel% neq 0 (
    echo ERROR: Deployment failed
    pause
    exit /b 1
)
echo.

echo ========================================
echo Deployment Complete!
echo ========================================
echo.
echo Your app is now live at:
echo https://hivemind-d23e7.web.app
echo.
pause
