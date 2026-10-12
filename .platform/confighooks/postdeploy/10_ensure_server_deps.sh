#!/bin/bash
# EB CONFIGURATION-deployment hook — runs on `eb setenv` and friends.
#
# WHY THIS EXISTS (the production incident): a configuration update REPLACES
# /var/app/current from the last deployed source bundle WITHOUT running
# .platform/hooks/predeploy|postdeploy (aws/elastic-beanstalk-roadmap#88), so
# the node_modules those hooks installed can vanish and the app dies at once
# with "Cannot find module 'dotenv/config'" until somebody redeploys.
# This hook re-checks the LIVE app dir and installs only when needed, BEFORE
# the services restart with the new environment.
#
# Failure semantics are deliberate: if deps are broken and cannot be repaired,
# exit 1 ABORTS the configuration update, so the environment keeps its OLD env
# vars and the currently-running app stays up — a visibly failed `eb setenv`
# beats a silent 502.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

if [ ! -d /var/app/current/server ]; then
  echo "VURA: [confighooks] ERROR /var/app/current/server missing"
  exit 1
fi
cd /var/app/current/server

# Same two canaries as .platform/hooks/postdeploy/00_server_npm_install.sh:
# dotenv (pure-JS: node_modules never arrived) + sharp (NATIVE: a config deploy
# re-extracts the ZIP's Windows-built node_modules, so the linux-x64 binary is
# gone until it is reinstalled — otherwise vehicle photos silently degrade).
deps_broken() {
  [ ! -e node_modules/dotenv ] && return 0
  [ ! -e node_modules/sharp ] && return 0
  node -e "require('sharp')" >/dev/null 2>&1 || return 0
  return 1
}

if deps_broken; then
  echo "VURA: [confighooks] deps missing or sharp cannot load - installing for this platform"
  rm -rf node_modules/@img node_modules/sharp
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
else
  echo "VURA: [confighooks] deps present and sharp loads - skipping install"
fi

if [ ! -e node_modules/dotenv ]; then
  echo "VURA: [confighooks] ERROR dotenv still missing after install"
  exit 1
fi

if node -e "require('sharp')" >/dev/null 2>&1; then
  echo "VURA: [confighooks] verified dotenv + sharp OK"
else
  echo "VURA: [confighooks] WARNING sharp cannot load - vehicle images will degrade"
fi
