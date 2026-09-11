#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Create the Cape Town (af-south-1) RDS PostgreSQL instance
# ─────────────────────────────────────────────────────────────────────────────
# Run in AWS CloudShell (browser) as the same account that owns the Virginia
# RDS, or create it from the console for full control.
#
# Console path: RDS → Create database
#   Engine            : PostgreSQL
#   Version           : 16 (or match the source; check below)
#   Instance class    : db.t3.medium (or larger — match current usage)
#   Region            : af-south-1  ← THE WHOLE POINT
#   DB name           : vura
#   Username          : vura_admin
#   Password          : <same vura2thinkdifferent or a new one>
#   Public access     : No (keep private inside the VPC)
#   DB cluster / instance : choose "instance"
#
# After it's ready, capture the NEW hostname — it looks like:
#   vura-XXXXXXXXXXXX.XXXXXXXXXXXX.af-south-1.rds.amazonaws.com
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

echo "=== 1/6 CREATE CAPE TOWN RDS ==="
read -rp "New af-south-1 RDS hostname (…af-south-1.rds.amazonaws.com): " NEW_DB_HOST
read -rp "New DB password (empty keeps vura2thinkdifferent): " NEW_DB_PASSWORD
NEW_DB_PASSWORD="${NEW_DB_PASSWORD:-vura2thinkdifferent}"
NEW_DB_NAME="${NEW_DB_NAME:-vura}"
NEW_DB_USER="${NEW_DB_USER:-vura_admin}"

echo
echo "New RDS target:"
echo "  host     = $NEW_DB_HOST"
echo "  db       = $NEW_DB_NAME"
echo "  user     = $NEW_DB_USER"
echo "  password = ********"
echo
echo "Save these — you'll need them in every later step."
echo "NEXT: run ./02-backup-and-restore-db.sh with these values."