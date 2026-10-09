# Natywne testy hostowe firmware (Catch2 + g++). Uruchom z katalogu repo:
#   powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1
#
# Buduje dwa binaria: core Szusownika (+ test_*.cpp) i core HudRekaw
# (+ hudrekaw/test_*.cpp). Wymaga kompilatora C++ (MinGW-w64). Skrypt szuka go
# w PATH, a potem w pakietach WinGet (winget install BrechtSanders.WinLibs.POSIX.UCRT).

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here "../../..")).Path
$srcSzusownik = Join-Path $repo "firmware/Szusownik/src"
$srcHudRekaw = Join-Path $repo "firmware/HudRekaw/src"
$thirdParty = Join-Path $here "third_party"

function Find-Gpp {
  foreach ($name in @("g++", "x86_64-w64-mingw32-g++")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  $packages = Join-Path $env:LOCALAPPDATA "Microsoft/WinGet/Packages"
  if (Test-Path $packages) {
    $found = Get-ChildItem -Recurse -Filter "g++.exe" $packages -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  throw "Nie znaleziono g++. Zainstaluj MinGW-w64: winget install BrechtSanders.WinLibs.POSIX.UCRT"
}

function Build-And-Run([string]$name, [string]$includeRoot, [string[]]$coreSources, [string[]]$testSources) {
  $sources = @((Join-Path $thirdParty "catch_amalgamated.cpp")) + $coreSources + $testSources
  $out = Join-Path $here "$name.exe"
  Write-Host "[host] $name`: kompiluje $($sources.Count) plikow..."
  & $gpp -std=c++17 -O2 -Wall -static -static-libgcc -static-libstdc++ -I $includeRoot -I $thirdParty $sources -o $out
  if ($LASTEXITCODE -ne 0) { throw "Kompilacja $name nie powiodla sie (exit $LASTEXITCODE)" }

  Write-Host "[host] $name`: uruchamiam testy (cwd = repo root)..."
  Push-Location $repo
  try {
    & $out
    if ($LASTEXITCODE -ne 0) { throw "Testy $name nie powiodly sie (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

$gpp = Find-Gpp
Write-Host "[host] g++: $gpp"

$szusownikCore = @(Get-ChildItem (Join-Path $srcSzusownik "core") -Filter "*.cpp" | ForEach-Object FullName)
$szusownikTests = @(Get-ChildItem $here -Filter "test_*.cpp" | ForEach-Object FullName)
Build-And-Run "host_tests_szusownik" $srcSzusownik $szusownikCore $szusownikTests

$hudRekawTestDir = Join-Path $here "hudrekaw"
$hudRekawCore = @(Get-ChildItem (Join-Path $srcHudRekaw "core") -Filter "*.cpp" | ForEach-Object FullName)
$hudRekawTests = @(Get-ChildItem $hudRekawTestDir -Filter "test_*.cpp" | ForEach-Object FullName)
Build-And-Run "host_tests_hudrekaw" $srcHudRekaw $hudRekawCore $hudRekawTests
