@echo off
rem Buduje i wgrywa Szusownika z nazwa BLE tej sztuki.
rem Uzycie: flash_szusownik.cmd "Szusownik Red"          (port domyslny COM7)
rem         flash_szusownik.cmd "Szusownik Blue" COM6    (inna sztuka / inny port)
rem Nazwa trafia do -DSZ_DEVICE_NAME. Spacja jest kodowana jako \040 (escapowanie
rem C w stringu), bo arduino-cli na Windows rozcina wartosc --build-property
rem zawierajaca spacje - inaczej kompilator dostaje "red" jako plik wejsciowy.
rem Plik celowo ASCII-only: cmd czyta .cmd w kodowaniu OEM, nie UTF-8.
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Uzycie: flash_szusownik.cmd "Szusownik Red"        [COM7]
  echo         flash_szusownik.cmd "Szusownik Blue"       [COM6]
  exit /b 2
)

set "SZ_NAME=%~1"
set "SZ_PORT=%~2"
if "%SZ_PORT%"=="" set "SZ_PORT=COM7"
set "SZ_NAME_ESC=%SZ_NAME: =\040%"
set "FQBN=esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc"

echo [flash_szusownik] nazwa BLE: "%SZ_NAME%"  port: %SZ_PORT%
rem Monitor trzyma port - musi byc zamkniety przed uploadem.
taskkill /F /IM arduino-cli.exe >nul 2>&1

arduino-cli compile --fqbn "%FQBN%" --build-property "compiler.cpp.extra_flags=-DSZ_DEVICE_NAME=\"%SZ_NAME_ESC%\"" --output-dir build\szusownik firmware\Szusownik
if errorlevel 1 exit /b 1

arduino-cli upload -p %SZ_PORT% --fqbn "%FQBN%" --input-dir build\szusownik firmware\Szusownik
if errorlevel 1 exit /b 1

if /i "%SZ_PORT%"=="COM6" (
  echo [flash_szusownik] wgrane. Logi: monitor_COM6.cmd
) else (
  echo [flash_szusownik] wgrane. Logi: monitor_COM7.cmd
)
