#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Deploy the app to the Cape Town EB env + upload Firebase key
# ─────────────────────────────────────────────────────────────────────────────
# Run from the vura-rider repo clone (CloudShell or your dev box with eb CLI).
# Deploys the CURRENT committed code — so first: commit + push any local code.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ENV_NAME="${ENV_NAME:-vura-rider-prod-cape}"
REGION="${REGION:-af-south-1}"

echo "=== 4/6 DEPLOY APP TO CAPE TOWN ==="
echo "Make sure this repo is up to date:"
git status --short
read -rp "Commit message for deploy (blank = deploy as-is): " MSG
if [ -n "$MSG" ]; then
  git add -A
  git commit -m "$MSG"
  git push origin main
fi

echo
echo "Deploying to $ENV_NAME ($REGION) ..."
eb deploy "$ENV_NAME" --region "$REGION"

echo
echo "Fetching the new environment's public hostname + IP..."
eb status "$ENV_NAME" --region "$REGION" --verbose | grep -Ei "https|CNAME|IP|Url" || true
eb open --env "$ENV_NAME" --region "$REGION" || true
echo
echo "New EB hostname looks like: ${ENV_NAME}.eba-XXXXXXXX.<region>.elasticbeanstalk.com"
echo "You need this for the DNS switch (STEP 5)."

echo
echo "Upload Firebase service-account JSON to the new instance..."
echo "  scp -i <key> vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json ec2-user@<INSTANCE_IP>:/tmp/"
echo "  ssh  -i <key> ec2-user@<INSTANCE_IP> 'sudo mkdir -p /opt/vura-rider && sudo mv /tmp/vura-...json /opt/vura-rider/service-account.json'"
echo
echo "Sanity curl after a minute:"
echo "  curl https://<env>.eba-<id>.af-south-1.elasticbeanstalk.com/health"
echo "  → {\"status\":\"ok\",...}"