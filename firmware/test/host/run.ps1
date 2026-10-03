# Natywne testy hostowe firmware (Catch2 + g++). Uruchom z katalogu repo:
#   powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1
#
# Wymaga kompilatora C++ (MinGW-w64). Skrypt szuka go w PATH, a potem w
# pakietach WinGet (winget install BrechtSanders.WinLibs.POSIX.UCRT).

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here "../../..")).Path
$src = Join-Path $repo "firmware/Szusownik/src"
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

$gpp = Find-Gpp
$sources = @(Get-ChildItem $here -Filter "test_*.cpp" | ForEach-Object FullName)
$sources += (Join-Path $thirdParty "catch_amalgamated.cpp")
$sources += @(Get-ChildItem (Join-Path $src "core") -Filter "*.cpp" | ForEach-Object FullName)

$out = Join-Path $here "host_tests.exe"
Write-Host "[host] g++: $gpp"
Write-Host "[host] kompiluje $($sources.Count) plikow..."
& $gpp -std=c++17 -O2 -Wall -static -static-libgcc -static-libstdc++ -I $src -I $thirdParty $sources -o $out

Write-Host "[host] uruchamiam testy (cwd = repo root)..."
Push-Location $repo
try {
  & $out
  if ($LASTEXITCODE -ne 0) { throw "Testy hostowe nie powiodly sie (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
