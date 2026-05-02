@echo off
cd /d "%~dp0"
title JAPURIMA - Iniciar sistema

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo Iniciando sistema JAPURIMA...
echo.
echo Se abrira otra ventana llamada "JAPURIMA Servidor".
echo NO cierre esa ventana mientras use el sistema.
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
