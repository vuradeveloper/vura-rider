#!/usr/bin/env bash
# Vura RDS automated backup
# Run daily via cron:  0 3 * * *  /opt/vura-rider/deploy/rds-backup.sh
# Safe to run from any box with the AWS CLI + DB creds in env.

set -euo pipefail

DB_HOST="${DB_HOST:-vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com}"
DB_NAME="${DB_NAME:-vura}"
DB_USER="${DB_USER:-vura_admin}"
DB_PASSWORD="${DB_PASSWORD:-}"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vura}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "${BACKUP_DIR}"

echo "[backup] Dumping ${DB_NAME} at ${STAMP}"
if [ -z "$DB_PASSWORD" ]; then
  echo "[backup] ERROR: DB_PASSWORD not set" >&2
  exit 1
fi

PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" \
  --no-owner --no-privileges --format=custom \
  -f "${BACKUP_DIR}/${DB_NAME}-${STAMP}.dump"

echo "[backup] Uploading to S3"
aws s3 cp "${BACKUP_DIR}/${DB_NAME}-${STAMP}.dump" \
  "s3://elasticbeanstalk-us-east-1-456097556241/backups/${DB_NAME}-${STAMP}.dump" \
  --storage-class STANDARD_IA

echo "[backup] Purging local dumps older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] Done"