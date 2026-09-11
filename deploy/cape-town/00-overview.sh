#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vura — Cape Town (af-south-1) Migration Runbook
# ─────────────────────────────────────────────────────────────────────────────
# WHAT WE ARE MOVING (from AWS us-east-1 / Virginia):
#   1. PostgreSQL RDS   vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com  (DB "vura")
#   2. Elastic Beanstalk env "vura-rider-prod" (Node app, serves api.ridevura.com)
#   3. All env vars / secrets from EB env properties + deploy/production.env
#   4. DNS api.ridevura.com → new af-south-1 EB hostname
#
# WHERE the commands run:
#   - Run the AWS CLI / EB CLI / pg_dump / psql commands in AWS CloudShell
#     (browser → https://us-east-1.console.aws.amazon.com → CloudShell icon)
#     OR on any Linux box that has: aws, eb, psql, pg_dump, git, node.
#
# PREREQUISITES (one-time, ~15 min):
#   A. Create RDS Postgres in af-south-1  (see Section 1 below)
#   B. Create EB app+env in af-south-1     (see Section 3 below)
#   C. Have the latest DB dump (Section 2) and the repo cloned in CloudShell
#   D. A Linux host that can reach the NEW af-south-1 RDS to run the restore
#      (easiest: the new EB instance via `eb ssh`, or an EC2 bastion in the
#      same VPC/subnet; CloudShell alone can ONLY reach the S3 bucket).
# ═════════════════════════════════════════════════════════════════════════════
set -uo pipefail

echo "=================================================="
echo " Vura Cape Town Migration"
echo "=================================================="
echo "Old region        : us-east-1 (Virginia)"
echo "New region        : af-south-1 (Cape Town)"
echo "Source RDS        : vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com (DB vura)"
echo "S3 backups bucket : s3://elasticbeanstalk-us-east-1-456097556241/backups/"
echo "Source EB env     : vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com"
echo
echo "Follow the numbered sections in deploy/cape-town/README.md."
echo "This script is a checklist stub — each section is run manually."