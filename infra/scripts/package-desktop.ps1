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
  [string]$TargetTriple = 'x86_64-pc-windows-msvc',
  [string]$ServerExeName = 'videoshare-server.exe',
  [string]$FfmpegPath = '',
  [string]$FfprobePath = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$serverReleaseDir = Join-Path $repoRoot 'apps/server/release'
$serverExePath = Join-Path $serverReleaseDir $ServerExeName
$tauriRoot = Join-Path $repoRoot 'apps/desktop/src-tauri'
$binariesDir = Join-Path $tauriRoot 'binaries'
$bundleOutputDir = Join-Path $tauriRoot 'target/release/bundle/nsis'

function Resolve-BinaryPath {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$ExplicitPath = ''
  )

  if ($ExplicitPath) {
    return (Resolve-Path $ExplicitPath).Path
  }

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Could not find $Name on PATH. Pass -${Name}Path explicitly."
  }

  return $command.Source
}

function Copy-SidecarBinary {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$LogicalName
  )

  $extension = [System.IO.Path]::GetExtension($SourcePath)
  $destination = Join-Path $binariesDir ("{0}-{1}{2}" -f $LogicalName, $TargetTriple, $extension)
  Copy-Item $SourcePath $destination -Force
  return $destination
}

Set-Location $repoRoot

Write-Host 'Building browser web app for server hosting...'
& npm run build --workspace @videoshare/web
if ($LASTEXITCODE -ne 0) {
  throw 'Web build failed.'
}

Write-Host 'Building and packaging standalone server executable...'
& npm run build:release --workspace @videoshare/server
if ($LASTEXITCODE -ne 0) {
  throw 'Server release build failed.'
}

if (-not (Test-Path $serverExePath)) {
  throw "Packaged server executable not found: $serverExePath"
}

$resolvedFfmpegPath = Resolve-BinaryPath -Name 'ffmpeg' -ExplicitPath $FfmpegPath

if (-not $FfprobePath) {
  $adjacentFfprobe = Join-Path (Split-Path $resolvedFfmpegPath -Parent) 'ffprobe.exe'
  if (Test-Path $adjacentFfprobe) {
    $resolvedFfprobePath = (Resolve-Path $adjacentFfprobe).Path
  } else {
    $resolvedFfprobePath = Resolve-BinaryPath -Name 'ffprobe'
  }
} else {
  $resolvedFfprobePath = Resolve-BinaryPath -Name 'ffprobe' -ExplicitPath $FfprobePath
}

New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null
Remove-Item (Join-Path $binariesDir 'server-*') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $binariesDir 'ffmpeg-*') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $binariesDir 'ffprobe-*') -Force -ErrorAction SilentlyContinue

$serverSidecarPath = Copy-SidecarBinary -SourcePath $serverExePath -LogicalName 'server'
$ffmpegSidecarPath = Copy-SidecarBinary -SourcePath $resolvedFfmpegPath -LogicalName 'ffmpeg'
$ffprobeSidecarPath = Copy-SidecarBinary -SourcePath $resolvedFfprobePath -LogicalName 'ffprobe'

Write-Host "Prepared server sidecar: $serverSidecarPath"
Write-Host "Prepared ffmpeg sidecar: $ffmpegSidecarPath"
Write-Host "Prepared ffprobe sidecar: $ffprobeSidecarPath"

Write-Host 'Building final Tauri installer/package...'
& npm run tauri:build --workspace @videoshare/desktop
if ($LASTEXITCODE -ne 0) {
  throw 'Desktop packaging failed.'
}

Write-Host 'Desktop bundle output:'
Write-Host $bundleOutputDir


