#!/bin/bash
# EB CONFIGURATION-deployment hook - runs on `eb setenv` / console config saves.
#
# WHY THIS EXISTS: a configuration update REPLACES /var/app/current from the last
# deployed source bundle WITHOUT running .platform/hooks/predeploy|postdeploy
# (aws/elastic-beanstalk-roadmap#88), so the node_modules those hooks installed
# can vanish and the app dies at once. This hook re-checks the LIVE app dir and
# repairs it BEFORE the services restart with the new environment.
#
# The canary EXECUTES require('express') (2026-10-14 outage): file-presence
# checks passed while the shipped tree was missing 'depd' and the API crash-
# looped with MODULE_NOT_FOUND. Executing the import chain is the only honest
# test; a failing tree is wiped and rebuilt with npm ci (exact lockfile).
#
# Failure semantics are deliberate: if deps are broken and cannot be repaired,
# exit 1 ABORTS the configuration update, so the environment keeps its OLD env
# vars and the currently-running app stays up - a visibly failed config update
# beats a silent 502.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

if [ ! -d /var/app/current/server ]; then
  echo "VURA: [confighooks] ERROR /var/app/current/server missing"
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
  echo "VURA: [confighooks] deps broken for this platform - clean reinstall (npm ci)"
  rm -rf node_modules/@img node_modules/sharp
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
else
  echo "VURA: [confighooks] deps verified (express+dotenv+pg+sharp load) - skipping install"
fi

# Hard verify the boot canary - else the app dies with MODULE_NOT_FOUND.
node -e "require('express'); require('dotenv/config'); require('pg')"
echo "VURA: [confighooks] verified express+dotenv+pg load"

# sharp is deliberately NOT fatal (vehicle images degrade, the API works).
if node -e "require('sharp')" >/dev/null 2>&1; then
  echo "VURA: [confighooks] sharp OK"
else
  echo "VURA: [confighooks] WARNING sharp cannot load - vehicle images will degrade"
fi
