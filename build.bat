@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo ============================================
echo   C Sizeof Hover — 环境检查与构建
echo ============================================
echo.

REM -------------------------------------------------
REM Step 1: Check Node.js
REM -------------------------------------------------
echo [1/5] 检查 Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   错误: 未找到 Node.js。
    echo   请从 https://nodejs.org 下载 LTS 版本安装后重试。
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo   已安装: Node.js %NODE_VER%

REM Check major version ≥ 18
for /f "tokens=1 delims=v." %%a in ("%NODE_VER%") do set NODE_MAJOR=%%a
if %NODE_MAJOR% lss 18 (
    echo   错误: Node.js 版本过低 ^(%NODE_MAJOR%^), 需要 ≥ 18。
    echo   请从 https://nodejs.org 下载 LTS 版本升级。
    pause
    exit /b 1
)

REM -------------------------------------------------
REM Step 2: Check npm
REM -------------------------------------------------
echo [2/5] 检查 npm...

for /f "tokens=*" %%v in ('npm --version') do set NPM_VER=%%v
echo   npm %NPM_VER%

REM -------------------------------------------------
REM Step 3: Install dependencies
REM -------------------------------------------------
echo [3/5] 检查依赖...

if not exist "node_modules\" (
    echo   正在 npm install ...
    call npm install
    if %errorlevel% neq 0 (
        echo   错误: npm install 失败。
        pause
        exit /b 1
    )
) else (
    echo   node_modules 已存在，跳过。
)

REM -------------------------------------------------
REM Step 4: Compile
REM -------------------------------------------------
echo [4/5] 编译...

call npm run compile
if %errorlevel% neq 0 (
    echo   错误: 编译失败。
    pause
    exit /b 1
)

echo   编译成功: out\extension.js

REM -------------------------------------------------
REM Step 5: Package VSIX
REM -------------------------------------------------
echo [5/5] 打包 VSIX...

call npx @vscode/vsce package
if %errorlevel% neq 0 (
    echo   错误: 打包失败。
    pause
    exit /b 1
)

echo.
echo ============================================
echo   构建完成
echo ============================================
echo.
dir /b *.vsix 2>nul
echo.
pause
