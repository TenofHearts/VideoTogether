$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$tempDirectory = Join-Path $repoRoot '.codex-tmp'
$serverPidPath = Join-Path $tempDirectory 'host-server.pid'
$serverScriptPath = Join-Path $tempDirectory 'run-local-server.ps1'
$composeEnvPath = Join-Path $tempDirectory 'host-compose.env'

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

function Test-EnvFlag([string]$Value) {
  return @('1', 'true', 'yes', 'on') -contains $Value.ToLowerInvariant()
}

function Stop-ProcessTree([int]$ProcessId) {
  $taskkillCommand = Get-Command taskkill.exe -ErrorAction SilentlyContinue

  if ($taskkillCommand) {
    & $taskkillCommand.Source /PID $ProcessId /T /F *> $null
    return $LASTEXITCODE -eq 0
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  return $true
}

$envPath = if (Test-Path (Join-Path $repoRoot '.env')) {
  Join-Path $repoRoot '.env'
} else {
  Join-Path $repoRoot '.env.example'
}

$envMap = Get-EnvMap $envPath
$useDocker = Test-EnvFlag (Get-EnvValue $envMap 'USE_DOCKER' 'false')

if (Test-Path $serverPidPath) {
  $serverPid = (Get-Content $serverPidPath | Select-Object -First 1).Trim()

  if ($serverPid) {
    try {
      Get-Process -Id ([int]$serverPid) -ErrorAction Stop | Out-Null

      if (Stop-ProcessTree -ProcessId ([int]$serverPid)) {
        Write-Host "Stopped local server process tree $serverPid."
      } else {
        Write-Host "Local server process tree $serverPid was not running."
      }
    } catch {
      Write-Host "Local server process $serverPid was not running."
    }
  }

  Remove-Item $serverPidPath -Force -ErrorAction SilentlyContinue
}

Remove-Item $serverScriptPath -Force -ErrorAction SilentlyContinue

if (-not $useDocker) {
  Remove-Item $composeEnvPath -Force -ErrorAction SilentlyContinue
  return
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
  $previousErrorActionPreference = $ErrorActionPreference

  try {
    Set-Location $repoRoot
    $ErrorActionPreference = 'Continue'

    if (Test-Path $composeEnvPath) {
      & docker compose --env-file $composeEnvPath -f infra/docker-compose.yml down *> $null
    } else {
      & docker compose -f infra/docker-compose.yml down *> $null
    }
  } catch {
    # Ignore Docker shutdown issues so Docker mode can fail closed without blocking local cleanup.
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}
