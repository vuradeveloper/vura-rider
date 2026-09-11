# Vura → Cape Town (af-south-1) Migration

Everything currently lives in **AWS us-east-1 (Virginia)**. The goal is to move it
all to **AWS af-south-1 (Cape Town)** to cut the ~13,000 km DB round-trip that's
costing ~2s per new connection today.

This folder contains the copy-and-paste runbook. Each numbered script contains the
commands — **run them from AWS CloudShell** (browser), the same place you run
`eb deploy` today. The AWS CLI (`aws`) and EB CLI (`eb`) are **not installed on this
Windows machine**, so all of this happens in CloudShell.

---

## 🔎 What's on the Virginia server (the full inventory to move)

| # | Asset | Location today (us-east-1) | Move target (af-south-1) |
|---|---|---|---|
| 1 | **PostgreSQL database** `vura` | RDS `vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com` | New RDS instance in af-south-1 |
| 2 | **Node.js app** (Express + Socket.IO) | EB app `vura-rider`, env `vura-rider-prod` (host `vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com`) | New EB app+env in af-south-1 |
| 3 | **Env vars / secrets** | EB env → Configuration → Environment properties (and `deploy/production.env`) | Same values on the new EB env |
| 4 | **Firebase service-account JSON** | `/opt/vura-rider/service-account.json` on the instance | Same path on the new instance |
| 5 | **DNS** | `api.ridevura.com` → CNAME → old EB host | Repoint CNAME → new EB host |
| 6 | **S3 backups** | `s3://elasticbeanstalk-us-east-1-456097556241/backups/*.dump` | (optional) new bucket in af-south-1 |

**External services that DON'T move** (region-independent): Firebase Auth,
Paystack (live keys), Resend email, Expo/EAS builds + OTA + push, OSRM/Nominatim
public routing/geocoding, OpenStreetMap tiles.

**Nothing else lives on the instance**: no uploaded files (profile photos are URLs
in the DB), no local map data, no job queues.

---

## ✅ The database schema being copied (all 31 tables)

`users`, `rides`, `driver_profiles`, `driver_earnings`, `driver_earnings_paid`,
`payments`, `saved_cards`, `payouts`, `driver_banking`, `ratings`, `chat_messages`,
`safety_events`, `emergency_contacts`, `push_tokens`, `push_sends`, `disputes`,
`lost_item_reports`, `affiliates`, `referrals`, `affiliate_transactions`,
`affiliate_payouts`, `pay_later_accounts`, `payment_collections`,
`pay_later_blacklist`, `split_fares`, `recent_searches`, `community_places`,
`osm_sync_state`, `route_cache`, `fare_config`.

---

## ▶️ Execution order

| Step | Script | What it does |
|---|---|---|
| 1 | `01-create-rds.sh` | Create Postgres RDS in af-south-1 |
| 2 | `02-backup-and-restore-db.sh` | `pg_dump` Virginia → upload S3 → `pg_restore` into Cape Town + row-count sanity check |
| 3 | `03-create-eb.sh` | `eb init`/`eb create` new env in af-south-1 + set all env vars |
| 4 | `04-deploy.sh` | `eb deploy` + upload Firebase service-account JSON |
| 5 | `05-switch-dns.sh` | Cutover `api.ridevura.com` → new host (with rollback steps) |
| 6 | *(manual)* | App-level verification: `/health`, socket, one real ride, push notification |

---

## ⚠️ Key gotchas

1. **Run DB dump/restore from a box inside a VPC** — both RDS endpoints are usually
   private. The dump side must reach the **Virginia RDS**; the restore side must
   reach the **Cape Town RDS**. The fastest path: run dump on the OLD EB instance
   (it can already see the old RDS), upload to S3, then restore from an EC2
   bastion / the NEW EB instance in af-south-1.
2. **DB_NAME is `vura`** (production.env + rds-backup.sh). Ignore the `vura2`
   value in `.env.example` — that's legacy.
3. **EB platform is `node.js-22`** (the install scripts use Node 22). Match the
   current env's platform with `eb platform show` before creating the new one.
4. **`server/dist` is committed** — so `eb deploy` from the repo root deploys the
   compiled server with no extra build step (`.ebextensions/server-deploy.config`
   runs `npm ci` for server deps only).
5. **Paystack callback stays** `https://api.ridevura.com/api/payments/return` — it
   follows the domain, so no change after DNS cutover.
6. **Push tokens (`push_tokens`) survive the DB copy**, but Android apps may
   re-register their Expo tokens on the next login — harmless.

---

## ⏱️ Expected downtime

Cutover itself is **1–2 seconds for users** (DNS only). The DB copy is the long
part — a few minutes to ~an hour depending on data size, and it can happen
**while the old site stays live**. Only the final DNS flip is seen by users.

Keep the old env running for **7 days** as instant rollback (repoint the CNAME
back). Old data written during the window after cutover won't be on the old DB —
re-run Step 2 to resync if you roll back late.