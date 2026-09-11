# 🛠️ Vura → Cape Town — EXACT CLICK-BY-CLICK STEPS

Follow these ONE BY ONE, in order. Watch the ⚠️ lines — 2 steps are manual
(AWS console + DNS provider) and the scripts CANNOT do them for you.

## STEP 0 — WHAT YOU NEED (have these ready)
1. AWS login (same account: makhavurr / developerdev3839@gmail.com)
2. Your DNS login (wherever api.ridevura.com records live — find with:
      `nslookup api.ridevura.com`)
3. The Firebase service-account file on your PC:
      `C:\Users\mbofh\Downloads\vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json`
4. Your Windows computer with the repo open (for reference).

## STEP 1 — (MANUAL) CREATE THE CAPE TOWN DATABASE IN AWS CONSOLE  [~10 min]
1. Open browser → https://aws.amazon.com/console → Sign in.
2. TOP-RIGHT corner: click the REGION dropdown (says "US East (Virginia)
   [us-east-1]"). Choose:
       `South Africa (Cape Town) [ af-south-1 ]`
   ⚠️ THAT dropdown is what decides WHERE the database gets created.
3. In the search bar type: `RDS` → click "RDS".
4. Click the ORANGE "Create database" button.
5. Choose:
   - Database creation method : Standard create
   - Engine options           : PostgreSQL
   - Version                  : PostgreSQL 16.x
   - Template                 : Production
   - Settings → DB instance identifier : vura-cape
   - Settings → Master username        : vura_admin
   - Settings → Master password        : (type + confirm a strong password — SAVE IT)
   - DB instance class                 : db.t3.medium
   - Storage type                     : General purpose (SSD)  [leave default]
6. Scroll to "Additional configuration" → Initial database name: `vura`
   ⚠️ MUST be exactly `vura`.
7. Click the ORANGE "Create database" (bottom right).
## STEP 2 — OPEN AWS CLOUDSHELL (the terminal that runs the scripts)
1. In the same AWS console, click the "CloudShell" icon (a `>_` box in the top menu bar).
2. CloudShell opens at the BOTTOM. Click "Start" if it asks.
3. Install the EB CLI once:
   ```
   pip3 install --user awsebcli
   ```
4. Upload the Firebase JSON to CloudShell: click the gear/upload icon → "Upload file" → choose
   `C:\Users\mbofh\Downloads\vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json`
5. Clone the repo in CloudShell:
   ```
   cd ~
   git clone https://github.com/vuradeveloper/vura-rider.git
   cd vura-rider
   git pull origin main
   ```

## STEP 3 — COPY THE DATABASE (Virginia → Cape Town)  [the big one]
⚠️ RDS databases are private. The dump must run where the OLD db is reachable and the restore where the NEW db is reachable.
```
cd ~/vura-rider/deploy/cape-town
cat README.md          # read the runbook (optional but useful)
```
3A) RECORD the new DB values (this script does NOT create anything — you did that in STEP 1). Run it and paste the new hostname + password:
```
bash 01-create-rds.sh
```
- It asks "New af-south-1 RDS hostname" → paste from STEP 1.9
- It asks "New DB password" → paste what you set in STEP 1.5
- It does NOT connect or change anything — it just confirms the values.

3B) DUMP + RESTORE:
```
bash 02-backup-and-restore-db.sh
```
- If BOTH RDS endpoints are reachable from CloudShell it dumps & restores in place.
- If the OLD RDS is private (likely), do the dump on the OLD EB instance:
  ```
  cd ~/vura-rider
  eb ssh vura-rider-prod --region us-east-1
  # inside the instance:
  pg_dump --no-owner --no-acl --format=custom \
    -h vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com -U vura_admin -d vura \
    -f /tmp/vura-full.dump
  ```
  then copy the dump back and restore on a box that can reach the NEW RDS:
  ```
  PGPASSWORD='<newpwd>' pg_restore --no-owner --no-acl \
    -h <NEW_DB_HOST> -U vura_admin -d vura vura-full.dump
## STEP 4 — CREATE THE CAPE TOWN APP SERVER (ELASTIC BEANSTALK)
```
cd ~/vura-rider
bash deploy/cape-town/03-create-eb.sh
```
1. It auto-cds to the repo root and runs:
   - `eb init --platform node.js-22 vura-rider --region af-south-1 --force`
   - `eb create vura-rider-prod-cape --region af-south-1 --single`
2. When it asks for the "New af-south-1 RDS hostname" → paste from STEP 1.9
3. When it asks for the "New DB password" → paste what you set in STEP 1.5
4. ⚠️ The script's `setenv` uses placeholders like `PASTE_PAYSTACK_SECRET_LIVE`.
   AFTER the script finishes, run this once, pasting your REAL secrets (from
   `deploy/production.env` on your PC, or old EB env → Configuration →
   Environment properties):
   ```
   eb setenv PAYSTACK_SECRET_LIVE=<your-live-key> \
           PAYSTACK_PUBLIC_LIVE=<your-pk-key> \
           RESEND_API_KEY=<your-resend-key> \
           RESEND_FROM_EMAIL=onboarding@ridevura.com
   ```
5. Write down the NEW hostname the script prints, e.g.:
   `vura-rider-prod-cape.eba-ABCXYZ.af-south-1.elasticbeanstalk.com`

## STEP 5 — DEPLOY + UPLOAD FIREBASE KEY
```
cd ~/vura-rider
bash deploy/cape-town/04-deploy.sh
```
1. It runs `eb deploy vura-rider-prod-cape --region af-south-1` — WAIT for it to finish (~5 min).
2. Check health:
   ```
   curl https://vura-rider-prod-cape.eba-ABCXYZ.af-south-1.elasticbeanstalk.com/health
   ```
   → must return `{"status":"ok",...}`. If it times out, wait 3 min and repeat.
3. Find the new instance IP: `eb status vura-rider-prod-cape --region af-south-1`
4. Upload the Firebase JSON (from STEP 2.4) and place it on the server:
   ```
   scp -i ~/.ssh/<your-key> ~/vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json ec2-user@<NEW_IP>:/tmp/
   ssh -i ~/.ssh/<your-key> ec2-user@<NEW_IP> 'sudo mkdir -p /opt/vura-rider && sudo mv /tmp/vura-*.json /opt/vura-rider/service-account.json'
   ```
   (No key handy? Use `eb ssh vura-rider-prod-cape --region af-south-1`, then
   paste the JSON into /tmp and run the same `sudo mv` command.)
## STEP 6 — (MANUAL) SWITCH DNS — THE MOMENT EVERYTHING MOVES TO CAPE TOWN
1. Test the new server first (replace with YOUR hostname from STEP 4.5):
   ```
   curl https://vura-rider-prod-cape.eba-ABCXYZ.af-south-1.elasticbeanstalk.com/health
   ```
2. Open your DNS provider's dashboard (the one that hosts api.ridevura.com).
   - Not sure where? Run `nslookup api.ridevura.com` and see which provider
     manages the domain, or check where you bought ridevura.com.
3. Find the DNS record for: `api`
   - Currently a CNAME to `vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com`
4. CHANGE the CNAME target to your NEW hostname:
   ```
   vura-rider-prod-cape.eba-ABCXYZ.af-south-1.elasticbeanstalk.com
   ```
5. Click SAVE. WAIT 5–15 min for DNS to spread.
6. On your phone: book a ride, accept it, drive, complete — confirm the app
   works end-to-end (it now talks to the Cape Town server).

## STEP 7 — CLEANUP (ONLY after 7 days, once you're SURE it's stable)
1. AWS region dropdown → back to "US East (Virginia) [us-east-1]" → RDS →
   select the OLD database `vura` → Actions → Delete.
2. AWS → Elastic Beanstalk → select the OLD env `vura-rider-prod` → Actions →
   Terminate environment.
3. (Optional) Keep the OLD S3 backups
   `s3://elasticbeanstalk-us-east-1-456097556241/backups/` as a cold copy.
## 🚦 TROUBLESHOOT
| Symptom | Fix |
|---|---|
| `eb: command not found` | `pip3 install --user awsebcli` |
| `pg_dump: command not found` | Install Postgres client, or run the dump ON the old EB instance (it has it) |
| Health returns refused/timeout | Wait 5 min, then re-run `eb deploy` |
| Firebase "not initialized" | The service-account file isn't at `/opt/vura-rider/service-account.json` — redo step 5 |
| Payments fail after cutover | `PAYSTACK_SECRET_LIVE` env is wrong/placeholder — re-run the `eb setenv` from Step 4.4 |
| Everything fails → ROLLBACK | Flip the DNS CNAME back to `vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com` — the old server is untouched for 7 days |
5. Restart the app once: `eb deploy vura-rider-prod-cape --region af-south-1`
  ```
- Verify the row counts printed at the end (users / rides / drivers).
8. Wait 5–10 min until Status = "Available".
9. Click your DB name → copy the "Endpoint" hostname — looks like:
   `vura-cape.XXXXXXXXXXXX.af-south-1.rds.amazonaws.com`  ⚠️ SAVE THIS