#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Recreate the Elastic Beanstalk app in Cape Town (af-south-1)
# ─────────────────────────────────────────────────────────────────────────────
# Run inside a clone of the vura-rider repo on the machine that has the EB CLI
# and AWS creds (AWS CloudShell is easiest). This creates a brand-new app +
# environment named so api.ridevura.com can be pointed at it later.
#
# NOTE: The repo is a monorepo — EB deploys the ROOT (it zips the whole dir,
# then .ebextensions/server-deploy.config installs ONLY server/node_modules and
# runs `node dist/index.js` from server/). The root Procfile already does
# `web: cd server && node dist/index.js`. Everything you need to deploy is
# already committed (server/dist is tracked).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

NEW_REGION="${NEW_REGION:-af-south-1}"
APP_NAME="${APP_NAME:-vura-rider}"
ENV_NAME="${ENV_NAME:-vura-rider-prod-cape}"
PLATFORM="${PLATFORM:-node.js-22}"

echo "=== 3/6 CREATE EB APP + ENV in $NEW_REGION ==="
echo "Resetting any old CloudShell EB pointer (so we attach to the new region)..."
eb init --platform "$PLATFORM" "$APP_NAME" --region "$NEW_REGION" --force || {
  echo "❌ eb init failed. Install EB CLI:  pip install awsebcli"
  echo "   then: eb init --platform $PLATFORM $APP_NAME --region $NEW_REGION --force"
  exit 1
}

echo
echo "Creating the environment (single instance; no load balancer needed)..."
eb create "$ENV_NAME" --region "$NEW_REGION" --single --platform "$PLATFORM" --nogit \
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
echo "     (see deploy/cape-town/04-deploy.sh for the upload hook)."
echo
echo "NEXT: ./04-deploy.sh  (deploy code + upload the Firebase service account)"