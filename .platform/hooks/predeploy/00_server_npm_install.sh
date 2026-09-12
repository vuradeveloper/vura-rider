#!/bin/bash
# AL2023 Elastic Beanstalk predeploy hook — install the server's production deps.
# During predeploy the app is staged at /var/app/staging (copied to /var/app/current
# at deploy), so installing here makes node_modules land with the live app.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

INSTALLED=0

if [ -d /var/app/staging/server ] && [ -f /var/app/staging/server/package.json ]; then
  cd /var/app/staging/server
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  INSTALLED=1
  echo "VURA: [predeploy] deps installed OK in /var/app/staging/server"
elif [ -d /var/app/current/server ] && [ -f /var/app/current/server/package.json ]; then
  cd /var/app/current/server
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  INSTALLED=1
  echo "VURA: [predeploy] deps installed OK in /var/app/current/server"
fi

if [ "$INSTALLED" = "0" ]; then
  echo "VURA: [predeploy] WARN server folder not found — deps NOT installed here"
fi

# Fail loudly if dotenv (the canary dep) is still missing — a silent 502 costs more.
if [ -d /var/app/current/server ] && [ ! -e /var/app/current/server/node_modules/dotenv ]; then
  echo "VURA: [predeploy] ERROR dotenv missing in /var/app/current/server/node_modules"
fi