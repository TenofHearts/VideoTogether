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
  [string]$FfprobePath = '',
  [string]$Bundles = 'nsis'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repoRoot
$args = @('infra/scripts/package-desktop.mjs', '--target', $TargetTriple, '--bundles', $Bundles)

if ($ServerExeName) {
  $serverPath = Join-Path (Join-Path $repoRoot 'apps/server/release') $ServerExeName
  $args += @('--server-path', $serverPath)
}

if ($FfmpegPath) {
  $args += @('--ffmpeg-path', $FfmpegPath)
}

if ($FfprobePath) {
  $args += @('--ffprobe-path', $FfprobePath)
}

& node @args
if ($LASTEXITCODE -ne 0) {
  throw 'Desktop packaging failed.'
}


