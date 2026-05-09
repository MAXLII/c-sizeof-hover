# C Sizeof Hover — build script
# Usage: .\build.ps1

$ErrorActionPreference = "Stop"

Write-Host "============================================"
Write-Host "  C Sizeof Hover - Build"
Write-Host "============================================"
Write-Host ""

# Step 1: Check Node.js
Write-Host "[1/5] Checking Node.js..."

$nodePath = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath) {
    Write-Host "  ERROR: Node.js not found."
    Write-Host "  Download LTS from https://nodejs.org and try again."
    Read-Host "Press Enter to exit"
    exit 1
}

$nodeVer = node --version
Write-Host "  Node.js $nodeVer"

$major = [int]($nodeVer -replace '^v', '').Split('.')[0]
if ($major -lt 18) {
    Write-Host "  ERROR: Node.js version too old ($major), need >= 18."
    Write-Host "  Download LTS from https://nodejs.org and upgrade."
    Read-Host "Press Enter to exit"
    exit 1
}

# Step 2: Check npm
Write-Host "[2/5] Checking npm..."

$npmVer = npm --version
Write-Host "  npm $npmVer"

# Step 3: Install dependencies
Write-Host "[3/5] Checking dependencies..."

if (-not (Test-Path "node_modules")) {
    Write-Host "  Running npm install ..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: npm install failed."
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "  node_modules exists, skipping."
}

# Step 4: Compile
Write-Host "[4/5] Compiling..."

npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: compile failed."
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "  Done: out\extension.js"

# Step 5: Package VSIX
Write-Host "[5/5] Packaging VSIX..."

npx @vscode/vsce package
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: package failed."
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "============================================"
Write-Host "  Build completed"
Write-Host "============================================"
Write-Host ""

Get-ChildItem *.vsix | ForEach-Object {
    $sizeKB = "{0:N1}" -f ($_.Length / 1KB)
    Write-Host "  $($_.Name)  ($sizeKB KB)"
}
Write-Host ""
Read-Host "Press Enter to exit"
