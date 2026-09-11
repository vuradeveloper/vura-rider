#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — MANUALLY CREATE the Cape Town (af-south-1) RDS PostgreSQL instance
# ─────────────────────────────────────────────────────────────────────────────
# ⚠️⚠️ THIS SCRIPT DOES NOT CREATE THE RDS. ⚠️⚠️
# It ONLY records the hostname/password you type so the later steps can use it.
# Creating the database must be done BY HAND in the AWS web console:
#
#   1. Open the AWS console (browser) → top-RIGHT corner has a REGION dropdown
#      → change it to:   South Africa (Cape Town)  [ af-south-1 ]
#      (The region in the CloudShell terminal header is SEPARATE and does NOT
#       matter for this — the region dropdown on the main AWS console is what
#       decides where RDS gets created.)
#
#   2. Services → RDS → Create database:
#      Engine            : PostgreSQL (16 or newer)
#      Version           : 16.x
#      Region            : af-south-1 (shown at top of the page)
#      DB name           : vura
#      Username          : vura_admin
#      Password          : (your choice — keep it safe)
#      Instance class    : db.t3.medium (or larger, match current usage)
#      Public access     : No (keep private)
#
#   3. Wait for "Available", then copy the ENDPOINT hostname:
#        vura-XXXXXXXXXXXX.XXXXXXXXXXXX.af-south-1.rds.amazonaws.com
#
#   4. Run THIS script and paste that hostname — it just saves the values.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

echo "=== 1/6 RECORD CAPE TOWN RDS (manual step) ==="
echo "This script does NOT create anything — finish the RDS creation in the"
echo "AWS console (region = af-south-1) FIRST, then come back and paste values."
echo
read -rp "New af-south-1 RDS hostname (…af-south-1.rds.amazonaws.com): " NEW_DB_HOST
read -rp "New DB password (empty keeps vura2thinkdifferent): " NEW_DB_PASSWORD
NEW_DB_PASSWORD="${NEW_DB_PASSWORD:-vura2thinkdifferent}"
NEW_DB_NAME="${NEW_DB_NAME:-vura}"
NEW_DB_USER="${NEW_DB_USER:-vura_admin}"

echo
echo "Saved/confirmed RDS target (used by later steps):"
echo "  host     = $NEW_DB_HOST"
echo "  db       = $NEW_DB_NAME"
echo "  user     = $NEW_DB_USER"
echo "  password = ********"
echo
echo "■ DID YOU create the RDS in the AWS console with region af-south-1?"
echo "  If not, stop here — steps 02–05 will go NOWHERE until it exists."
echo "NEXT: run ./02-backup-and-restore-db.sh"