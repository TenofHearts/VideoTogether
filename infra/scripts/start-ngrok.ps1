param(
  [int]$Port = 3000,
  [string]$Domain = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
  throw 'ngrok is not installed or not on PATH.'
}

$args = @('http', "http://localhost:$Port")

if ($Domain) {
  $args += "--domain=$Domain"
}

Write-Host 'Expose the local host flow after the server is running.'
Write-Host 'If you use a reserved ngrok domain, set PUBLIC_BASE_URL and WEB_URL to that HTTPS URL before running host:start.'
& ngrok @args
