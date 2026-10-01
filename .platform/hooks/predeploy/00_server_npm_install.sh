#!/bin/bash
# AL2023 Elastic Beanstalk predeploy hook - install the server's production deps for
# THIS platform. During predeploy the new release sits at /var/app/staging (it is
# copied to /var/app/current at deploy), so installing here makes node_modules land
# with the live app.
#
# Why the @img wipe before installing: server/node_modules is built on the
# developer's machine and shipped inside the deploy zip (.ebignore re-includes it so
# a fresh instance boots without a 100MB npm install). A Windows checkout therefore
# carries @img/sharp-win32-x64, and npm can decide that already satisfies the
# optional @img/* dependency instead of fetching the linux-x64 binary. Removing it
# forces the correct native build - which is what keeps sharp from throwing "Could
# not load the sharp module using the linux-x64 runtime". That failure was silent:
# CarsXE still returned 9 images with HTTP 200 and every car quietly kept its icon.
#
# Only the newest release is touched. If staging exists we install there; otherwise
# we fall back to /var/app/current, exactly as before. Never both - a failed deploy
# must not leave the still-live release with mismatched dependencies.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

APP_DIR=""
if [ -d /var/app/staging/server ] && [ -f /var/app/staging/server/package.json ]; then
  APP_DIR=/var/app/staging/server
elif [ -d /var/app/current/server ] && [ -f /var/app/current/server/package.json ]; then
  APP_DIR=/var/app/current/server
fi

if [ -n "$APP_DIR" ]; then
  cd "$APP_DIR"
  rm -rf node_modules/@img node_modules/sharp
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  echo "VURA: [predeploy] deps installed OK in $APP_DIR"
else
  echo "VURA: [predeploy] WARN server folder not found - deps NOT installed here"
fi
