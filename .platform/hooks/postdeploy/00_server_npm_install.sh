#!/bin/bash
# AL2023 EB postdeploy hook - second safety net AFTER the release is flipped
# into /var/app/current and BEFORE the web service starts. Predeploy already
# verified/installed into staging; this re-verifies the LIVE dir because the
# flip/copy step is where a broken tree has surprised us before.
#
# Canary EXECUTES require('express') (2026-10-14 outage: shipped tree missing
# 'depd' crash-looped the API while file-presence checks all passed). Repair is
# npm ci - wipes node_modules, installs exactly package-lock.json.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

if [ ! -d /var/app/current/server ]; then
  echo "VURA: [postdeploy] ERROR /var/app/current/server missing"
  exit 1
fi
cd /var/app/current/server

deps_broken() {
  [ ! -d node_modules ] && return 0
  node -e "require('express'); require('dotenv/config'); require('pg')" >/dev/null 2>&1 || return 0
  node -e "require('sharp')" >/dev/null 2>&1 || return 0
  return 1
}

if deps_broken; then
  echo "VURA: [postdeploy] deps broken for this platform - clean reinstall (npm ci)"
  rm -rf node_modules/@img node_modules/sharp
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
else
  echo "VURA: [postdeploy] deps verified (express+dotenv+pg+sharp load) - skipping install"
fi

# Hard verify the boot canary - the web service starts the moment this exits 0.
node -e "require('express'); require('dotenv/config'); require('pg')"
echo "VURA: [postdeploy] verified express+dotenv+pg load"

# sharp is deliberately NOT fatal: a broken sharp costs vehicle photos, a fatal
# hook here would cost the whole backend.
if node -e "require('sharp')" >/dev/null 2>&1; then
  echo "VURA: [postdeploy] verified sharp OK"
else
  echo "VURA: [postdeploy] WARNING sharp cannot load on this platform - vehicle images will degrade"
fi
