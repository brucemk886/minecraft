$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$runtime = "C:\Users\111\ParkourSim-runtime\electron"
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $root "release"))
$out = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "ParkourSim"))

if ((Split-Path -Parent $out) -ne $releaseRoot -or (Split-Path -Leaf $out) -ne "ParkourSim") {
  throw "Unsafe portable output path: $out"
}

if (-not (Test-Path (Join-Path $runtime "electron.exe"))) {
  throw "Electron runtime not found: $runtime"
}

if (Test-Path $out) {
  Remove-Item -Recurse -Force $out
}

New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item -Path (Join-Path $runtime "*") -Destination $out -Recurse -Force

$appDir = Join-Path $out "resources\app"
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "electron") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "dist") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "runtime") | Out-Null

Copy-Item (Join-Path $root "electron\*") (Join-Path $appDir "electron") -Recurse -Force
Copy-Item (Join-Path $root "dist\*") (Join-Path $appDir "dist") -Recurse -Force
Copy-Item (Join-Path $root "runtime\*") (Join-Path $appDir "runtime") -Recurse -Force

Set-Content -Path (Join-Path $appDir "package.json") -Encoding UTF8 -Value @'
{
  "name": "mc-parkour-sim",
  "version": "1.0.0",
  "main": "electron/main.cjs"
}
'@

$exe = Join-Path $out "ParkourSim.exe"
if (Test-Path $exe) { Remove-Item $exe -Force }
Rename-Item (Join-Path $out "electron.exe") "ParkourSim.exe"

Write-Host "PACKED=$out"
Write-Host "EXE=$exe"
