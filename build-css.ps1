# Recompila o Tailwind CSS estático (css/tailwind.min.css) sem precisar de Node.js
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$webDir = Join-Path $root "grow.alquimistasmagicos.com.br"
$cliDir = Join-Path $env:LOCALAPPDATA "tailwindcss-cli"
$twExe = Join-Path $cliDir "tailwindcss-windows-x64.exe"

if (-not (Test-Path $twExe)) {
    New-Item -ItemType Directory -Force -Path $cliDir | Out-Null
    Write-Host "Baixando Tailwind CSS v3.4.17 standalone CLI..."
    Invoke-WebRequest -Uri "https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-windows-x64.exe" -OutFile $twExe -UseBasicParsing
}

Push-Location $webDir
try {
    & $twExe -c ".\tailwind.config.js" -i ".\css\tailwind.input.css" -o ".\css\tailwind.min.css" --minify
    Write-Host "OK: css/tailwind.min.css atualizado!" -ForegroundColor Green
} finally {
    Pop-Location
}
