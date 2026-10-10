# Natywne testy hostowe firmware (Catch2 + g++). Uruchom z katalogu repo:
#   powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1
#   powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1 -Filter "run_tracker*"
#   powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1 -Binaries szusownik
#
# Build jest PRZYROSTOWY: Catch2 prekompilowany raz, a każdy plik .cpp kompilowany
# do .o tylko gdy jest nowszy niż źródło lub którykolwiek nagłówek. Kolejne
# uruchomienia bez zmian tylko linkują (szybko). Wymaga kompilatora C++ (MinGW-w64).

param(
  [string]$Filter = "",
  [ValidateSet("both", "szusownik", "hudrekaw")][string]$Binaries = "both"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here "../../..")).Path
$srcSzusownik = Join-Path $repo "firmware/Szusownik/src"
$srcHudRekaw = Join-Path $repo "firmware/HudRekaw/src"
$thirdParty = Join-Path $here "third_party"
$buildRoot = Join-Path $here ".build"

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

function Newest-WriteTime([string[]]$paths) {
  $newest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (Test-Path $p) {
      $t = (Get-Item $p).LastWriteTime
      if ($t -gt $newest) { $newest = $t }
    }
  }
  return $newest
}

function Get-Catch2Object([string]$objDir) {
  $catchCpp = Join-Path $thirdParty "catch_amalgamated.cpp"
  $obj = Join-Path $objDir "catch_amalgamated.o"
  $stamp = Newest-WriteTime @($catchCpp, (Join-Path $thirdParty "catch_amalgamated.hpp"))
  if ((Test-Path $obj) -and ((Get-Item $obj).LastWriteTime -ge $stamp)) { return $obj }
  Write-Host "[host] prekompilacja Catch2 (raz)..."
  & $gpp -std=c++17 -O2 -Wall -I $thirdParty -c $catchCpp -o $obj
  if ($LASTEXITCODE -ne 0) { throw "Kompilacja Catch2 nie powiodla sie (exit $LASTEXITCODE)" }
  return $obj
}

function Build-And-Run([string]$name, [string]$includeRoot, [string[]]$coreSources, [string[]]$testSources) {
  $objDir = Join-Path $buildRoot $name
  New-Item -ItemType Directory -Force -Path $objDir | Out-Null
  $catchObj = Get-Catch2Object $buildRoot

  # Nagłówki projektu + third_party: nowszy niż .o => konserwatywna rekompilacja.
  $headerStamp = Newest-WriteTime @(
    (Get-ChildItem $includeRoot -Recurse -Filter *.h -ErrorAction SilentlyContinue | ForEach-Object FullName) +
    (Get-ChildItem $thirdParty -Recurse -Filter *.h -ErrorAction SilentlyContinue | ForEach-Object FullName)
  )

  $objects = @()
  $rebuilt = 0
  foreach ($src in ($coreSources + $testSources)) {
    $parent = Split-Path (Split-Path $src -Parent) -Leaf
    $leaf = [IO.Path]::GetFileNameWithoutExtension($src)
    $obj = Join-Path $objDir "${parent}_${leaf}.o"
    if ((Test-Path $obj) -and ((Get-Item $obj).LastWriteTime -ge (Get-Item $src).LastWriteTime) -and
        ((Get-Item $obj).LastWriteTime -ge $headerStamp)) {
      $objects += $obj
      continue
    }
    & $gpp -std=c++17 -O2 -Wall -I $includeRoot -I $thirdParty -c $src -o $obj
    if ($LASTEXITCODE -ne 0) { throw "Kompilacja $src nie powiodla sie (exit $LASTEXITCODE)" }
    $objects += $obj
    $rebuilt++
  }

  $out = Join-Path $here "$name.exe"
  Write-Host "[host] $name`: kompilacja $rebuilt plikow, linkowanie $($objects.Count) obiektow..."
  & $gpp -std=c++17 -O2 -Wall -static -static-libgcc -static-libstdc++ $objects $catchObj -o $out
  if ($LASTEXITCODE -ne 0) { throw "Linkowanie $name nie powiodlo sie (exit $LASTEXITCODE)" }

  $suffix = if ($Filter) { ", filtr '$Filter'" } else { "" }
  Write-Host "[host] $name`: uruchamiam testy (cwd = repo root$suffix)..."
  Push-Location $repo
  try {
    if ($Filter) { & $out --allow-running-no-tests $Filter } else { & $out }
    if ($LASTEXITCODE -ne 0) { throw "Testy $name nie powiodly sie (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

$gpp = Find-Gpp
Write-Host "[host] g++: $gpp"

if ($Binaries -in @("both", "szusownik")) {
  $szusownikCore = @(Get-ChildItem (Join-Path $srcSzusownik "core") -Filter "*.cpp" | ForEach-Object FullName)
  $szusownikTests = @(Get-ChildItem $here -Filter "test_*.cpp" | ForEach-Object FullName)
  Build-And-Run "host_tests_szusownik" $srcSzusownik $szusownikCore $szusownikTests
}

if ($Binaries -in @("both", "hudrekaw")) {
  $hudRekawTestDir = Join-Path $here "hudrekaw"
  $hudRekawCore = @(Get-ChildItem (Join-Path $srcHudRekaw "core") -Filter "*.cpp" | ForEach-Object FullName)
  $hudRekawTests = @(Get-ChildItem $hudRekawTestDir -Filter "test_*.cpp" | ForEach-Object FullName)
  Build-And-Run "host_tests_hudrekaw" $srcHudRekaw $hudRekawCore $hudRekawTests
}
