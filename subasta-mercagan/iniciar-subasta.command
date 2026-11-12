#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Falta instalar Node.js: https://nodejs.org (versión LTS)"; read -r; exit 1; }
[ -d node_modules ] || { echo "Instalando por primera vez..."; npm install; }
node server.js
