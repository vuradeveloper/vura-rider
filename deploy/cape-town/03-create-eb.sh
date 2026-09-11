#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Recreate the Elastic Beanstalk app in Cape Town (af-south-1)
# ─────────────────────────────────────────────────────────────────────────────
# Run inside a clone of the vura-rider repo on the machine that has the EB CLI
# and AWS creds (AWS CloudShell is easiest). This creates a brand-new app +
# environment so api.ridevura.com can be pointed at it later.
# ⚠️ The script auto-cds to the REPO ROOT (where Procfile + .ebextensions live)
#    because that's what EB deploys. Run it from anywhere inside the clone.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# Jump to the repo root (contains Procfile + .ebextensions) — EB needs this.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ]; then echo "❌ Not inside a git clone. Run this from the vura-rider repo."; exit 1; fi
cd "$ROOT"
echo "EB project root: $ROOT"

NEW_REGION="${NEW_REGION:-af-south-1}"
APP_NAME="${APP_NAME:-vura-rider}"
ENV_NAME="${ENV_NAME:-vura-rider-prod-cape}"
PLATFORM="${PLATFORM:-node.js-22}"

echo "=== 3/6 CREATE EB APP + ENV in $NEW_REGION ==="
echo "Attaching EB CLI to this repo for region $NEW_REGION..."
# NOTE: no --force (not supported by eb init); non-interactive when all args are given.
eb init "$APP_NAME" --platform "$PLATFORM" --region "$NEW_REGION" </dev/tty || eb init --platform "$PLATFORM" --region "$NEW_REGION" </dev/tty || {
  echo "❌ eb init failed. Install EB CLI:  pip install awsebcli"
  exit 1
}

echo
echo "Creating the environment (single instance; no load balancer)..."
eb create "$ENV_NAME" --region "$NEW_REGION" --single --platform "$PLATFORM" \
  || { echo "⚠️ Environment may already exist — continuing to set env vars."; }

echo
echo "Pointing the new env at the Cape Town RDS..."
read -rp "New af-south-1 RDS hostname: " NEW_DB_HOST
read -rsp "New DB password: " NEW_DB_PASSWORD; echo

# ── Copy every environment variable from the OLD env / production.env ──
echo "Setting env vars (copy values from deploy/production.env + old EB env)..."
eb setenv NODE_ENV=production PORT=3000 \
  DB_HOST="$NEW_DB_HOST" DB_PORT=5432 DB_NAME=vura DB_USER=vura_admin \
  DB_PASSWORD="$NEW_DB_PASSWORD" DB_SSL=true \
  FIREBASE_PROJECT_ID=vura-f667d \
  GOOGLE_APPLICATION_CREDENTIALS=/opt/vura-rider/service-account.json \
  ALLOWED_ORIGINS="http://localhost:19006,http://localhost:8081,https://ridevura.com,https://api.ridevura.com" \
  RATE_LIMIT_WINDOW_MS=900000 RATE_LIMIT_MAX_REQUESTS=6000 LOG_LEVEL=info \
  PAYMENTS_MODE=live \
  PAYSTACK_SECRET_LIVE=PASTE_PAYSTACK_SECRET_LIVE \
  PAYSTACK_PUBLIC_LIVE=PASTE_PAYSTACK_PUBLIC_LIVE \
  PAYSTACK_CALLBACK_URL=https://api.ridevura.com/api/payments/return \
  RESEND_API_KEY=PASTE_RESEND_API_KEY \
  RESEND_FROM_EMAIL=onboarding@ridevura.com \
  PUBLIC_BASE_URL=https://api.ridevura.com

echo
echo "⚠️  IMPORTANT:"
echo "   • Replace PASTE_* above with the REAL values from deploy/production.env"
echo "     (or the old EB env → Configuration → Environment properties)."
echo "   • GOOGLE_APPLICATION_CREDENTIALS points at a file — put the Firebase"
echo "     service-account JSON on the new instance at /opt/vura-rider/service-account.json"
echo "     (see deploy/cape-town/04-deploy.sh for the upload steps)."
echo
echo "NEXT: bash deploy/cape-town/04-deploy.sh  (deploy code + upload Firebase key)"