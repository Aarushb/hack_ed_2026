param(
  [Parameter(Mandatory=$false)]
  [int]$FrontendPort = 5173,

  [Parameter(Mandatory=$false)]
  [int]$BackendPort = 8000
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Starting backend on http://localhost:$BackendPort ..."
Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$repoRoot\backend'; uvicorn main:app --reload --port $BackendPort"
)

Write-Host "Starting frontend on http://localhost:$FrontendPort ..."
Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$repoRoot\frontend'; python -m http.server $FrontendPort"
)

Start-Sleep -Seconds 1
Start-Process "http://localhost:$FrontendPort"
