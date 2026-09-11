#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Point api.ridevura.com at the Cape Town server (THE CUTOVER)
# ─────────────────────────────────────────────────────────────────────────────
# ⚠️⚠️ THIS SCRIPT DOES NOT CHANGE DNS. ⚠️⚠️
# It ONLY prints the exact value + checklist. Changing the DNS record must be
# done BY HAND at your domain provider (Cloudflare / registrar / Route 53):
#
#   1. Find where api.ridevura.com 's DNS is managed
#      (nslookup api.ridevura.com → check the CNAME target)
#   2. Open the DNS provider → DNS records → edit the CNAME for
#      api  →  <NEW_CAPE_TOWN_EB_HOST>
#   3. Save → wait 5–15 min for propagation
#
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

echo "=== 5/6 SWITCH DNS api.ridevura.com → CAPE TOWN (manual step) ==="
echo "This script does NOT change any DNS record — do it by hand at your DNS."
echo
echo "Current value:"
echo "  nslookup api.ridevura.com"
echo "  (currently a CNAME to vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com)"
echo
read -rp "New EB hostname (e.g. vura-rider-prod-cape.eba-XXXXX.af-south-1.elasticbeanstalk.com): " NEW_HOST
echo
echo "New value (CNAME record to paste at your DNS provider):"
echo "  api.ridevura.com  CNAME  $NEW_HOST"
echo
echo "Cutover checklist (do in this order):"
echo "  1) Verify new health endpoint:  https://$NEW_HOST/health  returns  status:ok"
echo "  2) Verify socket:  https://$NEW_HOST/socket.io/"
echo "  3) Lower DNS TTL to 60s a few hours BEFORE the switch"
echo "  4) Edit the CNAME at your DNS provider (MANUALLY)"
echo "  5) Wait 5–15 min propagation; test a real ride + push on the phone"
echo "  6) PAYSTACK_CALLBACK_URL stays https://api.ridevura.com/api/payments/return — no change"
echo
echo "Rollback = flip the CNAME back to:"
echo "  vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com"
echo "(Old env stays running 7 days. If you roll back late, rerun step 2 to resync DB.)"
