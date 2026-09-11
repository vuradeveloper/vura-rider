#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Point api.ridevura.com at the Cape Town server (THE CUTOVER)
# ─────────────────────────────────────────────────────────────────────────────
# WRITE THE DNS CHANGE SLOWLY. The app stores the DB host in env, and the app
# code is already deployed to the new EB env — so the ONLY thing users touch is
# this domain. Do it when ride volume is lowest (e.g. 03:00 SAST) and keep the
# old env running for 7 days as a rollback target.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

echo "=== 5/6 SWITCH DNS api.ridevura.com → CAPE TOWN ==="
echo
echo "Where is the DNS hosted? Check first:"
echo "  nslookup api.ridevura.com"
echo "  (currently it's a CNAME to vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com)"
echo
echo "New value (CNAME record):"
read -rp "New EB hostname (e.g. vura-rider-prod-cape.eba-XXXXX.af-south-1.elasticbeanstalk.com): " NEW_HOST
echo "  api.ridevura.com  CNAME  $NEW_HOST"
echo
echo "Recommended cutover checklist:"
echo "  1) Verify new health endpoint responds:  https://$NEW_HOST/health → ok"
echo "  2) Verify new socket works:  https://$NEW_HOST/socket.io/  (websocket upgrade)"
echo "  3) Lower DNS TTL to 60s a few hours BEFORE the switch."
echo "  4) Update the CNAME, wait 5–15 min for propagation."
echo "  5) On the phone: create a real ride, accept, drive — confirm full flow."
echo "  6) Update PAYSTACK_CALLBACK_URL env only if the public hostname changed"
echo "     (it stays https://api.ridevura.com/api/payments/return — so NO change)."
echo
echo "Rollback (if anything breaks): flip the CNAME back to the OLD value:"
echo "  api.ridevura.com  CNAME  vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com"
echo "Old env still has the old DB — data written during the window on the NEW DB"
echo "would not be on the old one; re-run step 2 (backup/restore) to resync."