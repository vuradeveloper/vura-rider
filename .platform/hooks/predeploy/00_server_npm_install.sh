#!/bin/bash
# AL2023 Elastic Beanstalk predeploy hook — install the server's production deps.
# During predeploy the app is staged at /var/app/staging (copied to /var/app/current
# at deploy), so installing here makes node_modules land with the live app.
set -e

if [ -d /var/app/staging/server ] && [ -f /var/app/staging/server/package.json ]; then
  cd /var/app/staging/server
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  echo "VURA: server deps installed OK"
elif [ -d /var/app/current/server ] && [ -f /var/app/current/server/package.json ]; then
  cd /var/app/current/server
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  echo "VURA: server deps installed OK (current)"
else
  echo "VURA: server folder not found (staging or current) — skipping npm install"
fi