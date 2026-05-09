@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   C Sizeof Hover - Build
echo ============================================
echo.

REM Step 1: Check Node.js
echo [1/5] Checking Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Node.js not found.
    echo   Download LTS from https://nodejs.org and try again.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo   Node.js %NODE_VER%

for /f "tokens=1 delims=v." %%a in ("%NODE_VER%") do set NODE_MAJOR=%%a
if %NODE_MAJOR% lss 18 (
    echo   ERROR: Node.js version too old ^(%NODE_MAJOR%^), need ^>= 18.
    echo   Download LTS from https://nodejs.org and upgrade.
    pause
    exit /b 1
)

REM Step 2: Check npm
echo [2/5] Checking npm...

for /f "tokens=*" %%v in ('npm --version') do set NPM_VER=%%v
echo   npm %NPM_VER%

REM Step 3: Install dependencies
echo [3/5] Checking dependencies...

if not exist "node_modules\" (
    echo   Running npm install ...
    call npm install
    if %errorlevel% neq 0 (
        echo   ERROR: npm install failed.
        pause
        exit /b 1
    )
) else (
    echo   node_modules exists, skipping.
)

REM Step 4: Compile
echo [4/5] Compiling...

call npm run compile
if %errorlevel% neq 0 (
    echo   ERROR: compile failed.
    pause
    exit /b 1
)

echo   Done: out\extension.js

REM Step 5: Package VSIX
echo [5/5] Packaging VSIX...

call npx @vscode/vsce package
if %errorlevel% neq 0 (
    echo   ERROR: package failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Build completed
echo ============================================
echo.
dir /b *.vsix 2>nul
echo.
pause
