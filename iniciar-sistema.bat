@echo off
cd /d "%~dp0"
title JAPURIMA - Iniciar sistema

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
if "%APP_USER%"=="" set "APP_USER=admin"
if "%APP_PASSWORD%"=="" set "APP_PASSWORD=admin123"

echo Iniciando sistema JAPURIMA...
echo.
echo Se abrira otra ventana llamada "JAPURIMA Servidor".
echo NO cierre esa ventana mientras use el sistema.
echo Usuario local: %APP_USER%
echo Clave local: %APP_PASSWORD%
echo.

start "JAPURIMA Servidor" cmd /k ""%NODE_EXE%" server.js"

timeout /t 3 /nobreak >nul
start "" "http://localhost:8080"

echo Si el navegador no abre, entre manualmente a:
echo http://localhost:8080
echo.
echo Para celulares u otras computadoras, use la IP que aparece en la ventana "JAPURIMA Servidor".
echo.
pause
