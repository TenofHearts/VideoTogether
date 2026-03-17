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
  [string]$ApiBaseUrl = 'http://localhost:3000',
  [string]$WebUrl = '',
  [string]$PublicBaseUrl = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path

if (-not $WebUrl) {
  $WebUrl = $ApiBaseUrl
}

if (-not $PublicBaseUrl) {
  $PublicBaseUrl = $WebUrl
}

Set-Location $repoRoot
$env:API_BASE_URL = $ApiBaseUrl
$env:WEB_URL = $WebUrl
$env:PUBLIC_BASE_URL = $PublicBaseUrl
$env:WEB_ORIGIN = $WebUrl
$env:NODE_ENV = 'production'

Write-Host 'Building Tauri desktop bundle...'
& npm run tauri:build --workspace @videoshare/desktop

if ($LASTEXITCODE -ne 0) {
  throw 'Desktop packaging failed.'
}

Write-Host 'Desktop bundle output:'
Write-Host 'apps/desktop/src-tauri/target/release/bundle'
