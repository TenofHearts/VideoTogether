<#
Copyright Jin Ye

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
#>

param(
  [switch]$SkipBuild,
  [switch]$SkipDesktop
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$tempDirectory = Join-Path $repoRoot '.codex-tmp'
$serverPidPath = Join-Path $tempDirectory 'host-server.pid'
$serverLogPath = Join-Path $tempDirectory 'host-server.log'
$serverScriptPath = Join-Path $tempDirectory 'run-local-server.ps1'
$ngrokPidPath = Join-Path $tempDirectory 'host-ngrok.pid'
$ngrokLogPath = Join-Path $tempDirectory 'host-ngrok.log'
$ngrokScriptPath = Join-Path $tempDirectory 'run-ngrok.ps1'
$composeEnvPath = Join-Path $tempDirectory 'host-compose.env'

New-Item -ItemType Directory -Force -Path $tempDirectory | Out-Null

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
    $value = $trimmed.Substring($separatorIndex + 1).Trim().Trim('"').Trim("'")
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

function Test-LoopbackHost([string]$Value) {
  $normalized = $Value.Trim().ToLowerInvariant()
  return @('localhost', '127.0.0.1', '::1', '[::1]') -contains $normalized
}

function Set-ProcessEnv($Variables) {
  foreach ($entry in $Variables.GetEnumerator()) {
    Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value
  }
}

function Stop-ProcessTree([int]$ProcessId) {
  $taskkillCommand = Get-Command taskkill.exe -ErrorAction SilentlyContinue

  if ($taskkillCommand) {
    $taskkillInvocation = "taskkill.exe /PID $ProcessId /T /F >nul 2>&1"
    & cmd.exe /d /c $taskkillInvocation
    $taskkillExitCode = $LASTEXITCODE

    if ($taskkillExitCode -eq 0) {
      return
    }

    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      return
    }

    throw "Failed to stop process tree $ProcessId with taskkill exit code $taskkillExitCode."
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-TrackedProcess([string]$PidPath, [string]$Label) {
  if (-not (Test-Path $PidPath)) {
    return
  }

  $trackedPid = (Get-Content $PidPath | Select-Object -First 1).Trim()

  if ($trackedPid) {
    try {
      Get-Process -Id ([int]$trackedPid) -ErrorAction Stop | Out-Null
      Stop-ProcessTree -ProcessId ([int]$trackedPid)
      Write-Host "Stopped $Label process tree $trackedPid."
    } catch {
      Write-Host "$Label process $trackedPid was not running."
    }
  }

  Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
}

function Get-ShellExecutable() {
  if (Get-Command pwsh -ErrorAction SilentlyContinue) {
    return 'pwsh'
  }

  return 'powershell'
}

function Wait-ForServer([string]$Url, [int]$TimeoutSeconds, [int]$ProcessId) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1

    try {
      Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
    } catch {
      return $false
    }

    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2

      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return $true
      }
    } catch {
      # Keep polling until the process exits or the timeout is hit.
    }
  }

  return $false
}

function Wait-ForNgrokPublicUrl([int]$TimeoutSeconds, [int]$ProcessId) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500

    try {
      Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
    } catch {
      return $null
    }

    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4040/api/tunnels' -UseBasicParsing -TimeoutSec 2
      $payload = $response.Content | ConvertFrom-Json
      $publicUrls = @(
        $payload.tunnels |
          ForEach-Object { $_.public_url } |
          Where-Object { $_ }
      )

      $httpsUrl = $publicUrls | Where-Object { $_ -like 'https://*' } | Select-Object -First 1

      if ($httpsUrl) {
        return $httpsUrl
      }

      $firstUrl = $publicUrls | Select-Object -First 1

      if ($firstUrl) {
        return $firstUrl
      }
    } catch {
      # Keep polling until ngrok exposes a tunnel or the process exits.
    }
  }

  return $null
}

function Get-LogTail([string]$Path, [int]$LineCount = 20) {
  if (-not (Test-Path $Path)) {
    return ''
  }

  return (Get-Content $Path | Select-Object -Last $LineCount) -join [Environment]::NewLine
}

$envPath = if (Test-Path (Join-Path $repoRoot '.env')) {
  Join-Path $repoRoot '.env'
} else {
  Join-Path $repoRoot '.env.example'
}

$envMap = Get-EnvMap $envPath
$useDocker = Test-EnvFlag (Get-EnvValue $envMap 'USE_DOCKER' 'false')
$configuredServerHost = Get-EnvValue $envMap 'HOST' '0.0.0.0'
$serverHost = if (Test-LoopbackHost $configuredServerHost) { '0.0.0.0' } else { $configuredServerHost }
$serverPort = Get-EnvValue $envMap 'PORT' '3000'
$publicProtocol = Get-EnvValue $envMap 'PUBLIC_PROTOCOL' (Get-EnvValue $envMap 'APP_PROTOCOL' 'http')
$publicHost = Get-EnvValue $envMap 'PUBLIC_HOST' (Get-EnvValue $envMap 'APP_HOST' 'localhost')
$localApiBaseUrl = "http://localhost:$serverPort"
$apiBaseUrl = Get-EnvValue $envMap 'API_BASE_URL' $localApiBaseUrl
$ngrokEnabled = Test-EnvFlag (Get-EnvValue $envMap 'NGROK_ENABLED' 'false')
$publicBaseUrl = Get-EnvValue $envMap 'PUBLIC_BASE_URL' "${publicProtocol}://${publicHost}:$serverPort"
$rawWebUrl = Get-EnvValue $envMap 'WEB_URL' $publicBaseUrl
$resolvedViteApiBaseUrl = Get-EnvValue $envMap 'VITE_API_BASE_URL' $publicBaseUrl
$ngrokPublicUrl = $null
$serverHealthUrl = "http://127.0.0.1:$serverPort/health"

if ($ngrokEnabled) {
  if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    throw 'ngrok is not installed or not on PATH.'
  }

  Stop-TrackedProcess -PidPath $ngrokPidPath -Label 'ngrok'

  if (Test-Path $ngrokLogPath) {
    Remove-Item $ngrokLogPath -Force -ErrorAction SilentlyContinue
  }

  $escapedRepoRoot = $repoRoot.Replace("'", "''")
  $escapedNgrokLogPath = $ngrokLogPath.Replace("'", "''")
  $scriptLines = @(
    "$ErrorActionPreference = 'Stop'",
    "Set-Location '$escapedRepoRoot'",
    "ngrok http `"http://localhost:$serverPort`" *>&1 | Tee-Object -FilePath '$escapedNgrokLogPath' -Append"
  )
  $scriptLines | Set-Content $ngrokScriptPath

  $shellExecutable = Get-ShellExecutable
  Write-Host 'Starting ngrok tunnel with a dynamic public URL ...'
  $ngrokProcess = Start-Process $shellExecutable `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ngrokScriptPath) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -PassThru
  $ngrokProcess.Id | Set-Content $ngrokPidPath

  $ngrokPublicUrl = Wait-ForNgrokPublicUrl -TimeoutSeconds 15 -ProcessId $ngrokProcess.Id

  if (-not $ngrokPublicUrl) {
    Remove-Item $ngrokPidPath -Force -ErrorAction SilentlyContinue
    $ngrokLogTail = if (Test-Path $ngrokLogPath) {
      (Get-Content $ngrokLogPath | Select-Object -Last 20) -join [Environment]::NewLine
    } else {
      'No ngrok log output was captured.'
    }
    throw "ngrok failed to expose a public URL.`n$ngrokLogTail"
  }

  $publicBaseUrl = $ngrokPublicUrl
  $rawWebUrl = $ngrokPublicUrl
  $resolvedViteApiBaseUrl = $ngrokPublicUrl
} else {
  Stop-TrackedProcess -PidPath $ngrokPidPath -Label 'ngrok'
}

$webUrl = if ($rawWebUrl -match '^https?://(localhost|127\.0\.0\.1):(5173|5174)/?$') {
  $publicBaseUrl
} else {
  $rawWebUrl
}

$runtimeEnv = [ordered]@{
  NODE_ENV = 'production'
  HOST = $serverHost
  PORT = $serverPort
  API_BASE_URL = $apiBaseUrl
  PUBLIC_BASE_URL = $publicBaseUrl
  WEB_URL = $webUrl
  WEB_ORIGIN = Get-EnvValue $envMap 'WEB_ORIGIN' $webUrl
  LAN_IP = Get-EnvValue $envMap 'LAN_IP' ''
  VITE_API_BASE_URL = $resolvedViteApiBaseUrl
  ROOM_TOKEN_BYTES = Get-EnvValue $envMap 'ROOM_TOKEN_BYTES' '32'
  FFMPEG_PATH = Get-EnvValue $envMap 'FFMPEG_PATH' 'ffmpeg'
  FFPROBE_PATH = Get-EnvValue $envMap 'FFPROBE_PATH' 'ffprobe'
  CLEANUP_INTERVAL_MINUTES = Get-EnvValue $envMap 'CLEANUP_INTERVAL_MINUTES' '10'
  ROOM_IDLE_TTL_MINUTES = Get-EnvValue $envMap 'ROOM_IDLE_TTL_MINUTES' '180'
  HLS_RETENTION_HOURS = Get-EnvValue $envMap 'HLS_RETENTION_HOURS' '72'
}

if (-not $SkipBuild) {
  Set-Location $repoRoot
  Set-ProcessEnv $runtimeEnv
  Write-Host 'Building production web and server assets...'
  & npm run build:host

  if ($LASTEXITCODE -ne 0) {
    throw 'Production build failed.'
  }
}

if ($useDocker) {
  $composeEnv = [ordered]@{
    NODE_ENV = $runtimeEnv.NODE_ENV
    HOST = '0.0.0.0'
    PORT = $serverPort
    PUBLIC_BASE_URL = $runtimeEnv.PUBLIC_BASE_URL
    WEB_URL = $runtimeEnv.WEB_URL
    WEB_ORIGIN = $runtimeEnv.WEB_ORIGIN
    WEB_DIST_DIR = '/app/apps/web/dist'
    DATABASE_URL = 'file:/app/storage/db/app.db'
    HLS_OUTPUT_DIR = '/app/storage/hls'
    MEDIA_INPUT_DIR = '/app/storage/media'
    SUBTITLE_DIR = '/app/storage/subtitles'
    TEMP_DIR = '/app/storage/temp'
    FFMPEG_PATH = '/usr/bin/ffmpeg'
    FFPROBE_PATH = '/usr/bin/ffprobe'
    ROOM_TOKEN_BYTES = $runtimeEnv.ROOM_TOKEN_BYTES
    CLEANUP_INTERVAL_MINUTES = $runtimeEnv.CLEANUP_INTERVAL_MINUTES
    ROOM_IDLE_TTL_MINUTES = $runtimeEnv.ROOM_IDLE_TTL_MINUTES
    HLS_RETENTION_HOURS = $runtimeEnv.HLS_RETENTION_HOURS
  }

  ($composeEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) | Set-Content $composeEnvPath

  Write-Host "Starting Dockerized server on http://localhost:$serverPort ..."
  & docker compose --env-file $composeEnvPath -f infra/docker-compose.yml up -d --build app-server

  if ($LASTEXITCODE -ne 0) {
    throw 'Docker startup failed.'
  }
} else {
  $existingProcess = $null

  if (Test-Path $serverPidPath) {
    $existingPid = (Get-Content $serverPidPath | Select-Object -First 1).Trim()

    if ($existingPid) {
      try {
        $existingProcess = Get-Process -Id ([int]$existingPid) -ErrorAction Stop
      } catch {
        Remove-Item $serverPidPath -Force -ErrorAction SilentlyContinue
      }
    }
  }

  if (-not $existingProcess) {
    $scriptLines = @(
      "$ErrorActionPreference = 'Stop'",
      "Set-Location '$repoRoot'"
    )

    foreach ($entry in $runtimeEnv.GetEnumerator()) {
      $escapedValue = ([string]$entry.Value).Replace("'", "''")
      $scriptLines += "`$env:$($entry.Key) = '$escapedValue'"
    }

    $escapedLogPath = $serverLogPath.Replace("'", "''")
    $scriptLines += "npm run start --workspace @videoshare/server *>&1 | Tee-Object -FilePath '$escapedLogPath' -Append"
    $scriptLines | Set-Content $serverScriptPath

    if (Test-Path $serverLogPath) {
      Remove-Item $serverLogPath -Force
    }

    $shellExecutable = Get-ShellExecutable

    Write-Host "Starting local production server on http://localhost:$serverPort ..."
    $serverProcess = Start-Process $shellExecutable `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScriptPath) `
      -WorkingDirectory $repoRoot `
      -WindowStyle Hidden `
      -PassThru
    $serverProcess.Id | Set-Content $serverPidPath

    if (-not (Wait-ForServer -Url $serverHealthUrl -TimeoutSeconds 20 -ProcessId $serverProcess.Id)) {
      $logTail = Get-LogTail $serverLogPath
      Stop-ProcessTree -ProcessId $serverProcess.Id
      Remove-Item $serverPidPath -Force -ErrorAction SilentlyContinue
      throw "Local server failed to start. See $serverLogPath for details.`n$logTail"
    }
  } else {
    Write-Host "Local server already running with PID $($existingProcess.Id)."
  }
}

Write-Host "API: $apiBaseUrl"
Write-Host "Share URLs: $webUrl"
if ($runtimeEnv.LAN_IP) {
  Write-Host "LAN IP: $($runtimeEnv.LAN_IP)"
}
if ($ngrokEnabled) {
  Write-Host "ngrok: $ngrokPublicUrl"
} else {
  Write-Host 'ngrok: disabled'
}
Write-Host "Docker mode: $useDocker"
Write-Host 'Stop command: npm run host:stop'

if ($SkipDesktop) {
  return
}

Set-Location $repoRoot
Set-ProcessEnv $runtimeEnv
Write-Host 'Launching Tauri host dashboard...'
& npm run tauri:dev --workspace @videoshare/desktop
