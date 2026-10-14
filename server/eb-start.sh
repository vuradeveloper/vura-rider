#!/bin/sh
# Web process start gate. Procfile calls this as a SINGLE plain command
# (`web: sh server/eb-start.sh`) because the previous inline one-liner carried
# node -e "..." quotes and ( ) subshells through EB's Procfile->systemd/rsyslog
# generators - the 2026-10-14 deploy failed in the 3 seconds right after
# FlipApplication, and parser-hostile Procfile content is a prime suspect.
# All logic lives HERE, where shell syntax can never break a generator.
#
# Behaviour: verify the exact import chain the boot needs
# (express -> body-parser -> depd). If it fails, the shipped dev-machine
# node_modules is broken/partial - wipe foreign-platform leftovers, rebuild
# deterministically with npm ci (exact lockfile), verify again, then start.
# Any failure exits loudly and lands in /var/log/web.stdout.log, so the deploy
# shows an error instead of silent-crash-looping into a 502.
set -e
cd "$(dirname "$0")"

canary() {
  node -e "require('express'); require('dotenv/config'); require('pg')" >/dev/null 2>&1
}

if ! canary; then
  echo "VURA: [start] deps broken for this platform - clean reinstall (npm ci)"
  rm -rf node_modules/@img node_modules/sharp
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if ! canary; then
    echo "VURA: [start] FATAL: deps still broken after npm ci"
    exit 1
  fi
  echo "VURA: [start] deps repaired OK"
fi

exec node dist/index.js
