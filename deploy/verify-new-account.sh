#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vura — READ-ONLY check that the new AWS account is fully wired.
# CloudShell:  cd ~/vura-rider && git pull --ff-only && bash deploy/verify-new-account.sh
# Changes nothing. See deploy/AWS-NEW-ACCOUNT-SETUP.md §3–§8.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REGION="${REGION:-af-south-1}"; APP="${APP:-vura-rider}"; ENVNAME="${ENVNAME:-vura-rider-prod}"
ACCOUNT_ID="${ACCOUNT_ID:-171180524226}"; BUCKET="${BUCKET:-vura-driver-docs-${ACCOUNT_ID}}"
DOMAIN="${DOMAIN:-api.ridevura.com}"; RDS_ID="${RDS_ID:-vura-prod}"

FAILED=0
pass() { echo "  [ok]   $*"; }
fail() { echo "  [FAIL] $*"; FAILED=$((FAILED + 1)); }
note() { echo "         $*"; }

echo "=== 1/8  identity ==="
ACCT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"
[ "$ACCT" = "$ACCOUNT_ID" ] && pass "account $ACCT ($REGION)" || fail "account '$ACCT', expected $ACCOUNT_ID"

echo "=== 2/8  S3 bucket (driver documents) ==="
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  pass "$BUCKET exists"
  aws s3api get-public-access-block --bucket "$BUCKET" >/dev/null 2>&1 && pass "public access blocked" || fail "public-access-block missing"
  [ "$(aws s3api get-bucket-versioning --bucket "$BUCKET" --query Status --output text 2>/dev/null)" = "Enabled" ] && pass "versioned" || fail "versioning off"
else fail "bucket $BUCKET missing"; fi

echo "=== 3/8  Elastic Beanstalk environment ==="
read -r E_STATUS E_HEALTH E_CNAME < <(aws elasticbeanstalk describe-environments --region "$REGION" \
  --application-name "$APP" --environment-names "$ENVNAME" \
  --query 'Environments[0].[Status,Health,CNAME]' --output text 2>/dev/null)
if [ -z "${E_CNAME:-}" ] || [ "${E_CNAME:-}" = "None" ]; then fail "$ENVNAME not found"; E_CNAME=""
else
  [ "$E_STATUS" = "Ready" ] && pass "Status=Ready" || fail "Status=$E_STATUS"
  [ "$E_HEALTH" = "Green" ] && pass "Health=Green" || fail "Health=$E_HEALTH — eb health $ENVNAME --region $REGION"
  pass "CNAME $E_CNAME"
fi

echo "=== 4/8  network: 5432 from the EB instance SG → RDS ==="
RDS_SG="$(aws ec2 describe-security-groups --region "$REGION" --filters Name=group-name,Values=vura-rds-sg --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)"
INST_SGS="$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:elasticbeanstalk:environment-name,Values=$ENVNAME" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].SecurityGroups[].GroupId' --output text 2>/dev/null | tr '\t' '\n' | grep . | sort -u)"
EB_SG="$(printf '%s\n' "$INST_SGS" | head -1)"
[ -n "${EB_SG:-}" ] && pass "EB instance SG(s): $(printf '%s' "$INST_SGS" | tr '\n' ' ')" \
  || fail "no running instance found for $ENVNAME"
RULES="$(aws ec2 describe-security-groups --region "$REGION" --group-ids "${RDS_SG:-x}" \
  --query 'SecurityGroups[0].IpPermissions[].[IpProtocol,FromPort,ToPort,UserIdGroupPairs[].GroupId]' --output text 2>/dev/null)"
# Note: --output text prints a row's source-SG list on the FOLLOWING line (e.g.
# "tcp 5432 5432" then "sg-xxxx"), so a single-line grep can never see both fields.
# Walk the rows: a protocol/port header is followed by its sources until the next header.
if printf '%s\n' "$RULES" | awk -v sg="${EB_SG:-none}" '
      /^(tcp|udp|icmp|icmpv6)[[:space:]]/ || /^-1[[:space:]]/ { hit = ($1 == "tcp" && $2 == "5432") || $1 == "-1"; next }
      hit && index($0, sg) > 0 { found = 1 }
      END { exit found ? 0 : 1 }'; then
  pass "$RDS_SG accepts 5432 from $EB_SG"
else
  fail "$RDS_SG does not accept 5432 from $EB_SG"
  note "RDS inbound rules (protocol / from / to / source SG):"
  printf '%s\n' "$RULES" | sed 's/^/         /'
fi
RDS_PUB="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].PubliclyAccessible' --output text 2>/dev/null)"
[ "$RDS_PUB" = "False" ] && pass "$RDS_ID is private" || fail "$RDS_ID PubliclyAccessible=$RDS_PUB"
PENDING="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$RDS_ID" --query 'length(keys(DBInstances[0].PendingModifiedValues))' --output text 2>/dev/null)"
[ "${PENDING:-1}" = "0" ] && pass "no pending RDS modifications" \
  || fail "RDS still has pending modifications (re-run the CLI password reset)"

echo "=== 5/8  instance role (document uploads) ==="
aws iam get-role-policy --role-name aws-elasticbeanstalk-ec2-role --policy-name vura-docs-s3 >/dev/null 2>&1 \
  && pass "vura-docs-s3 attached to the EB instance role" || fail "vura-docs-s3 policy missing"

echo "=== 6/8  environment properties (values masked) ==="
PROPS="$(aws elasticbeanstalk describe-configuration-settings --region "$REGION" --application-name "$APP" --environment-name "$ENVNAME" \
  --query 'ConfigurationSettings[0].OptionSettings[?Namespace==`aws:elasticbeanstalk:application:environment`].[OptionName,Value]' --output text 2>/dev/null)"
REQUIRED="NODE_ENV PORT DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_SSL FIREBASE_PROJECT_ID FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY_B64 AWS_S3_BUCKET AWS_S3_REGION PUBLIC_BASE_URL ALLOWED_ORIGINS PAYMENTS_MODE PAYSTACK_SECRET_LIVE PAYSTACK_PUBLIC_LIVE PAYSTACK_CALLBACK_URL RESEND_API_KEY RESEND_FROM_EMAIL ADMIN_EMAILS HERE_API_KEY DEV_LOG_WRITE_KEY DEV_LOG_READ_KEY"
SECRETS=" DB_PASSWORD FIREBASE_PRIVATE_KEY_B64 PAYSTACK_SECRET_LIVE PAYSTACK_PUBLIC_LIVE RESEND_API_KEY HERE_API_KEY DEV_LOG_WRITE_KEY DEV_LOG_READ_KEY "
for k in $REQUIRED; do
  v="$(printf '%s\n' "$PROPS" | awk -F'\t' -v k="$k" '$1==k {print $2; exit}')"
  case "$SECRETS" in *" $k "*) hide=1 ;; *) hide=0 ;; esac
  if [ -z "$v" ]; then fail "$k missing or empty"
  elif [ "$hide" = "1" ] || [ "${#v}" -gt 26 ]; then pass "$k set (${#v} chars)"
  else pass "$k = $v"; fi
done
note "expected: FIREBASE_PRIVATE_KEY_B64 2272 · PAYSTACK_* 48 · RESEND_API_KEY 36 · DEV_LOG_* 32"

echo "=== 7/8  live endpoints (origin HTTP-only; Cloudflare adds TLS) ==="
if [ -n "$E_CNAME" ]; then
  CODE="$(curl -sS -m 25 -o /tmp/vura_health.json -w '%{http_code}' "http://$E_CNAME/health" 2>/dev/null)"
  if [ "$CODE" = "200" ]; then pass "http://$E_CNAME/health → 200"; note "$(head -c 200 /tmp/vura_health.json)"
  else fail "http://$E_CNAME/health → $CODE (booting? eb health $ENVNAME --region $REGION)"; fi
  CODE2="$(curl -sS -m 25 -o /dev/null -w '%{http_code}' "http://$E_CNAME/api/rides/available" 2>/dev/null)"
  [ "$CODE2" = "401" ] && pass "/api/rides/available → 401 (auth gate working)" || fail "/api/rides/available → $CODE2 (want 401)"
  if command -v eb >/dev/null 2>&1; then
    note "app boot log:"
    eb logs "$ENVNAME" --region "$REGION" 2>&1 \
      | grep -iE "PostgreSQL|EADDRINUSE|Cannot find module" | tail -6 | sed 's/^/         /'
    note "(pre-boot 'Cannot find module' lines are the deploy restart race; the last PostgreSQL line is the live state)"
  fi
fi

echo "=== 8/8  DNS / TLS cutover for $DOMAIN ==="
RESOLVED="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)"
[ -z "$RESOLVED" ] && RESOLVED="$(dig +short "$DOMAIN" 2>/dev/null | head -1)"
note "$DOMAIN resolves to ${RESOLVED:-<unresolved>} (Cloudflare anycast — the origin is invisible to DNS)"
CODE3="$(curl -sS -m 25 -o /dev/null -w '%{http_code}' "https://$DOMAIN/health" 2>/dev/null)"
if [ "$CODE3" = "200" ]; then pass "https://$DOMAIN/health → 200"
else fail "https://$DOMAIN/health → ${CODE3:-000}"; fi
# A 200 does NOT prove THIS environment serves the domain — the old backend answers
# 200 too. Send a unique request through the public domain and look for it in this
# environment's own access log. That is the only content-independent proof.
if command -v eb >/dev/null 2>&1 && [ -n "$E_CNAME" ]; then
  TAG="probe$(date +%s)"
  curl -sS -m 25 -o /dev/null "https://$DOMAIN/health?$TAG" 2>/dev/null
  sleep 3
  if eb logs "$ENVNAME" --region "$REGION" 2>&1 | grep -q "$TAG"; then
    pass "$DOMAIN serves THIS environment (probe $TAG found in its access log)"
  else
    note "$DOMAIN does NOT reach this environment yet — probe $TAG is absent from its log"
    note "→ set Cloudflare's 'api' CNAME to: $E_CNAME"
  fi
  note "final stops proof (from the repo, needs this backend): pwsh figma-ui/_verify_stops.ps1"
fi

echo
[ "$FAILED" -eq 0 ] && echo "✅ ALL CHECKS PASSED — the new account is serving." \
  || echo "❌ $FAILED check(s) failed — fix before pointing $DOMAIN here."
