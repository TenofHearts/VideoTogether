param(
  [int]$Port = 0,
  [string]$Domain = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path

function Get-EnvMap([string]$Path) {
  $map = @{}

  if (-not (Test-Path $Path)) {
    return $map
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()

    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf('=')

    if ($separatorIndex -lt 1) {
      continue
    }

    $key = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()
    $map[$key] = $value
  }

  return $map
}

function Get-EnvValue($Map, [string]$Key, [string]$DefaultValue) {
  if ($Map.ContainsKey($Key) -and $Map[$Key]) {
    return $Map[$Key]
  }

  return $DefaultValue
}

function Normalize-NgrokUrl([string]$Value) {
  $trimmed = $Value.Trim()

  if (-not $trimmed) {
    return ''
  }

  if ($trimmed -match '^https?://') {
    return $trimmed
  }

  if ($trimmed.Contains('/')) {
    throw "ngrok URL must be a hostname like example.ngrok-free.app or a full HTTPS URL, not: $trimmed"
  }

  return "https://$trimmed"
}

$envPath = if (Test-Path (Join-Path $repoRoot '.env')) {
  Join-Path $repoRoot '.env'
} else {
  Join-Path $repoRoot '.env.example'
}

$envMap = Get-EnvMap $envPath

if ($Port -le 0) {
  $Port = [int](Get-EnvValue $envMap 'PORT' '3000')
}

$publicUrl = Normalize-NgrokUrl $Domain

if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
  throw 'ngrok is not installed or not on PATH.'
}

$args = @('http', "http://localhost:$Port")

if ($publicUrl) {
  $args += "--url=$publicUrl"
}

Write-Host 'Expose the local host flow after the server is running.'
if ($publicUrl) {
  Write-Host "Using explicit ngrok URL: $publicUrl"
} else {
  Write-Host 'No explicit ngrok URL was provided. ngrok will use a temporary public URL.'
}
Write-Host 'For host:start, only NGROK_ENABLED is needed. The public ngrok URL is resolved dynamically.'
& ngrok @args
