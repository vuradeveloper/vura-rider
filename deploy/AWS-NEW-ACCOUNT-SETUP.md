# Vura — Fresh AWS Account: Corrected Setup Playbook

Built from what we **actually** did in Sept 2026 (Cape Town migration work, Cloudflare +
Namecheap DNS, the live server) with every trap turned into a rule. Companion docs:
`deploy/cape-town/*` (the original runbook) — this file supersedes it where they differ.

---

## 0. Read this first — you have TWO AWS accounts, and the app is not in the one you can log into

Verified evidence:

| Fact | Where we see it |
|---|---|
| The app's DB backups go to `s3://elasticbeanstalk-us-east-1-456097556241/backups/` | `deploy/rds-backup.sh:31`, `deploy/cape-town/02-backup-and-restore-db.sh:40` |
| An EB-created bucket name always contains the account ID → the account that runs `vura-rider-prod` today is **456097556241** | AWS EB naming: `elasticbeanstalk-<region>-<account-id>` |
| The passkey on your PC/phone is registered to **`arn:aws:iam::054037132330:root`** | Windows Security passkey dialog, 26 Sep 2026 |
| A third identity appears as the "AWS login" | `deploy/cape-town/STEPS.md:7` → username `makhavurr`, email `developerdev3839@gmail.com` |
| A fourth email was used when the passkey was made | `mbofhenijunior7@gmail.com` (passkey label in Microsoft Authenticator) |

**Conclusion:** the passkey opens account **054037132330**. The live app lives in account
**456097556241**. Signing in with the passkey can never reveal `vura-rider-prod` — it is a
different account. This single fact explains the whole "wrong account / wrong email" saga.

**Rules that prevent a repeat**
1. One AWS account per business. Write its **account ID** and **root email** into this repo
   (`deploy/ACCOUNT.md` line 1). Never guess an email at the sign-in screen.
2. Register **at least two MFA devices** on the root user the day the account is created
   (AWS allows 8): one **TOTP** (authenticator app) + one **passkey**. A single
   device-bound passkey is what locked us out.
3. Create an **IAM admin user** (`vura-admin`) for daily work with its own MFA + access keys.
   Root gets used only to create that user and to add MFA devices.
4. Use an **email on your own domain** (e.g. `aws@ridevura.com` via Cloudflare Email
   Routing) as the root email — never a personal Gmail that you can also lose.

---

## 1. What is actually running today (verified live, 26 Sep 2026)

| Layer | What it is | Evidence |
|---|---|---|
| DNS | Cloudflare hosts the zone: NS = `arvind.ns.cloudflare.com`, `arya.ns.cloudflare.com`; SOA primary `arvind.ns.cloudflare.com` | `Resolve-DnsName -Type NS ridevura.com` |
| `api.ridevura.com` | **Proxied** through Cloudflare (A `172.67.217.188`, `104.21.35.107`, AAAA `2606:4700:3036::ac43:d9bc`, `…:6815:236b`) → hidden origin = EB | `Resolve-DnsName api.ridevura.com` |
| `api` response headers | `Server: cloudflare`, `cf-cache-status: DYNAMIC`, `CF-RAY: …-JNB`, `alt-svc: h3`, HSTS + CSP + `X-Frame-Options: SAMEORIGIN` | `curl -I https://api.ridevura.com/health` |
| Web site | `ridevura.com` → **308** → `https://www.ridevura.com/`, served by **Vercel** (`x-vercel-id: cpt1::…`) behind Cloudflare | `curl -I https://ridevura.com` |
| API app | AWS Elastic Beanstalk app `vura-rider`, env `vura-rider-prod`, us-east-1, single instance, Node 22 (AL2023), `Procfile: cd server && node dist/index.js`, health `/health`, deploy timeout 1800s | `Procfile`, `.ebextensions/server-start.config` |
| Database | RDS PostgreSQL `vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com`, db `vura`, user `vura_admin`, SSL required, private (no public access) | `deploy/production.env`, `deploy/cape-town/01-create-rds.sh` |
| Auth | Firebase project **vura-f667d** (sender `678275862018`), shared by rider + driver apps; server verifies with the service-account JSON at `/opt/vura-rider/service-account.json` | `server/src/config/firebase.ts:24`, `lib/firebase.ts`, `vura-driver/lib/firebase.ts` |
| Documents | S3 bucket from `AWS_S3_BUCKET` (**code default region is `af-south-1`** — always set `AWS_S3_REGION`) | `server/src/lib/s3.ts:15,22` |
| Payments | Paystack LIVE, callback `https://api.ridevura.com/api/payments/return` | `deploy/production.env:38` |
| Email | Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL=onboarding@ridevura.com`) | `server/src/routes/email.ts` |

---

## 2. Every mistake we made — and the rule that prevents it

1. **Four identities, two accounts.** `makhavurr` / `developerdev3839@gmail.com`
   (`deploy/cape-town/STEPS.md:7`) vs `mbofhenijunior7@gmail.com` (passkey label) vs
   `makhavhuemjay@gmail.com` (what you kept typing) vs the two account IDs
   `456097556241` (live app) and `054037132330` (passkey). Rule: write the account ID and
   owner email into `deploy/README` the day the account is created.
2. **Secrets inside tracked scripts.** `deploy/cape-town/01-create-rds.sh:38` and
   `02-backup-and-restore-db.sh:21` both default the DB password to a hardcoded value;
   `deploy/production.env` (gitignored — good) holds the LIVE Paystack secret, the DB
   password and the Resend key. Rule: no secret in any tracked file — only a
   `production.env.example` with placeholders; real values live in EB environment
   properties (or SSM Parameter Store under `/vura/prod/*`). Rotate the DB password, the
   Paystack live keys, the Resend key and the Firebase service account as part of the move.
3. **Firebase key as a file on the instance.** `/opt/vura-rider/service-account.json`
   needed `scp` plus an EC2 key pair, and vanished whenever an instance was rebuilt
   (`deploy/cape-town/STEPS.md:119-125`). Rule: use the env-var path the code already
   supports — `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY_B64` + `FIREBASE_PROJECT_ID`
   (`server/src/config/firebase.ts:13-24`). No SSH, no file, survives redeploys.
4. **Deploy timed out on `npm install`.** The bundle is built from git-tracked files
   (`node_modules/` is gitignored, no `.ebignore` exists), so dependencies install on the
   instance; that blew EB's 10-minute command timeout ("instances have not responded in the
   allowed command timeout", Sep 19). Fixed with a predeploy hook plus
   `Timeout: 1800` (`.ebextensions/server-start.config`). Rule: keep 1800 and check
   `/var/log/vura_server_deps.log` whenever the app 502s with
   "Cannot find module 'dotenv/config'".
5. **Two hook systems side by side.** `.ebextensions/server-deploy.config` writes an
   old-style `/opt/elasticbeanstalk/hooks/appdeploy/pre/...` script while
   `.platform/hooks/predeploy/00_server_npm_install.sh` is the AL2023 way. The platform is
   Node 22 on AL2023, so **only `.platform/` runs**. Rule: `.platform/hooks` for scripts,
   `.ebextensions/*.config` for `option_settings` only.
6. **413 on phone-photo uploads.** EB nginx caps bodies at 1 MB by default while the app
   accepts 15 MiB documents. Fixed by `.platform/nginx/conf.d/01_client_max_body_size.conf`
   (40m) + `express.json({ limit: "30mb" })` (`server/src/index.ts:69`) + a 15 MiB app cap
   (`server/src/lib/s3.ts:52`). Rule: all three layers agree — nginx 40m ≥ JSON 30mb ≥
   doc 15 MiB.
7. **429 storms.** The driver app polls `/api/rides/available` every second; a stale
   `RATE_LIMIT_MAX_REQUESTS=100` broke every other API call. The code now floors the limit
   at 3000 and defaults to 6000/15min (`server/src/index.ts:88-96`), with `/api/dev/logs`
   and `/api/route` deliberately outside the strict limiter. Rule: always set
   `RATE_LIMIT_MAX_REQUESTS=6000` and `ROUTE_RATE_LIMIT_MAX=300` on a new environment.
8. **Health-check path.** Anything other than `/health` makes EB mark the environment
   unhealthy and **revert your deploy**. It is set in `.ebextensions/server-start.config`
   and `server/.ebextensions/healthcheck.config` — keep both.
9. **`trust proxy`.** Without `app.set("trust proxy", true)` behind nginx/Cloudflare the
   server generated `http://` share links that timed out (`server/src/index.ts:51`). Keep it.
10. **RDS is private by design.** `pg_dump`/`pg_restore` cannot run from CloudShell; the dump
    must run on a host inside the VPC (the old EB instance) and travel via S3 for the
    restore (`deploy/cape-town/README.md`, gotcha 1). For an account move, prefer **RDS
    snapshot sharing** — see §5.
11. **Region mismatch in code.** `AWS_S3_REGION` defaults to `af-south-1`
    (`server/src/lib/s3.ts:22`) while production ran in `us-east-1` — a silent way to aim at
    the wrong bucket. Rule: set `AWS_S3_BUCKET` **and** `AWS_S3_REGION` explicitly, always.
12. **Client API URLs are hardcoded.** The driver Capacitor app has
    `API_URL = "https://api.ridevura.com"` (`vura-driver/figma-ui/src/lib/backend.ts:13`),
    and the rider app reads `EXPO_PUBLIC_API_URL` from `eas.json` — every profile set to
    `https://api.ridevura.com`. Rule: **never change the `api` subdomain** during a move;
    repoint DNS only, and no APK rebuild is needed.
13. **CORS vs Capacitor.** The Capacitor WebView runs at origin `https://localhost`, which
    `ALLOWED_ORIGINS` did not include — every web fetch failed as "Failed to fetch" until
    the driver app switched to CapacitorHttp (`vura-driver/figma-ui/src/lib/backend.ts:18-33`).
    Rule: on a new environment include
    `https://localhost,capacitor://localhost,http://localhost` plus
    `https://ridevura.com,https://www.ridevura.com,https://api.ridevura.com`.
14. **Stale Firebase config in `eas.json`.** All rider build profiles still set
    `EXPO_PUBLIC_FIREBASE_*` to the OLD project `vura-a272c`, while both apps hardcode
    `vura-f667d` (`lib/firebase.ts:10-15`, `vura-driver/lib/firebase.ts:10-16`). It works
    only because the code ignores those vars — a landmine. Rule: one Firebase project
    everywhere; delete the stale keys; confirm `google-services.json` (`678275862018`),
    both `lib/firebase.ts` files and the server's `FIREBASE_PROJECT_ID` all agree.
15. **Push-notification expectations.** The server only sends Expo pushes
    (`server/src/services/push.ts` accepts only `ExponentPushToken[...]`). A Capacitor APK
    can never mint one, so those builds get delivery only via socket + the 1-second poll
    while open. Rule: don't promise push on Capacitor builds — use FCM there.
16. **Paystack cannot be embedded.** Paystack sends `X-Frame-Options: SAMEORIGIN`, so
    checkout must open in a Custom Tab / WebView while card charges happen server-side with
    `chargeAuthorization`. The callback `https://api.ridevura.com/api/payments/return` is
    domain-based and therefore survives the move — keep the domain and re-check the URL in
    the Paystack dashboard.
17. **Obsolete deploy docs gave us a wrong mental model.** `deploy/DEPLOY.md` and
    `deploy/install.sh` describe an Oracle Cloud VM with systemd; `_deploy_wp.ps1` targeted
    that VM. None of it is the live path (Elastic Beanstalk is). Rule: exactly one deploy
    doc; stamp every other file "LEGACY — do not use" on line 1.
18. **No `.ebignore`.** The EB CLI packages the git-tracked tree, so untracked files
    (`node_modules`, dumps, keys) never reach the instance — which is exactly why the
    predeploy hook must install dependencies. Rule: if it must ship, track it or ship it as
    an S3 source bundle; never assume "it's in my folder, so it's in the deploy".
19. **Housekeeping.** Dozens of `_*.txt` probe files across the repo root and home folder
    made "current truth" hard to find. They are gitignored (harmless to git) but noisy.
    Rule: delete them once a cutover is verified.
20. **Vendor sprawl — four control panels for one product.** Domain registrar =
    **Namecheap**; DNS + proxy + (later) Cloudflare Pages admin backoffice
    (`vura-admin-backoffice.pages.workers.dev` appears in local history); public site =
    **Vercel** (`ridevura.com` 308s to `www.ridevura.com`, `x-vercel-id` present); API + DB +
    documents = **AWS**. Rule: one page in this repo listing every panel, which email/account
    owns it, and where its credentials live. When something breaks at 02:00 you will not
    remember which of the four to open.

---

## 3. The correct setup, in order — new AWS account

Do these **in this order**. Every step exists because skipping it cost us time.

### Step 0 — Decide before you click anything (30 min, no AWS yet)

| Decision | Choose | Why |
|---|---|---|
| Owner email | **`aws@ridevura.com`** (Cloudflare Email Routing → forwards to a mailbox you control, ideally a shared one) | Our current account is tied to personal Gmail addresses we can lose — that is how this whole lock-out started |
| Region | **`af-south-1` (Cape Town)** if your users are in SA; otherwise `us-east-1` | The old DB round-trip from Joburg to Virginia cost ~2 s per new connection (`deploy/cape-town/README.md`) — the single biggest performance issue we had |
| API hostname | **`api.ridevura.com` — forever** | Both apps hardcode/configure it; keeping it means **zero client rebuilds** when the backend moves |
| Billing | A card that won't expire + a **$60/month budget alarm** | EB + RDS can quietly grow |
| Credentials store | One password-manager entry: root email + password, account ID, 2 MFA secrets, IAM user, recovery codes | Every one of these was spread across phones/browsers/memory before |

### Step 1 — Create the account (~15 min)

1. `aws.amazon.com` → **Create an AWS Account** → use the owner email above.
2. Account name: `Vura` (this becomes your **sign-in alias**: `https://vura.signin.aws.amazon.com`
   — bookmark it, it makes IAM-user sign-in trivial).
3. Verify email → verify phone → **Basic support (free)** → add the card.
4. **Copy the 12-digit account ID** (top-right → Account) into the password manager **and**
   into `deploy/ACCOUNT.md`. Do this before anything else — Support asks for it,
   and every ARN contains it.
5. **Billing → Budgets → Monthly cost budget** ($60) with an email alert. Then
   **Billing → Preferences → Billing alerts / CloudWatch alarm** on estimated charges.

### Step 2 — Lock the root user on day one (~20 min) ← *the step that would have saved us*

1. **Add TWO MFA devices to root immediately** (AWS allows 8; we had one, and it locked us out):
   * **TOTP** — Microsoft/Google Authenticator. **Save the secret/QR in the password manager**
     the moment it is shown; a TOTP entry only lives on the phone otherwise.
   * **Passkey** — Windows Hello on the PC (this one is a genuine convenience when it works).
2. Root → **Account → Contact information** → set the **primary contact phone** to a number
   you will *keep for years* and the email to `aws@ridevura.com`. This phone number is
   literally the factor AWS uses for account recovery (`Recovering a root user MFA device`).
   Add **Billing** and **Operations** alternate contacts while you are there.
3. **IAM → Users → Create user `vura-admin`**: console access (password in the password
   manager) + **its own MFA** + access keys for the CLI. Attach `AdministratorAccess`.
   Work as `vura-admin` daily; root is only for MFA/billing/account changes.
4. Turn on **IAM Access Analyzer** and **CloudTrail** (a single trail to a new S3 bucket).
5. Optional but recommended: **Cloudflare Email Routing** so `aws@ridevura.com` exists as a
   real address that forwards to you — see §4.

### Step 3 — Build the resources in this order (avoids rework)

1. **S3 bucket for driver documents** — e.g. `vura-driver-docs-<accountid>` (bucket names are
   globally unique, so the account ID suffix is the pragmatic fix):
   * Block *all* public access; **versioning on**; lifecycle → Glacier after 365 days;
   * Server-side encryption on (SSE-S3 is enough);
   * No CORS rules needed — the server uploads/reads via presigned URLs
     (`server/src/lib/s3.ts`), the browser never talks to S3 directly.
2. **RDS PostgreSQL** (console → RDS → Create database):
   * Engine PostgreSQL 16+, template **Free tier / Dev-Test** unless you need Multi-AZ;
   * Identifier `vura-prod`, master user `vura_admin`, **strong password → password manager**;
   * Initial database name **`vura`** (this exact name is hardcoded all over the app);
   * **Public access: No**; place it in the same region as the app;
   * **Automated backups: 7 days**, plus a manual snapshot before any migration;
   * Security group: allow **5432 only from the Elastic Beanstalk instance security group**;
   * Note the endpoint → it goes into `DB_HOST`.
3. **EC2 key pair** (EC2 → Key pairs → Create) — even if you plan never to SSH. `eb ssh`
   needs it, and without a key you cannot get onto an instance when something is wrong.
4. **Elastic Beanstalk** (run in **CloudShell**, which already has your credentials):
   ```bash
   pip3 install --user awsebcli            # only if `eb` is missing
   git clone https://github.com/vuradeveloper/vura-rider.git ~/vura-rider
   cd ~/vura-rider
   eb init vura-rider --region af-south-1  # pick "Node.js" -> "22" if it asks
   eb create vura-rider-prod --single --instance-type t3.small
   eb setenv $(cat deploy/env.prod.example | grep -v '^#' | tr '\n' ' ')   # see §4
   eb deploy
   ```
   * `--single` = no load balancer (cheapest, fine for this workload);
   * the deploy uses `Procfile: cd server && node dist/index.js`, so **`server/dist` must be
     committed** — it is;
   * first boot installs dependencies via `.platform/hooks/predeploy`
     (hence `Timeout: 1800` in `.ebextensions/server-start.config`).
   * If `eb init --platform` is needed non-interactively, use
     `eb platform list --region af-south-1` and paste the exact `Node.js 22 … AL2023` name.
5. **Verify before DNS**: `curl https://<env-host>/health` → `{"status":"ok",…}` and
   `curl -i https://<env-host>/api/rides/available` → **401** (auth middleware alive).
6. **Then** point DNS (never before the app answers on its own hostname) — §5.

---

## 4. Environment variables — the complete list for the new environment

Set them with `eb setenv VAR=value …` in CloudShell (or EB console → Configuration →
Environment properties). **Never in git.** A tracked template lives at
`deploy/env.prod.example` (placeholders only); the local, gitignored
`deploy/production.env` on this laptop holds the current live values — copy from it, then
**rotate** everything. Verify with `eb printenv`.

### Required — the app will not boot correctly without these

| Variable | Value on the new account | Why / where it is read |
|---|---|---|
| `NODE_ENV` | `production` | Enables SSL + production config (`server/src/config/database.ts:7`) |
| `PORT` | `3000` | EB nginx proxies 80/443 → 3000 (`Procfile`, `deploy/nginx-vura.conf`) |
| `DB_HOST` | new RDS endpoint | |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `vura` | The exact name is assumed in places — do not rename |
| `DB_USER` | `vura_admin` | |
| `DB_PASSWORD` | new strong password | **Rotate** — the old one lives in this repo's history |
| `DB_SSL` | `true` | RDS requires TLS |
| `FIREBASE_PROJECT_ID` | `vura-f667d` | Must equal the project in both apps' `lib/firebase.ts` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-…@vura-f667d.iam.gserviceaccount.com` | From the service-account JSON (env-var path) |
| `FIREBASE_PRIVATE_KEY_B64` | base64 of the JSON's `private_key` | Single-line, cannot be mangled (`server/src/config/firebase.ts:16-23`) |
| `AWS_S3_BUCKET` | `vura-driver-docs-<accountid>` | Document storage (`server/src/lib/s3.ts:15`) |
| `AWS_S3_REGION` | same region as the bucket | **Code default is `af-south-1`** — always set it explicitly |
| `ALLOWED_ORIGINS` | `http://localhost:19006,http://localhost:8081,https://localhost,capacitor://localhost,http://localhost,https://ridevura.com,https://www.ridevura.com,https://api.ridevura.com` | CORS; the Capacitor origins are what the driver WebView needs |
| `PUBLIC_BASE_URL` | `https://api.ridevura.com` | Share links (`server/src/routes/safety.ts:104`) |
| `RATE_LIMIT_WINDOW_MS` | `900000` | |
| `RATE_LIMIT_MAX_REQUESTS` | `6000` | Code floors at 3000; 100 once caused 429 storms |
| `ROUTE_RATE_LIMIT_MAX` | `300` | Separate lenient limiter for `/api/route` |
| `LOG_LEVEL` | `info` | `debug` switches morgan to dev logging |
| `PAYMENTS_MODE` | `live` (use `sandbox` while testing) | `server/src/services/paystackPayment.ts` |
| `PAYSTACK_SECRET_LIVE` | `sk_live_…` — **rotate a new key** | Server-side charges only |
| `PAYSTACK_PUBLIC_LIVE` | `pk_live_…` | Also used by the driver app build |
| `PAYSTACK_CALLBACK_URL` | `https://api.ridevura.com/api/payments/return` | Domain-based → survives the move |
| `RESEND_API_KEY` | `re_…` — rotate | Verification emails |
| `RESEND_FROM_EMAIL` | `onboarding@ridevura.com` | Must be a verified sender/domain in Resend |
| `ADMIN_EMAILS` | your admin emails, comma-separated | `server/src/routes/admin.ts:8` |
| `DEV_LOG_WRITE_KEY` | random string | Device-log endpoint |
| `DEV_LOG_READ_KEY` | random string | Reading device logs (`server/src/routes/devLogs.ts:13-16`) |

### Optional — only if that feature is in use

| Variable | Default when unset | Notes |
|---|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SDK credential chain | **Prefer an instance profile** on the EB EC2 role with `s3:PutObject/GetObject/DeleteObject` on the bucket — then no static keys exist at all |
| `PAYSTACK_SECRET_TEST` | — | For `PAYMENTS_MODE=sandbox` (test card `4084084084084081`) |
| `HERE_API_KEY` | empty → fallback providers | HERE Autosuggest/Geocoding (`server/src/routes/search.ts:257`) |
| `ROUTE_PROVIDER_URL` | `https://router.project-osrm.org` | Point at a self-hosted OSRM once volume grows (`deploy/SELFHOST-MAPS.md`) |
| `NOMINATIM_URL`, `SEARCH_PROVIDER=nominatim` | public Nominatim | Self-hosted geocoding (`deploy/SELFHOST-MAPS.md:44-49`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Legacy file path; **not needed** if you use the three `FIREBASE_*` vars above |

### Generating `FIREBASE_PRIVATE_KEY_B64` (do it once, on this laptop)

```bash
node -e "const k=require('C:/Users/mbofh/Downloads/vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json');console.log(Buffer.from(k.private_key).toString('base64'))"
```

Paste the single-line output into `eb setenv FIREBASE_PRIVATE_KEY_B64=…`. The server decodes
it back to the PEM (`server/src/config/firebase.ts:21-23`), so you never need to copy a file
onto an instance or keep an EC2 key pair just for that.

---

## 5. DNS: Namecheap → Cloudflare → (AWS + Vercel)

### What we actually have today (verified 26 Sep 2026)

* The zone `ridevura.com` is **hosted on Cloudflare**: NS = `arvind.ns.cloudflare.com`,
  `arya.ns.cloudflare.com`, SOA primary `arvind.ns.cloudflare.com`.
* The registrar is **Namecheap** — it holds only the domain and the two nameservers.
* `api.ridevura.com` is **proxied (orange cloud)**: the public answers are Cloudflare IPs
  (`172.67.217.188`, `104.21.35.107`, `2606:4700:3036::ac43:d9bc`,
  `2606:4700:3030::6815:236b`). The real origin
  (`vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com`) is hidden behind the proxy —
  **that CNAME is the only thing that changes when the backend moves.**
* `ridevura.com` answers **308 → `https://www.ridevura.com/`**, served by **Vercel**
  (`x-vercel-id: cpt1::…`) — also behind Cloudflare.
* API responses show `Server: cloudflare`, `cf-cache-status: DYNAMIC`, `CF-RAY: …-JNB`
  (Johannesburg edge), `alt-svc: h3` → proxy on, HTTP/3 on, API responses not cached. Good.
* Local shell history also shows a **Cloudflare Pages** backoffice
  (`vura-admin-backoffice.pages.workers.dev`) — if it is live, give it a name in §5's table so
  the next person knows it exists.

### The record set that must exist in Cloudflare → DNS → Records

| Type | Name | Content | Proxy | Notes |
|---|---|---|---|---|
| CNAME | `api` | `vura-rider-prod.eba-….<region>.elasticbeanstalk.com` | **Proxied** | The single record that moves |
| CNAME | `www` | whatever Vercel's project panel shows (`cname.vercel-dns.com` or project-specific) | Proxied | Public site |
| A / ALIAS | `@` (root) | Vercel's apex target | Proxied | 308s to `www` |
| CNAME | `admin` | `vura-admin-backoffice.pages.dev` (Pages custom domain) | Proxied | Only if used |
| TXT | `@`, `_dmarc`, `resend._domainkey` | Resend verification records (SPF/DKIM) | **DNS only** | Needed for `onboarding@ridevura.com` |
| MX / TXT | for `aws@ridevura.com` | Added automatically by Cloudflare **Email Routing** | DNS only | See step 8 below |

### The order of operations (this is where we bled)

1. **Verify the origin before touching DNS.** `curl https://<new-env-host>/health` must return
   `{"status":"ok",…}` **and** `curl -i https://<new-env-host>/api/rides/available` must return
   `401`. Only then flip the record.
2. **Leave the old backend running for 7 days.** Rollback = flip the CNAME back. Proxied
   Cloudflare records ignore your TTL setting (Cloudflare's own caching applies), so the change
   is effectively instant — but phones and browsers cache DNS, which is why the old side stays up.
3. **SSL/TLS → Overview = Full (strict).** Cloudflare connects to the origin using the CNAME
   target as SNI, and the EB `*.elasticbeanstalk.com` certificate matches that hostname — so
   strict validation succeeds even though the public name is `api.ridevura.com`.
4. **Edge Certificates:** "Always Use HTTPS" on, minimum TLS 1.2, HSTS optional (the app
   already sends HSTS).
5. **Never create a "Cache Everything" rule for `api`.** `/health` must stay
   `cf-cache-status: DYNAMIC`.
6. **WebSockets work on the proxy** — Socket.IO's upgrade passes through Cloudflare on every
   plan. Do not grey-cloud the record "for sockets"; that exposes the origin and breaks TLS.
7. **Know the 100-second origin timeout**: Cloudflare closes an HTTP response that takes longer
   than 100 s. All current endpoints answer in milliseconds; a future long-poll/streaming route
   would need a different record. Socket.IO long-polling is fine (short polls).
8. **Email Routing (do this):** Cloudflare → Email → Email Routing → enable for `ridevura.com`
   → custom address `aws@ridevura.com` → forward to a mailbox you will never lose. Use that as
   the AWS root email (§3, Step 0). Same panel is where Resend's DNS records must live.
9. **Namecheap side — only four things belong here:**
   * Domain List → `ridevura.com` → **Nameservers = Custom DNS** →
     `arvind.ns.cloudflare.com` + `arya.ns.cloudflare.com`. (If the Cloudflare zone is ever
     recreated you get a *new* pair — update them here or the whole site disappears.)
   * **Auto-renew ON** + expiry reminder emails to the owner mailbox.
   * **Registrar lock ON**, **2FA on the Namecheap account**.
   * **Never edit DNS records in Namecheap's own panel** while Cloudflare is authoritative —
     those edits do nothing today, and if you ever switch nameservers back they reappear stale
     and override nothing you expected.
10. **On the cutover day the only DNS change is the `api` CNAME target.** `www`, apex, `admin`,
    MX/TXT stay as they are — the apps keep talking to the same hostname, so **no APK rebuilds**.

### Copy/paste verification

```powershell
Resolve-DnsName -Type NS ridevura.com          # expect arvind/arya.ns.cloudflare.com
curl.exe -sI https://api.ridevura.com/health   # expect 200 + Server: cloudflare
curl.exe -sI https://ridevura.com              # expect 308 -> https://www.ridevura.com/
```

---

## 6. Moving the actual data into the new account

You only have data to move if the old account (456097556241) holds real riders/drivers/rides.
Decide this consciously: **without old-account access you can only start empty.**

### Option A (recommended): share the RDS snapshot, restore it in the new account

1. **In the OLD account:** RDS → Databases → select `vura` → Actions → **Take snapshot**
   (`vura-handover-YYYYMMDD`); wait for *Available*.
2. **Share it:** Actions → **Share snapshot** → add the new account ID with **Restore**
   permission.
   * Encrypted with the **default `aws/rds` key**? Then sharing is **impossible** — the default
     key cannot be shared. Use Option B instead (or re-encrypt via a snapshot copy with a
     customer-managed KMS key).
   * Encrypted with a **customer-managed KMS key**? Share that key too (KMS → Customer managed
     keys → key policy → allow the other account), or the restore fails.
3. **Different region?** In the new account: Snapshots → **Shared snapshots** → select it →
   Actions → **Copy snapshot** into the target region first (KMS key for that region included),
   then restore.
4. **In the NEW account:** Snapshots → Shared snapshots → **Restore snapshot**. Choose the VPC,
   subnet group and the new security group, an instance class you can afford, identifier
   `vura-prod`, **and set a new master password** (the snapshot does not carry the password).
   Database name `vura` and user `vura_admin` come along with the data.
5. Update `DB_HOST`/`DB_PASSWORD` on the new EB env, redeploy, then run the row-count check:
   ```sql
   SELECT (SELECT count(*) FROM users) AS users,
          (SELECT count(*) FROM rides) AS rides,
          (SELECT count(*) FROM driver_profiles) AS drivers;
   ```
   (All 31 tables come over intact — no pg_dump quirks, no sequence drift.)

### Option B (fallback): `pg_dump` → S3 → `pg_restore` (the cape-town route)

Both RDS instances are **private**, so neither dump nor restore can run from CloudShell:

1. On the **old EB instance** (`eb ssh --region us-east-1`, then inside):
   ```bash
   pg_dump --no-owner --no-acl --format=custom \
     -h vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com -U vura_admin -d vura \
     -f /tmp/vura-full.dump
   aws s3 cp /tmp/vura-full.dump s3://<a-bucket-the-instance-role-can-write>/backups/
   ```
2. In the new account, fetch it onto the **new EB instance** and restore:
   ```bash
   aws s3 cp s3://<bucket>/backups/vura-full.dump /tmp/
   PGPASSWORD='<new password>' pg_restore -h <new-endpoint> -U vura_admin -d vura \
     --no-owner --no-acl --no-comments /tmp/vura-full.dump
   ```
3. Accept the trade-off: anything written **during** the copy is lost unless you freeze writes
   (a short maintenance window) — the runbook scripts do exactly this
   (`deploy/cape-town/02-backup-and-restore-db.sh`).

### Driver documents in S3

Rows store `s3_key` (layout `documents/{userId}/{type}/{uuid}-{name}`,
`server/src/lib/s3.ts:61`), so keep the layout identical:
```bash
aws s3 sync s3://<old-docs-bucket>/documents/ s3://<new-docs-bucket>/documents/ \
  --profile old-account
```
Then spot-check: open one document from the admin panel (it calls a presigned URL) **before**
decommissioning anything.

### Cutover window (30 minutes, late night SA time)

1. Announce the window; freeze bookings (or accept the small gap).
2. Snapshot/restore the DB (Option A) → verify row counts.
3. `eb deploy` the new environment; verify `/health` + `401` on a protected route.
4. Flip the **`api` CNAME** in Cloudflare (§5). This is the only user-visible change.
5. Test one real ride end-to-end, one document upload, one card add, one earnings/payout view.
6. Keep the old account untouched for 7 days → rollback = flip the CNAME back.

---

## 7. Post-deploy verification checklist (run these in order)

| # | Check | Command / action | Pass looks like |
|---|---|---|---|
| 1 | API alive | `curl https://api.ridevura.com/health` | `{"status":"ok"}` |
| 2 | Auth middleware | `curl -i https://api.ridevura.com/api/rides/available` | HTTP **401** |
| 3 | DNS through Cloudflare | `curl.exe -sI https://api.ridevura.com/health` | `200` + `Server: cloudflare` |
| 4 | Logs are clean | `eb logs --region <region>` (CloudShell) | no `Cannot find module`, no restart loop |
| 5 | **Stops fix** (the pending work) | `powershell -File figma-ui/_verify_stops.ps1` from this laptop | `waypoints=[…]` **not** `null` |
| 6 | Socket | open the rider app; driver app goes online | live driver position updates |
| 7 | Document upload | driver app → Link your car → add a photo | no 413; admin panel shows it via presigned URL |
| 8 | Payments | add a card (R1 authorize) with `PAYMENTS_MODE=live` | Paystack custom tab opens; card row appears |
| 9 | Email | request the email-verification code | arrives from `onboarding@ridevura.com` |
| 10 | Pricing/limits | tap around the app quickly | no 429s |

**Rollback ladder:** code → `git revert <sha> && eb deploy`; infra → flip the `api` CNAME back
to the old EB host; data → the old DB is untouched for 7 days.

---

## 8. Operations: backups, cost, monitoring, hygiene

**Backups**
* RDS → *Automated backups* **7 days** (default), plus a **manual snapshot before every change**
  of consequence (migrations, region/account moves).
* `deploy/rds-backup.sh` still works as a belt-and-braces nightly dump to S3 — it needs
  `DB_PASSWORD` in the environment, so run it from the EB instance (cron) or a small box, never
  with the password baked into the script (that is mistake #2).
* **A restore you have never tested is not a backup.** Once, restore a snapshot to a throwaway
  instance and count rows.

**Cost (af-south-1 ballpark, per month)**
| Item | Approx |
|---|---|
| EB single-instance `t3.small` + 30 GB gp3 | $18–25 |
| RDS `db.t4g.micro` / `t4g.small` (single-AZ) + 20 GB | $15–35 |
| S3 (documents + backups, a few GB) | < $2 |
| Cloudflare DNS/proxy, Vercel site, Firebase Auth, Resend | $0 on free tiers |
| Paystack | per successful transaction |
| **Budget alarm** | set at **$60/month** |

**Monitoring**
* CloudWatch → alarm on EB *EnvironmentHealth* (Warning/Degraded) → email.
* CloudWatch → alarms on RDS `CPUUtilization > 80%` and `DatabaseConnections > 15` (the pool
  caps at 20 — `server/src/config/database.ts:17`).
* A free external uptime check (UptimeRobot or similar) on `https://api.ridevura.com/health`
  every 5 minutes, alerting to the owner mailbox. That is the fastest way to learn the app is
  down before a driver calls.

**Hygiene / security**
* **No long-lived access keys** if you can avoid them: attach an instance profile with
  least-privilege S3 access instead. If keys exist (IAM `makhavurr`), rotate them during the
  move and delete the old ones.
* MFA on **every** human identity (root has two devices; `vura-admin` has its own).
* Do not paste secrets into chat, tickets, or `.txt` files on the Desktop — the current
  `deploy/production.env` plus the Firebase JSON on this laptop is the blast radius; rotate
  rather than tidy.
* Delete the old account's credentials/keys **after** the 7-day rollback window, and keep the
  final snapshot + S3 backup bucket as a cold archive.

---

## 9. Do this now (in order), given where we are today

1. **Do not create a third account.** The passkey you have works on your PC (Windows PIN) and in
   Microsoft Authenticator on the phone, and it opens **account 054037132330**. Use that as the
   new home — or, if that account is for something else, create one clean account and follow §3,
   Step 2 **before** anything else.
2. **Sign in with the passkey (PIN) and confirm the account is empty**: no Elastic Beanstalk
   environments, no RDS instances. (If `vura-rider-prod` *is* there, this is your production
   account and everything gets much simpler.)
3. **Secure access to the OLD account (456097556241).** Everything in §6 depends on it: whoever
   holds IAM user `makhavurr` (`developerdev3839@gmail.com`, per `deploy/cape-town/STEPS.md:7`)
   must sign in, **add a TOTP MFA device**, create a fresh IAM admin with access keys for the
   migration, and take the RDS snapshot. No old-account access = start with an empty database.
4. **Run §3 → §4 → §5** in the new account (identity → resources → env vars → DNS).
5. **§6** migrate the data, **§7** verify, then keep the old side alive 7 days.
6. **Rotate every secret** listed in §4 (DB password, Paystack live keys, Resend key, Firebase
   service account) and delete the old ones.
7. Commit this playbook and the `deploy/env.prod.example` template — they contain no secrets and
   are the hand-over document for whoever does this next.




