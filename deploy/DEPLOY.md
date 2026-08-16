# Vura Rider backend — Oracle Cloud Free Tier deployment
#
# Step 1 — Create the VM in Oracle Cloud (see below)
# Step 2 — Copy this `deploy` folder + the `server` folder to the VM
# Step 3 — Run install.sh, then place env + service-account, then restart
#
# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Oracle Cloud — create the Always Free ARM VM
# ─────────────────────────────────────────────────────────────────────────────
# 1. Go to https://cloud.oracle.com → sign up (free account, card for identity only)
# 2. Wait for the account to be approved (can take minutes to ~1 hour)
# 3. Console → Compute → Instances → Create instance
#    - Name: vura-backend
#    - Image: Canonical Ubuntu 22.04 (or 24.04)
#    - Shape: select "Ampere A1" (Always Free) — choose 4 OCPUs / 24 GB RAM
#      (leave default boot volume, e.g. 50-100 GB)
#    - SSH keys: paste your public key, or "Generate a key pair" and download it
#    - Create
# 4. After creation, copy the instance's Public IP address
#
# Step 2: Get the code onto the VM
# ─────────────────────────────────────────────────────────────────────────────
# From this project folder, on your PC:
#   scp -i <your-key>.pem -r deploy server ubuntu@<PUBLIC_IP>:~/
#
# Also copy the Firebase service account JSON:
#   scp -i <your-key>.pem C:\Users\mbofh\Downloads\vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json ubuntu@<PUBLIC_IP>:~/service-account.json
#
# Step 3: Install everything
# ─────────────────────────────────────────────────────────────────────────────
# ssh into the VM:
#   ssh -i <your-key>.pem ubuntu@<PUBLIC_IP>
#
#   cd ~
#   sudo bash deploy/install.sh
#
# Step 4: Place config files
#   sudo mkdir -p /opt/vura-rider
#   sudo mv ~/server /opt/vura-rider/server
#   sudo cp deploy/production.env /opt/vura-rider/server/.env
#   sudo mv ~/service-account.json /opt/vura-rider/service-account.json
#   cd /opt/vura-rider/server && sudo npm ci --omit=dev
#   sudo systemctl restart vura-rider
#
# Step 5: Check it works (on the VM, over its IP)
#   curl http://localhost/health      → {"status":"ok",...}
#   curl http://<PUBLIC_IP>/health    → same (via nginx)
#
# Step 6: HTTPS (recommended — the app requires https:// in production)
# Point a domain at <PUBLIC_IP> (DNS A record), then:
#   sudo certbot --nginx -d yourdomain.com
#   sudo certbot renew --dry-run
# Then update deploy/production.env ALLOWED_ORIGINS with https://yourdomain.com.
#
# Step 7: Point the app at the new URL
# Set EXPO_PUBLIC_API_URL to https://yourdomain.com (or https://<PUBLIC_IP> with a
# cert), rebuild the APK via `eas build --platform android --profile preview`.
#
# ─────────────────────────────────────────────────────────────────────────────
# Firewall (Oracle security list): ensure inbound TCP 80 and 443 are allowed
# for the instance's subnet (Compute → Instance → VNIC → Security list).
# ─────────────────────────────────────────────────────────────────────────────
