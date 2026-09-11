#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Copy the ENTIRE database from Virginia → Cape Town
# ─────────────────────────────────────────────────────────────────────────────
# IMPORTANT: RDS instances are usually NOT reachable from CloudShell directly
# (they live inside a private VPC). The reliable way is to RUN THIS from:
#   1) The OLD EB instance in us-east-1  (it can already reach the old RDS), or
#   2) An SSH bastion in the OLD VPC, or
#   3) Start pg_dump on the old side, upload dump to S3, restore from S3 on
#      the new side's bastion.
#
# For a quick path, if BOTH RDS endpoints are reachable from this box
# (e.g. you set Public access = Yes on the new DB temporarily, and the old
# DB is already publicly reachable), you can dump+restore directly:
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

OLD_DB_HOST="${OLD_DB_HOST:-vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com}"
OLD_DB_NAME="${OLD_DB_NAME:-vura}"
OLD_DB_USER="${OLD_DB_USER:-vura_admin}"
OLD_DB_PASSWORD="${OLD_DB_PASSWORD:-vura2thinkdifferent}"

echo "=== 2/6 BACKUP + RESTORE DATABASE ==="
read -rp "New af-south-1 RDS hostname: " NEW_DB_HOST
read -rp "New DB name [vura]: " NEW_DB_NAME; NEW_DB_NAME="${NEW_DB_NAME:-vura}"
read -rp "New DB user [vura_admin]: " NEW_DB_USER; NEW_DB_USER="${NEW_DB_USER:-vura_admin}"
read -rsp "New DB password: " NEW_DB_PASSWORD; echo
read -rp "Dump file path [vura-full.dump]: " DUMP; DUMP="${DUMP:-vura-full.dump}"

echo
echo "1) Dumping Virginia DB (custom pg_dump)..."
PGPASSWORD="$OLD_DB_PASSWORD" pg_dump \
  -h "$OLD_DB_HOST" -U "$OLD_DB_USER" -d "$OLD_DB_NAME" \
  --no-owner --no-acl --format=custom \
  -f "$DUMP"
echo "   → $DUMP ($(du -h "$DUMP" | cut -f1))"

echo
echo "2) Uploading to S3 for safe keeping..."
BUCKET="${S3_BUCKET:-elasticbeanstalk-us-east-1-456097556241}"
aws s3 cp "$DUMP" "s3://$BUCKET/backups/cape-town-migration-$DUMP" --storage-class STANDARD_IA
echo "   → s3://$BUCKET/backups/cape-town-migration-$DUMP"

echo
echo "3) Restoring into Cape Town RDS..."
if command -v pg_restore >/dev/null 2>&1; then
  PGPASSWORD="$NEW_DB_PASSWORD" pg_restore \
    -h "$NEW_DB_HOST" -U "$NEW_DB_USER" -d "$NEW_DB_NAME" \
    --no-owner --no-acl --no-comments --verbose \
    "$DUMP"
  echo "   ✅ Restore finished (errors about indexes/ownership are usually harmless)."
else
  echo "   ❌ pg_restore not found on this box."
  echo "      If the new RDS is NOT reachable from here, do the restore from"
  echo "      the NEW EC2/EB instance or a bastion inside the af-south-1 VPC:"
  echo "        aws s3 cp s3://$BUCKET/backups/cape-town-migration-$DUMP ."
  echo "        PGPASSWORD='...' pg_restore -h $NEW_DB_HOST -U $NEW_DB_USER -d $NEW_DB_NAME --no-owner --no-acl $DUMP"
fi

echo
echo "4) Sanity check — count rows in the new DB"
if command -v psql >/dev/null 2>&1; then
  PGPASSWORD="$NEW_DB_PASSWORD" psql -h "$NEW_DB_HOST" -U "$NEW_DB_USER" -d "$NEW_DB_NAME" \
    -c "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM rides) AS rides, (SELECT count(*) FROM driver_profiles) AS drivers;"
fi