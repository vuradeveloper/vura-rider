#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Deploy the app to the Cape Town EB env + upload Firebase key
# ─────────────────────────────────────────────────────────────────────────────
# Run from the vura-rider repo clone (CloudShell or your dev box with eb CLI).
# Deploys the CURRENT committed code — so first: commit + push any local code.
# ⚠️ Auto-cds to the REPO ROOT (EB deploys the root).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ]; then echo "❌ Not inside a git clone."; exit 1; fi
cd "$ROOT"

ENV_NAME="${ENV_NAME:-vura-rider-prod-cape}"
REGION="${REGION:-af-south-1}"

echo "=== 4/6 DEPLOY APP TO CAPE TOWN ==="
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
echo "Waiting for the new instance to boot, then checking health..."
sleep 45
curl -sk "https://$ENV_NAME.eba-XXXXXXXX.af-south-1.elasticbeanstalk.com" -o /dev/null -w 'Try this host in the browser: https://%{url_effective}\n' 2>/dev/null || true

echo
echo "Fetching the new environment's public hostname + IP..."
eb status "$ENV_NAME" --region "$REGION" --verbose | grep -Ei "CNAME|Url|https" || true
echo
echo "⚠️  Note the exact EB hostname from the lines above — you need it for"
echo "    STEP 5 (DNS switch). It looks like:"
echo "      ${ENV_NAME}.eba-XXXXXXXX.af-south-1.elasticbeanstalk.com"
echo
echo "Uploading Firebase service-account JSON to the new instance..."
echo "  (Finds your EC2 SSH key in ~/.ssh; adjust per your setup)"
echo
SSH_USER="${SSH_USER:-ec2-user}"
KEY="${SSH_KEY:-}"
INSTANCE_IP="${INSTANCE_IP:-}"
if [ -n "$INSTANCE_IP" ]; then
  scp -i "$KEY" "C:/Users/mbofh/Downloads/vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json" "$SSH_USER@$INSTANCE_IP:/tmp/"
  ssh -i "$KEY" "$SSH_USER@$INSTANCE_IP" 'sudo mkdir -p /opt/vura-rider && sudo mv /tmp/vura-*.json /opt/vura-rider/service-account.json && sudo chown root /opt/vura-rider/service-account.json'
  echo "  ✅ Firebase key uploaded."
else
  echo "  INSTANCE_IP not set — do it manually:"
  echo "  scp -i <key> 'C:/Users/mbofh/Downloads/vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json' $SSH_USER@<NEW_INSTANCE_IP>:/tmp/"
  echo "  ssh -i <key> $SSH_USER@<NEW_INSTANCE_IP> 'sudo mkdir -p /opt/vura-rider && sudo mv /tmp/vura-*.json /opt/vura-rider/service-account.json'"
fi
echo
echo "After upload + 1 minute, verify:"
echo "  curl https://<env>.eba-<id>.af-south-1.elasticbeanstalk.com/health"
echo "  → {\"status\":\"ok\",...}"