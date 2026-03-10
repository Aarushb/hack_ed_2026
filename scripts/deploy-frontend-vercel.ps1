param(
  [Parameter(Mandatory=$false)]
  [string]$ApiBase = ""
)

$ErrorActionPreference = "Stop"

Set-Location -Path (Split-Path -Parent $PSScriptRoot)

if ($ApiBase -ne "") {
  $env:NORTHSTAR_API_BASE = $ApiBase
}

Write-Host "Building for Vercel..."
npm run build:vercel

Write-Host "Deploying to Vercel (you may be prompted to login)..."
# Uses vercel.json in repo root
npx vercel --prod
