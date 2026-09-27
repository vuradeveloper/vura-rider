#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vura — pre-migration facts, read from the OLD account (456097556241, us-east-1).
#
#   WHERE TO RUN THIS: the OLD account's own CloudShell — credentials are bound to
#   the console session you opened it from:
#     browser → https://us-east-1.console.aws.amazon.com signed in as 456097556241
#     → CloudShell icon → bash deploy/check-old-account.sh
#
# Read-only. Use the output to choose the data-migration path
# (deploy/AWS-NEW-ACCOUNT-SETUP.md §6) and to capture the rollback target.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
OLD_ACCOUNT=456097556241
NEW_ACCOUNT=171180524226
REGION=us-east-1
DBID=vura
APP=vura-rider

echo "=== identity ==="
ACCT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"
if [ "$ACCT" != "$OLD_ACCOUNT" ]; then
  echo "  [STOP] this shell is account $ACCT, not the old account $OLD_ACCOUNT."
  echo "         Every check below would silently return EMPTY from here — which is"
  echo "         exactly how 'there is no data' gets misread. CloudShell credentials"
  echo "         come from the console session that opened it: sign in to the old"
  echo "         account ($OLD_ACCOUNT), region $REGION, open CloudShell, re-run."
  exit 1
fi
echo "  [ok] account $ACCT in $REGION"

echo "=== 1/5  rollback target — old EB env CNAME (record it in deploy/ACCOUNT.md) ==="
aws elasticbeanstalk describe-environments --region "$REGION" --application-name "$APP" \
  --query 'Environments[].[EnvironmentName,Status,Health,CNAME]' --output text

echo "=== 2/5  DB instance — snapshot sharing needs a customer-managed KMS key ==="
aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DBID" \
  --query 'DBInstances[0].[DBInstanceIdentifier,DBInstanceClass,Engine,EngineVersion,AllocatedStorage,StorageEncrypted,KmsKeyId,PubliclyAccessible,Endpoint.Address,DBName,MasterUsername]' \
  --output text

echo "=== 3/5  snapshots (manual ones are the only shareable kind) ==="
echo "-- manual --"
aws rds describe-db-snapshots --region "$REGION" --db-instance-identifier "$DBID" \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,Status,SnapshotCreateTime]' --output text
echo "-- automated, newest 3 --"
aws rds describe-db-snapshots --region "$REGION" --db-instance-identifier "$DBID" --snapshot-type automated \
  --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[:3].[DBSnapshotIdentifier,SnapshotCreateTime]' \
  --output text

echo "=== 4/5  rough data volume (allocated − free storage) ==="
ALLOC="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DBID" \
  --query 'DBInstances[0].AllocatedStorage' --output text 2>/dev/null)"
FREE="$(aws cloudwatch get-metric-statistics --region "$REGION" --namespace AWS/RDS --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value="$DBID" --statistics Average --period 3600 \
  --start-time "$(date -u -d '6 hours ago' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
  --query 'sort_by(Datapoints,&Timestamp)[-1].Average' --output text 2>/dev/null)"
if [ -n "$ALLOC" ] && [ -n "$FREE" ] && [ "$FREE" != "None" ]; then
  awk -v a="$ALLOC" -v b="$FREE" 'BEGIN { printf "  allocated %.0f GiB · free %.2f GiB · used %.2f GiB\n", a, b/1073741824, a - b/1073741824 }'
  echo "  (a few hundred MB 'used' is only the empty Postgres filesystem — a hint, not"
  echo "   proof; the row-count SQL in §6 is the proof)"
else
  echo "  (no CloudWatch datapoint yet — treat as unknown)"
fi

echo "=== 5/5  driver-document buckets (rows store s3_key, so keys must be copied) ==="
aws s3 ls 2>/dev/null | grep -i docs || { echo "  (none matching 'docs'; all buckets:)"; aws s3 ls 2>/dev/null; }

cat <<'NEXT'

NEXT — once the output above looks right:

  # 1. take a manual snapshot (freeze writes for a few minutes if you want a clean copy)
  aws rds create-db-snapshot --region us-east-1 --db-instance-identifier vura \
    --db-snapshot-identifier vura-handover-YYYYMMDD
  aws rds wait db-snapshot-completed --region us-east-1 --db-snapshot-identifier vura-handover-YYYYMMDD

  # 2. share it with the new account. Fails when the instance uses the default
  #    aws/rds KMS key → in that case use the pg_dump route (§6 option B).
  aws rds modify-db-snapshot-attribute --region us-east-1 \
    --db-snapshot-identifier vura-handover-YYYYMMDD \
    --attribute-name restore --values-to-add 171180524226

  # 3. in the NEW account (af-south-1): copy into the region, then restore a NEW
  #    instance (you cannot restore over vura-prod):
  #    aws rds copy-db-snapshot --region af-south-1 \
  #      --source-db-snapshot-identifier <shared-arn> \
  #      --target-db-snapshot-identifier vura-handover-af --kms-key-id <af-key>
  #    aws rds restore-db-instance-from-db-snapshot --region af-south-1 \
  #      --db-instance-identifier vura-prod-data \
  #      --db-snapshot-identifier vura-handover-af \
  #      --db-instance-class <class> --db-subnet-group-name <group> \
  #      --vpc-security-group-ids sg-0ac99f697843e73a5 --no-publicly-accessible

  # 4. point the app at the restored data, verify the §6 row counts, redeploy:
  #    eb setenv -e vura-rider-prod --region af-south-1 DB_HOST=<endpoint> DB_PASSWORD='<pw>'
  #    eb deploy vura-rider-prod --region af-south-1

  # 5. copy the driver documents (§6): the s3_key layout must match
  #    aws s3 sync s3://<old-docs-bucket>/documents/ s3://vura-driver-docs-171180524226/documents/
NEXT
