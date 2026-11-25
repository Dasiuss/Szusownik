@echo off
rem Buduje i wgrywa Szusownika z nazwa BLE tej sztuki.
rem Uzycie: flash_szusownik.cmd "Szusownik Red"          (port domyslny COM7)
rem         flash_szusownik.cmd "Szusownik Blue" COM6    (inna sztuka / inny port)
rem
rem Cache builda jest WSPOLNY dla wszystkich worktree i lezy w katalogu glownym
rem repo: <main>\build\cache-red  albo  <main>\build\cache-blue. Dzieki temu
rem przelaczanie worktree nie placi za zimny build (4 min discovery), a Red i
rem Blue nie kasuja sobie wzajemnie cache (nazwa BLE idzie w --build-property,
rem wiec zmiana nazwy czysci build path arduino-cli).
rem
rem Lock: <main>\build\szusownik-build.lock. Jeden build Szusownika naraz.
rem Jesli lock istnieje, skrypt konczy sie kodem 3 PRZED taskkill/kompilacja,
rem wypisujac pid. Agent sprawdza pid: zywy -> czekaj; martwy -> usun lock.
rem
rem Nazwa trafia do -DSZ_DEVICE_NAME. Spacja jest kodowana jako \040 (escapowanie
rem C w stringu), bo arduino-cli na Windows rozcina wartosc --build-property
rem zawierajaca spacje - inaczej kompilator dostaje "red" jako plik wejsciowy.
rem Plik celowo ASCII-only: cmd czyta .cmd w kodowaniu OEM, nie UTF-8.
setlocal EnableExtensions
cd /d "%~dp0"

if "%~1"=="" (
  echo Uzycie: flash_szusownik.cmd "Szusownik Red"        [COM7]
  echo         flash_szusownik.cmd "Szusownik Blue"       [COM6]
  echo Cache: katalog glowny repo, build\cache-red^|blue ; lock: build\szusownik-build.lock
  exit /b 2
)

set "SZ_NAME=%~1"
set "SZ_PORT=%~2"
if "%SZ_PORT%"=="" set "SZ_PORT=COM7"
set "SZ_NAME_ESC=%SZ_NAME: =\040%"
set "FQBN=esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc"

rem --- katalog glowny repo (git common dir), nie biezacy worktree ---
rem W worktree "%~dp0.git" to plik "gitdir: <main>\.git\worktrees\<nazwa>",
rem w glownym checkoutcie to katalog. Nie uzywamy tu --path-format=absolute,
rem bo "=" w komendzie wewnatrz for /f jest zjadany przez cmd.
set "SZ_MAIN="
if exist "%~dp0.git\" set "SZ_MAIN=%~dp0"
if defined SZ_MAIN goto :sz_main_ready

set "SZ_GITDIR="
for /f "usebackq tokens=1,* delims=: " %%a in ("%~dp0.git") do if /i "%%a"=="gitdir" set "SZ_GITDIR=%%b"
if defined SZ_GITDIR for %%i in ("%SZ_GITDIR%\..\..\..") do set "SZ_MAIN=%%~fi"
if defined SZ_MAIN goto :sz_main_ready

set "SZ_GIT_COMMON="
for /f "delims=" %%i in ('git -C "%~dp0." rev-parse --git-common-dir 2^>nul') do set "SZ_GIT_COMMON=%%i"
if defined SZ_GIT_COMMON for %%i in ("%SZ_GIT_COMMON%\..") do set "SZ_MAIN=%%~fi"

:sz_main_ready
if not defined SZ_MAIN set "SZ_MAIN=%~dp0"
if "%SZ_MAIN:~-1%"=="\" set "SZ_MAIN=%SZ_MAIN:~0,-1%"

rem --- jedna z dwoch statycznych sztuk -> osobny cache per sztuka ---
if /i "%SZ_NAME%"=="Szusownik Red" (
  set "SZ_TAG=red"
) else if /i "%SZ_NAME%"=="Szusownik Blue" (
  set "SZ_TAG=blue"
) else (
  echo [flash_szusownik] blad: obslugiwane nazwy to "Szusownik Red" i "Szusownik Blue" ^(dostalem "%SZ_NAME%"^).
  exit /b 2
)

set "SZ_CACHE=%SZ_MAIN%\build\cache-%SZ_TAG%"
set "SZ_LOCK=%SZ_MAIN%\build\szusownik-build.lock"
if not exist "%SZ_MAIN%\build" mkdir "%SZ_MAIN%\build"

rem --- lock: fail-fast, zanim cokolwiek zabijemy albo nadpiszemy ---
if exist "%SZ_LOCK%" (
  echo [flash_szusownik] BUILD ZABLOKOWANY - istnieje "%SZ_LOCK%":
  type "%SZ_LOCK%"
  echo [flash_szusownik] pid zywy = build trwa, zaczekaj. pid martwy = usun lock i uruchom ponownie.
  exit /b 3
)

rem PID procesu cmd.exe prowadzacego build (rodzic tego PowerShell).
set "SZ_WORKTREE=%CD%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$parent = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId; if (-not $parent) { $parent = '?' }; $lines = @('pid=' + $parent, 'started=' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), 'device=' + $env:SZ_NAME, 'port=' + $env:SZ_PORT, 'tag=' + $env:SZ_TAG, 'cache=' + $env:SZ_CACHE, 'worktree=' + $env:SZ_WORKTREE, 'hint=pid zywy -> build trwa, zaczekaj; pid martwy -> usun ten plik i uruchom ponownie'); Set-Content -LiteralPath $env:SZ_LOCK -Value $lines -Encoding ASCII"
if errorlevel 1 (
  echo [flash_szusownik] blad: nie udalo sie utworzyc locka "%SZ_LOCK%".
  exit /b 1
)

echo [flash_szusownik] nazwa BLE: "%SZ_NAME%"  port: %SZ_PORT%
echo [flash_szusownik] cache: %SZ_CACHE%
echo [flash_szusownik] lock:  %SZ_LOCK%
rem Monitor trzyma port - musi byc zamkniety przed uploadem.
taskkill /F /IM arduino-cli.exe >nul 2>&1

arduino-cli compile --fqbn "%FQBN%" --build-path "%SZ_CACHE%" --build-property "compiler.cpp.extra_flags=-DSZ_DEVICE_NAME=\"%SZ_NAME_ESC%\"" --output-dir build\szusownik firmware\Szusownik
set "SZ_RC=%ERRORLEVEL%"
if not "%SZ_RC%"=="0" goto :unlock_fail

arduino-cli upload -p %SZ_PORT% --fqbn "%FQBN%" --input-dir build\szusownik firmware\Szusownik
set "SZ_RC=%ERRORLEVEL%"
if not "%SZ_RC%"=="0" goto :unlock_fail

call :unlock
if /i "%SZ_PORT%"=="COM6" (
  echo [flash_szusownik] wgrane. Logi: monitor_COM6.cmd
) else (
  echo [flash_szusownik] wgrane. Logi: monitor_COM7.cmd
)
exit /b 0

:unlock_fail
call :unlock
exit /b %SZ_RC%

:unlock
del /q "%SZ_LOCK%" >nul 2>&1
exit /b 0
