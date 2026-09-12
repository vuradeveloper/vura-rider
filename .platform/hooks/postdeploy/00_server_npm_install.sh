#!/bin/bash
# AL2023 Elastic Beanstalk postdeploy hook — guaranteed deps for the web process.
# Runs AFTER the app is dragged out to /var/app/current and BEFORE the web
# service starts. If dotenv (the canary dep) is missing, install production deps
# right here. This covers deploys where the predeploy staging path wasn't hit.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

if [ ! -d /var/app/current/server ]; then
  echo "VURA: [postdeploy] ERROR /var/app/current/server missing"
  exit 1
fi

cd /var/app/current/server

if [ ! -e node_modules/dotenv ]; then
  echo "VURA: [postdeploy] dotenv missing — installing deps into /var/app/current/server"
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
else
  echo "VURA: [postdeploy] deps already present, skipping install"
fi

# Hard verify the canary dep survives — else the app dies with MODULE_NOT_FOUND.
if [ ! -e node_modules/dotenv ]; then
  echo "VURA: [postdeploy] ERROR dotenv still missing after install"
  exit 1
fi

echo "VURA: [postdeploy] verified node_modules/dotenv OK"