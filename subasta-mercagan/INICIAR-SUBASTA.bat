@echo off
title Subasta Mercagan - Quien da mas
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if "%NODE%"=="node" (
  where node >nul 2>nul || (echo Falta Node.js. Descargalo en https://nodejs.org ^(version LTS^) & pause & exit /b)
  if not exist node_modules (echo Instalando por primera vez... & call npm install --omit=dev)
)
"%NODE%" server.js
pause
