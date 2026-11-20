#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)][string]$Origin,
  [Parameter(Mandatory=$true)][string]$AdminEmail,
  [ValidateRange(1024,65535)][int]$Port=8443
)
$ErrorActionPreference='Stop'
$site=Split-Path -Parent $PSScriptRoot
Push-Location $site
try {
  if ((Test-Path 'config\runtime.json') -or (Test-Path 'config\accounts.json') -or (Test-Path 'data\d1') -or (Test-Path 'config\tls.pfx')) {
    throw 'Existing site state found. Follow the migration instructions.'
  }
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $npm=(Get-Command npm.cmd -ErrorAction Stop).Source
  & $npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }

  $secure=Read-Host 'Administrator password (12-128 characters)' -AsSecureString
  if ($secure.Length -lt 12 -or $secure.Length -gt 128) { throw 'Invalid password length.' }
  $pin=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $pfx=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  try {
    $parameters=@{
      origin=$Origin; adminEmail=$AdminEmail; port=$Port
      password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pin); tlsPfxPassword=$pfx
    } | ConvertTo-Json -Compress
    $OutputEncoding=[Text.UTF8Encoding]::new($false)
    $parameters | & $node setup.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Site setup failed.' }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pin)
    $parameters=$null
  }
  $cert=New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(4)
  Export-PfxCertificate -Cert $cert -FilePath 'config\tls.pfx' -Password (ConvertTo-SecureString $pfx -AsPlainText -Force) | Out-Null
  $pfx=$null
  & $node initialize.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }
  Write-Host "Start with .\deploy\start-windows.ps1. Configure Caddy to proxy HTTPS to localhost:$Port."
} finally { Pop-Location }
