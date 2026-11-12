@echo off
title Subasta Mercagan - Quien da mas
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta instalar Node.js: https://nodejs.org ^(version LTS^) & pause & exit /b)
if not exist node_modules (echo Instalando por primera vez... & call npm install)
node server.js
pause
