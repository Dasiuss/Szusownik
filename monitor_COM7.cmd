@echo off
cd /d "%~dp0"
rem Log leci jednoczesnie na konsole i do monitor_COM7.log (plik czyszczony na starcie).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$log = Join-Path (Get-Location) 'monitor_COM7.log'; $fs = New-Object System.IO.StreamWriter($log, $false, (New-Object System.Text.UTF8Encoding($false))); $fs.AutoFlush = $true; arduino-cli monitor --port COM7 --config baudrate=115200,dtr=off,rts=off 2>&1 | ForEach-Object { Write-Host $_; $fs.WriteLine($_) }; $fs.Close()"
pause
