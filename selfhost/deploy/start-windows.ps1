#Requires -Version 5.1
$ErrorActionPreference='Stop'
$site=Split-Path -Parent $PSScriptRoot
Push-Location $site
try {
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $env:LUMEN_LISTEN_HOST='127.0.0.1'
  & $node --max-old-space-size=512 server.mjs
  exit $LASTEXITCODE
} finally { Pop-Location }
