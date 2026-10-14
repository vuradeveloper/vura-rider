#!/bin/bash
# AL2023 Elastic Beanstalk predeploy hook - install the server's production deps
# for THIS platform. During predeploy the new release sits at /var/app/staging
# (it is copied to /var/app/current at deploy), so installing here makes
# node_modules land with the live app.
#
# WHY THE CANARY EXECUTES EXPRESS (the 2026-10-14 outage): server/node_modules is
# built on the developer's machine and shipped inside the deploy zip (.ebignore
# re-includes it so a fresh instance boots without a 100MB npm install). File
# presence checks CANNOT see a partially-extracted or foreign tree - production
# crash-looped with "Cannot find module 'depd'" (body-parser's transitive dep)
# while the dotenv/sharp files were all present. require('express') executes the
# whole chain express -> body-parser -> depd, so it fails exactly when the app
# would fail. A tree that fails the canary is WIPED and rebuilt with npm ci,
# which deletes node_modules itself and installs exactly package-lock.json -
# partial trees cannot survive it.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

# v12 recolor engine (python) — created ONCE, then untouched forever.
# Failure is never fatal to the deploy: the console falls back to a clear
# "v12 unavailable" message instead of generating non-v12 colours.
VENV=/opt/vura-recolour
if [ ! -x "$VENV/bin/python" ]; then
  echo "VURA: [hooks] installing v12 recolor python venv (one-time, first deploy)"
  python3 -m venv "$VENV" >/dev/null 2>&1 || true
fi
if [ -x "$VENV/bin/python" ]; then
  "$VENV/bin/pip" install --quiet --disable-pip-version-check \
    pillow numpy rembg onnxruntime scipy scikit-image opencv-python-headless \
    >/dev/null 2>&1 || true
fi

APP_DIR=""
if [ -d /var/app/staging/server ] && [ -f /var/app/staging/server/package.json ]; then
  APP_DIR=/var/app/staging/server
elif [ -d /var/app/current/server ] && [ -f /var/app/current/server/package.json ]; then
  APP_DIR=/var/app/current/server
fi

if [ -z "$APP_DIR" ]; then
  echo "VURA: [predeploy] WARN server folder not found - deps NOT installed here"
  exit 0
fi
cd "$APP_DIR"

deps_broken() {
  # Executable canaries: the exact import chain the boot process needs, plus
  # sharp (NATIVE: a Windows checkout ships @img/sharp-win32-x64 which cannot
  # load on linux-x64 - vehicle photos silently degrade without this check).
  [ ! -d node_modules ] && return 0
  node -e "require('express'); require('dotenv/config'); require('pg')" >/dev/null 2>&1 || return 0
  node -e "require('sharp')" >/dev/null 2>&1 || return 0
  return 1
}

if deps_broken; then
  echo "VURA: [predeploy] deps broken for this platform - clean reinstall (npm ci)"
  # Clear a foreign-platform sharp build first, then npm ci for a deterministic
  # tree: exact lockfile versions, no leftovers, no partial extractions.
  rm -rf node_modules/@img node_modules/sharp
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  echo "VURA: [predeploy] deps installed OK in $APP_DIR"
else
  echo "VURA: [predeploy] deps verified (express+dotenv+pg+sharp load) - skipping install"
fi

# Hard verify - anything still missing here would 502 the deploy the moment the
# web service starts, so fail the deploy loudly instead.
node -e "require('express'); require('dotenv/config'); require('pg')"
echo "VURA: [predeploy] verified express+dotenv+pg load"
