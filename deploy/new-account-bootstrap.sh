#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vura — NEW ACCOUNT bootstrap. Run in AWS CloudShell (region: af-south-1).
#
#   bash deploy/new-account-bootstrap.sh
#
# Prereqs:
#   • Signed in as an admin identity on account 171180524226 (root MFA already done)
#   • Repo cloned in CloudShell:  git clone https://github.com/vuradeveloper/vura-rider.git ~/vura-rider
#   • RDS for `vura` already created in the console (deploy/AWS-NEW-ACCOUNT-SETUP.md §3 Step 3.2)
#
# It creates the S3 bucket + EB environment, sets every env var, deploys, and prints
# the health check. It is idempotent — safe to re-run.
# Full context: deploy/AWS-NEW-ACCOUNT-SETUP.md §3–§4.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REGION="${REGION:-af-south-1}"
APP="${APP:-vura-rider}"
ENVNAME="${ENVNAME:-vura-rider-prod}"
ACCOUNT_ID="${ACCOUNT_ID:-171180524226}"
BUCKET="${BUCKET:-vura-driver-docs-${ACCOUNT_ID}}"

echo "=== 0/6  tooling + repo ==="
if ! command -v eb >/dev/null; then
  pip3 install --user --break-system-packages awsebcli 2>/dev/null \
    || pip3 install --user awsebcli 2>/dev/null \
    || python3 -m pip install --user --break-system-packages awsebcli 2>/dev/null \
    || true
fi
export PATH="$HOME/.local/bin:$PATH"
command -v eb >/dev/null || { echo "❌ eb CLI still missing (try: pip3 install --user --break-system-packages awsebcli)"; exit 1; }
cd ~/vura-rider 2>/dev/null || { echo "❌ clone first: git clone https://github.com/vuradeveloper/vura-rider.git ~/vura-rider"; exit 1; }
git pull --ff-only || true

# EB version labels must match [^/]+ — the annotated tag "backup/2026-09-20-cape-working"
# makes `git describe` produce a label the EB API rejects
# ("Value '[…]' at 'versionLabels' failed to satisfy constraint … pattern: [^/]+"),
# which aborts `eb create` with a confusing ServiceError. Drop slash-tags in this clone.
git tag -l | grep '/' | xargs -r -n1 git tag -d || true

echo "=== 1/6  S3 bucket for driver documents: $BUCKET ==="
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
  echo "   created (private, versioned)"
else
  echo "   already exists"
fi

echo "=== 2/6  eb init / eb create (create MUST come first: it makes the instance role) ==="
PLATFORM="$(aws elasticbeanstalk list-available-solution-stacks --region "$REGION" \
  --query "SolutionStacks[?contains(@,'Node.js 22') && contains(@,'Amazon Linux 2023')] | [0]" \
  --output text 2>/dev/null)"
if [ -z "$PLATFORM" ] || [ "$PLATFORM" = "None" ]; then
  PLATFORM="Node.js 22 running on 64bit Amazon Linux 2023"
fi
echo "   platform: $PLATFORM"
[ -f .elasticbeanstalk/config.yml ] || eb init "$APP" --region "$REGION" --platform "$PLATFORM"
if ! eb list --region "$REGION" 2>/dev/null | grep -qx "$ENVNAME"; then
  eb create "$ENVNAME" --region "$REGION" --single --instance-type t3.small \
    || { echo "❌ eb create failed — fix the cause and re-run (this script is idempotent)"; exit 1; }
else
  echo "   env $ENVNAME already exists"
fi
eb use "$ENVNAME" --region "$REGION" >/dev/null 2>&1 && echo "   default environment = $ENVNAME"

echo "=== 3/6  permissions + network (no static keys, no manual console edits) ==="
cat > /tmp/vura-docs-s3.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:PutObject","s3:GetObject","s3:DeleteObject"],"Resource":"arn:aws:s3:::$BUCKET/*"}]}
EOF
aws iam put-role-policy --role-name aws-elasticbeanstalk-ec2-role \
  --policy-name vura-docs-s3 --policy-document file:///tmp/vura-docs-s3.json \
  && echo "   S3 policy attached to the EB instance role" \
  || echo "   ⚠️ role aws-elasticbeanstalk-ec2-role not found — attach the policy manually"

RDS_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=vura-rds-sg \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)
EB_SG=$(aws ec2 describe-security-groups \
  --filters "Name=tag:elasticbeanstalk:environment-name,Values=$ENVNAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)
if [ -n "${RDS_SG:-}" ] && [ "$RDS_SG" != "None" ] && [ -n "${EB_SG:-}" ] && [ "$EB_SG" != "None" ]; then
  aws ec2 authorize-security-group-ingress --group-id "$RDS_SG" --protocol tcp \
    --port 5432 --source-group "$EB_SG" 2>/dev/null \
    && echo "   RDS now accepts 5432 from the EB instance SG ($EB_SG)" \
    || echo "   rule already present"
else
  echo "   ⚠️ could not auto-detect security groups (RDS_SG=$RDS_SG EB_SG=$EB_SG)"
  echo "      Manual: RDS → vura-prod → Connectivity → vura-rds-sg → Inbound → PostgreSQL 5432, source = EB instance SG"
fi

echo "=== 4/6  secrets + env vars (nothing is written to disk) ==="
echo "  Source of each value: deploy/production.env and server/.env on your PC."
echo "  Enter skips an optional value; DB_HOST and DB_PASSWORD are required."

ask() { # ask VAR "prompt" ['validation-regex']
  local var="$1" prompt="$2" regex="${3:-}" val=""
  while :; do
    read -rp "$prompt: " val || true
    if [ -z "$val" ]; then printf -v "$var" '%s' ""; return; fi
    if [ -n "$regex" ] && ! printf '%s' "$val" | grep -Eq "$regex"; then
      echo "   ↳ not valid (must match ${regex}) — try again, or Enter to skip"; continue
    fi
    printf -v "$var" '%s' "$val"; return
  done
}

ask DB_HOST "RDS endpoint host only" '\.rds\.amazonaws\.com$'
read -rsp "DB password for vura_admin: " DB_PASSWORD; echo
ask FIREBASE_CLIENT_EMAIL "Firebase client email" '@.*\.iam\.gserviceaccount\.com$'
read -rsp "Firebase private_key base64 (one line, from _vura_cloudshell_values.txt): " FIREBASE_PRIVATE_KEY_B64; echo
read -rsp "Paystack LIVE secret (sk_live_…): " PAYSTACK_SECRET_LIVE; echo
read -rp  "Paystack LIVE public (pk_live_…): " PAYSTACK_PUBLIC_LIVE
read -rsp "Resend API key (re_…): " RESEND_API_KEY; echo
ask HERE_API_KEY "HERE API key (optional — Enter to skip)"
ask ADMIN_EMAILS "Admin emails, comma-separated (needed for the admin screens)"
[ -z "${DB_HOST:-}" ] && { echo "❌ DB_HOST is required"; exit 1; }
[ -z "${DB_PASSWORD:-}" ] && { echo "❌ DB_PASSWORD is required"; exit 1; }

ENV_ARGS=(
  "NODE_ENV=production" "PORT=3000"
  "DB_HOST=${DB_HOST}" "DB_PORT=5432" "DB_NAME=vura" "DB_USER=vura_admin"
  "DB_PASSWORD=${DB_PASSWORD}" "DB_SSL=true"
  "FIREBASE_PROJECT_ID=vura-f667d"
  "AWS_S3_BUCKET=${BUCKET}" "AWS_S3_REGION=${REGION}"
  "ALLOWED_ORIGINS=http://localhost:19006,http://localhost:8081,https://localhost,capacitor://localhost,http://localhost,https://ridevura.com,https://www.ridevura.com,https://api.ridevura.com"
  "PUBLIC_BASE_URL=https://api.ridevura.com"
  "RATE_LIMIT_WINDOW_MS=900000" "RATE_LIMIT_MAX_REQUESTS=6000" "ROUTE_RATE_LIMIT_MAX=300" "LOG_LEVEL=info"
  "PAYMENTS_MODE=live" "PAYSTACK_CALLBACK_URL=https://api.ridevura.com/api/payments/return"
  "RESEND_FROM_EMAIL=onboarding@ridevura.com"
  "DEV_LOG_WRITE_KEY=$(openssl rand -hex 16)" "DEV_LOG_READ_KEY=$(openssl rand -hex 16)"
)
for pair in "FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL:-}" \
            "FIREBASE_PRIVATE_KEY_B64=${FIREBASE_PRIVATE_KEY_B64:-}" \
            "PAYSTACK_SECRET_LIVE=${PAYSTACK_SECRET_LIVE:-}" \
            "PAYSTACK_PUBLIC_LIVE=${PAYSTACK_PUBLIC_LIVE:-}" \
            "RESEND_API_KEY=${RESEND_API_KEY:-}" \
            "HERE_API_KEY=${HERE_API_KEY:-}" \
            "ADMIN_EMAILS=${ADMIN_EMAILS:-}"; do
  [ -n "${pair#*=}" ] && ENV_ARGS+=("$pair")
done
eb setenv -e "$ENVNAME" --region "$REGION" "${ENV_ARGS[@]}" \
  || { echo "❌ eb setenv failed"; exit 1; }
echo "   ✓ set ${#ENV_ARGS[@]} environment properties"

echo "=== 5/6  deploy (server/dist is committed; deps install on the instance) ==="
LABEL="vura-$(date +%y%m%d_%H%M%S)"   # explicit: a slash in a git tag must never reach the label
eb deploy "$ENVNAME" --region "$REGION" --label "$LABEL" \
  || { echo "❌ eb deploy failed"; exit 1; }

echo "=== 6/6  verify ==="
HOST="$(eb status "$ENVNAME" --region "$REGION" --verbose | awk -F': ' '/CNAME/{print $2; exit}')"
echo "EB hostname: $HOST"
curl -s  "https://$HOST/health"; echo
curl -s -o /dev/null -w "  /api/rides/available -> %{http_code} (expect 401)\n" "https://$HOST/api/rides/available"
echo
echo "NEXT: only after /health says ok, point Cloudflare's 'api' CNAME at:"
echo "      $HOST"
echo "Rollback: flip that CNAME back to the old env and redeploy the previous commit."
