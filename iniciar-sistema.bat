@echo off
cd /d "%~dp0"
title JAPURIMA - Iniciar sistema
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo JAPURIMA Fase 1. No hay usuarios ni claves predeterminados.
echo Cree primero un administrador con npm run create-admin.
echo Revise docs\FASE1.md para configuracion y respaldo.
"%NODE_EXE%" server.js
pause
