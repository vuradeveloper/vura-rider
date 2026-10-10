# FINAL_PREFLIGHT.md — ordered go-live checklist for `fix/rc1-stale-boot-log`

**Branch:** `fix/rc1-stale-boot-log` — **record the real tip before you start:**
run (PowerShell, repo root) `git rev-parse --short HEAD` and write the value
here: `HEAD = ________`. Trust that recorded value, not any hash printed in
any document — this file once said `3114340` and went stale. **No merge to
main. No deploy until every step shows its "what I should see". Any miss →
STOP — do not continue.** (Provenance only: RC1 `12ae348` + staleness fixes
`2da9888`, `3114340` — history, not the current tip.)

**ORDER (hard rule):**
1. **Deploy this Module 1 branch FIRST** (`fix/rc1-stale-boot-log` → `vura-rider-prod`),
   running §1–§10 in order — Step 10 (allowlist) must pass.
2. **`main` is merged only AFTER Step 10's allowlist test passes** — never
   before it, never in parallel with the deploy. Module 2 (`module2-destination`
   / `release-candidate-2`, flags OFF) merges after that, same rule.
**Shells (Windows):** this checklist is **AWS-console-first** — most steps need
only a browser. Every block that is still a command is labelled **[PowerShell]**
or **[Git Bash]**; optional CLI equivalents live in **Appendix A**. `date +%Y…`,
`"$DATABASE_URL"` and backslash continuations are Git Bash; `$env:…`, `` ` ``
continuations and `Get-Date` are PowerShell. Plain `bash` typed in PowerShell
on this laptop resolves to the broken WSL stub — use the **Git Bash**
Start-menu app (or `"C:\Program Files\Git\bin\bash.exe" -c "…"`).

Detail: `DEPLOY_RC1.md` · `server/migrations/TEST_MIGRATION.md` · `MODULE1_TEST.md`.

## Step 0 — Gates (this laptop, before anything else)

**[PowerShell]** (Windows PowerShell 5.1 has no `&&` — run line by line):

```powershell
cd server
npx tsc --noEmit
npx vitest run
```

then DEPLOY_RC1 §1a
(rebuild + commit `server/dist`) and §1b (both checks — §1b is a PowerShell block).
**See:** tsc 0 errors, vitest green, both checks print `dist gate OK`.
**If not:** STOP (§1b exists precisely because `dist` was last built at `1f3a4c9`).

## Step 0b — Debug-keystore backup (before ANY APK is built)

Confirm both current production keystores are backed up to **two locations, one
off-machine** (procedure: `KEYSTORE_PLAN.md` §3) before any APK is built or
distributed:

- `C:\Users\mbofh\.android\debug.keystore` — signs every installed figma-ui
  driver APK (SHA-256 `B8:48:7F:…:9D`);
- `C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-driver\android\app\debug.keystore`
  — the Expo app's key (SHA-256 `FA:C6:17:…:3B:9C`).

**See:** both copies exist, and `keytool -list -v -keystore <copy> -storepass …`
on each **copy** prints the same SHA-256 as the original; alias + passwords
recorded in the password manager per `KEYSTORE_PLAN.md` §3 checklist.
**If not:** STOP — losing the current signer makes in-place updates impossible
for every already-installed driver APK.

## 1. EB min=max=1 (AWS console)

Click-path (console names as of 2026 — if one moved, use the search box
*inside* the console):

1. AWS console top bar → region **Africa (Cape Town) af-south-1**.
2. Services → **Elastic Beanstalk** → left nav **Environments** →
   `vura-rider-prod` (application `vura-rider`).
3. Left nav **Configuration** → card **Capacity** → **Edit**: Min = **1**,
   Max = **1** → **Apply changes** (a green "no downtime" environment update
   runs — wait for it to finish).
4. Same page → **Rolling updates and deployments** card (older consoles:
   inside Capacity) → Deployment policy = **All at once** — never
   `Rolling with additional batch`.

**See:** environment header shows Health **Ok** (green), the Instances tile
shows exactly **1 instance**, and the environment-update event in **Events**
finished green.
**If not:** STOP — two instances double-tick `offerWorker` (DEPLOY_RC1 §5).

## 2. Snapshot (AWS console)

1. Services → **RDS** → left nav **Databases** → click the prod instance
   (its identifier is the `DB_HOST` from `deploy/production.env`, minus the
   `.rds.amazonaws.com` suffix).
2. Top-right **Actions** → **Take snapshot**.
3. Snapshot name: `vura-pre-final-<yyyyMMdd>` (PowerShell: `Get-Date -Format
   yyyyMMdd`; Git Bash: `date +%Y%m%d`) → **Take snapshot**.
4. Left nav **Snapshots** → filter **Manual** → find yours.

**See:** Status = **Available** (≈5–15 min) before step 5 (step 4 restores it).
**If not** (Status **Failed**): STOP.
(CLI equivalent: Appendix A.1.)

## 3. Pre-check SQL (read-only, prod)

### 3.0 Get psql + connect (Windows)

**psql on PATH** — this laptop has PostgreSQL 18 at
`C:\Program Files\PostgreSQL\18\bin` (off PATH). Add it: Settings → System
→ About → **Advanced system settings** → **Environment Variables** → `Path`
→ **Edit** → **New** → `C:\Program Files\PostgreSQL\18\bin` → OK. Open a
**new** terminal: `psql --version` must answer.
(Session-only alternative: `$env:Path += ';C:\Program Files\PostgreSQL\18\bin'`.)

**Find the prod endpoint in the console:** RDS → Databases → prod instance →
**Connectivity & security** tab → **Endpoint** (hostname) + **Port** (5432).
The database name is usually `postgres` (the instance's initial database).

**Your IP must be allowed** (same tab → **VPC security groups** → click the
`sg-…` → EC2 console opens → **Inbound rules** → **Edit inbound rules** →
add: Type **PostgreSQL**, Port **5432**, Source **My IP** → **Save**). Remove
this rule when the checklist is done; never `0.0.0.0/0`.

**GUI option (no psql):** **pgAdmin 4** (ships with PostgreSQL — Start menu →
PostgreSQL 18 → pgAdmin 4) or **DBeaver** (dbeaver.io): connect dialog →
host = the RDS **Endpoint**, port 5432, maintenance DB `postgres`, username =
master user from `deploy/production.env`, password prompt. Run the four
SELECTs in the Query tool.

**Connect** (a password prompt beats putting secrets in shell history):

```bash
psql -h <ENDPOINT> -p 5432 -U <master-user> -d postgres     # [Git Bash or PowerShell]
```

**⚠ 001b warning (steps 4.5 and 6):** `CREATE UNIQUE INDEX CONCURRENTLY`
**cannot run inside a transaction**. In psql: run it as ONE statement — no
`BEGIN`, no `-1`/`--single-transaction` flag, don't paste the whole file as a
script. **pgAdmin** Query tool: leave **autocommit ON** (the "Disable
auto-commit" toolbar button must NOT be active) and execute the statement
alone. **DBeaver**: the autocommit toggle must be ON — never "Execute
script" with autocommit off (it wraps everything in one transaction). If an
INVALID index is ever left behind:
`DROP INDEX CONCURRENTLY IF EXISTS idx_ride_offers_one_active_per_driver;`
(TEST_MIGRATION §5).

### 3.1 The pre-check SQL

Run this (it is only SELECTs — safe against prod). **[Git Bash]**:

```bash
psql "$DATABASE_URL" <<'SQL'
-- 001 + 001b must already exist (Module 1 prep):
SELECT key FROM app_config WHERE key = 'matching';          -- 1 row
SELECT h3_matching_enabled, h3_rollout_mode FROM app_config WHERE key='matching';
--   seed was false/'off'; whatever it is NOW is the live rollout state
SELECT COUNT(*) FROM information_schema.tables
 WHERE table_name IN ('driver_cells','driver_blocks','driver_metrics');  -- 3
-- 001b unique index present:
SELECT indexname FROM pg_indexes WHERE tablename='ride_offers'
 AND indexname = 'idx_ride_offers_one_active_per_driver';       -- 1 row
SQL
```

**[PowerShell]** (same SQL — heredoc is bash-only; run the statements from a
file):

```powershell
psql $env:DATABASE_URL -f precheck.sql   # precheck.sql = the four SELECTs above
```

**Paste this output back to your reviewer — these are the results that matter
(and nothing else from the session):**
1. the `matching` row: `h3_matching_enabled`, `h3_rollout_mode` (live rollout truth);
2. the table COUNT (3);
3. the index SELECT (1 row = present, 0 = missing);
4. the snapshot name from step 2 + its `available` state.

**See:** `matching` row = 1 · `driver_cells`+`driver_blocks`+`driver_metrics`
= 3 tables · `idx_ride_offers_one_active_per_driver` present · record current
`h3_matching_enabled` / `h3_rollout_mode` (that is live rollout truth).
**If tables/index missing** → continue; steps 5/6 apply them.
**If anything else is unexpected** (duplicate `matching` rows, odd values) → STOP.

## 4. Copy-test — restore the snapshot to a TEMPORARY instance, test, DELETE

Goal: run TEST_MIGRATION §0–§7 (001 twice · seed duplicate · 001b pre-check
sees it · FIX → 0 rows · index `indisvalid=true` + enforced-23505 · kill switch
toggles · rollback + re-apply) against a **copy** of the database. **Never
point any of these commands at production** — every command below names the
temporary instance explicitly; if an identifier you type does NOT contain
`copytest`, STOP and retype it.

Cost while it exists: roughly the hourly price of the chosen instance class
plus storage for the full snapshot size (af-south-1 order of magnitude:
db.t3.medium ≈ US$0.07–0.10/h, gp3 storage ≈ US$0.12/GB-month) — a one-hour
copy-test lands around **US$1–3**. You are billed until deletion finishes, so
step 4.6 is not optional. (Exact prices: AWS RDS pricing page for af-south-1 —
not verified from this document.)

**4.1 Restore the snapshot — AWS console:**

1. Services → **RDS** → left nav **Snapshots** → filter **Manual** →
   select `vura-pre-final-<yyyyMMdd>` → **Actions** → **Restore snapshot**.
2. On the restore page:
   - **DB instance identifier**: `vura-copytest-<yyyyMMdd-HHmm>` — the name
     MUST contain `copytest` (that is the never-prod guard);
   - **Engine** unchanged; **Instance class**: `db.t3.medium` (never a
     prod-sized class for a throwaway);
   - **Connectivity**: same VPC + subnet group as prod (the default).
     **Public access: No** — you reach it from inside the VPC (bastion /
     SSM port-forward). Only if you have no in-VPC route: set **Yes** and
     select a security group whose inbound rule allows 5432 **from your
     IP/32 only** (create it first in EC2 → Security Groups; an
     open-to-the-world copy of prod data is a STOP-grade mistake);
   - no Multi-AZ; backups don't matter (it gets deleted).
3. **Restore database instance**.

**See:** Databases list shows `vura-copytest-…`, status **Creating**.

**4.2 Wait — [console]:** Databases → your copy → status **Available**
(≈10–20 min). **If** it ends **Failed** (or the **Events** tab shows a
restore-failed event): STOP.

**4.3 Endpoint — [console]:** Databases → `vura-copytest-…` →
**Connectivity & security** tab → **Endpoint** + **Port** (5432). Note the
hostname as `COPY_HOST`.
(CLI equivalents for 4.1–4.3/4.6: Appendix A.2.)

**4.4 Connect to the COPY — the snapshot carries the source instance's master
username and password** (use the DB credentials already recorded in
`deploy/production.env`); the initial database name is the source's:

**[Git Bash]:**

```bash
export DATABASE_URL="postgres://<master-user>:<password>@<COPY_HOST>:5432/<dbname>"
psql "$DATABASE_URL" -c "select version();"   # must answer with a PostgreSQL banner
psql "$DATABASE_URL" -c "\dt"                 # pre-001 shape: the 4 Module-1 tables may or may not exist (this repo's prod already has 001 applied — TEST_MIGRATION §0's "must NOT exist" assumed a pre-Module-1 copy; if they exist, that itself is a recorded result, then continue)
```

**[PowerShell]:**

```powershell
$env:DATABASE_URL = "postgres://<master-user>:<password>@<COPY_HOST>:5432/<dbname>"
psql $env:DATABASE_URL -c "select version();"
```

**If `select version()` fails:** STOP (wrong host/credentials — do NOT "fix"
it by trying the prod endpoint).

**4.5 Run the 001 + 001b tests against the COPY — TEST_MIGRATION §0–§7,
[Git Bash] (PowerShell: swap `"$DATABASE_URL"` → `$env:DATABASE_URL`):**

```bash
cd server
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql   # run TWICE — exit 0 both times = idempotent
psql "$DATABASE_URL" -c "SELECT key, value FROM app_config WHERE key='matching';"  # 1 row, enabled=false, mode='off'
# then TEST_MIGRATION §2–§4: seed the duplicate pending offers (real UUIDs from the copy),
#   pre-check SELECT shows pending_offers=2, run the FIX UPDATE, pre-check → 0 rows
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ride_offers_one_active_per_driver ON ride_offers (driver_id) WHERE status='pending';"
psql "$DATABASE_URL" -c "SELECT indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='idx_ride_offers_one_active_per_driver';"  # true
#   then the enforced-23505 INSERT (must ERROR), §6 kill-switch UPDATE toggles, and §7:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.rollback.sql
psql "$DATABASE_URL" -c "\dt"   # the 4 tables gone; rides/ride_offers/users/driver_profiles row counts unchanged
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql   # re-apply works (apply→rollback→apply proven)
```

**See:** every §Sign-off box in TEST_MIGRATION checked, with the copy's real
output behind each. **If any box fails:** STOP — capture the exact psql output
(see "Stuck?" below) and do not proceed to steps 5–10.

**4.6 DELETE the temporary instance — AWS console — do this even if 4.5 STOPped:**

1. RDS → **Databases** → `vura-copytest-…` → **Actions** → **Delete**.
2. Uncheck **Create final snapshot** (it is a throwaway), leave **Retain
   automated backups** unchecked, type the instance name to confirm →
   **Delete**.

**See:** status **Deleting**, then the instance disappears from the Databases
list (≈5–15 min — you are billed until then). If you created a temporary
security group: EC2 → **Security Groups** → `vura-copytest-sg` → **Actions**
→ **Delete**.
**If deletion is blocked:** the "Create final snapshot" box was left checked —
uncheck and retry. A forgotten copytest instance is a monthly credit-card
line item; confirm the Databases list no longer shows it.

## 5. 001 (prod)

Only if step 3 showed the 4 tables missing — **[Git Bash]**:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql
```

run it **twice** — connect exactly as Step 3.0. **[PowerShell]** equivalent
(`"$DATABASE_URL"` is bash syntax — PowerShell's env-var form is
`$env:DATABASE_URL`):

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql
```
**See:** exit 0 both runs · `\dt` lists the 4 tables · `matching` seed = exactly 1 row.
**Already present (step 3):** skip — verify only, do not re-run blindly.
**If error:** STOP.

## 6. 001b (prod)

Only if step 3 showed the index missing: pre-check SELECT must return **0 rows**
(it returns rows → STOP: clear the duplicate pending offers first), then run
001b — **[Git Bash]**:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001b_offer_unique_index.sql
```

**[PowerShell]**:

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f migrations/001b_offer_unique_index.sql
```

(plain psql — **no wrapping transaction**, CONCURRENTLY — if you use
pgAdmin/DBeaver, re-read the Step 3.0 autocommit warning first).
**See:** index present + `indisvalid=true`.
**Already present:** skip.

## 7. Env vars (AWS console)

1. Elastic Beanstalk → Environments → `vura-rider-prod` → left nav
   **Configuration** → card **Software** → **Edit**.
2. Scroll to **Environment properties** — the full name/value table.

**See:** every required var from `deploy/production.env` +
`AWS-NEW-ACCOUNT-SETUP.md` §4 (`env.prod.example` template) exists with the
same value — `NODE_ENV/PORT/DB_*/FIREBASE_*` (`FIREBASE_PRIVATE_KEY_B64`
decodes to a PEM)/`AWS_S3_*`/`ALLOWED_ORIGINS`/`PUBLIC_BASE_URL`/rate
limits/`PAYSTACK_*`/`RESEND_*`/`ADMIN_EMAILS`/`DEV_LOG_*_KEY`.
**If `DB_*` or `FIREBASE_*` missing or wrong:** STOP (fix in the editor →
**Apply changes** — that is an environment update; re-check Health after).
(CLI equivalent: `eb printenv` — Appendix A.3.)

## 7b. Dry-run the tooling — find breakage TODAY, not on deploy day

**[PowerShell]** — every line must print a version, no "not recognized":

```powershell
aws --version     # AWS CLI 2.x    — steps 2/4 (snapshot, restore) need it
eb --version      # EB CLI 3.x     — steps 7/8 (`eb printenv`, deploy) need it
psql --version    # psql 1x        — steps 5/6 need it
node --version    # v22.x          — matches the EB `node.js-22` platform
```

**[Git Bash]** — run the SAME checks here, because step 8 executes in Git
Bash and shells do not share PATH fixes you made in PowerShell only:

```bash
aws --version; eb --version; psql --version; node --version
bash --version    # GNU bash 5.x (Git Bash), NOT the WSL stub
file deploy/deploy.sh   # must say "ASCII text" / "UTF-8 text" — NOT "with CRLF line terminators"
```

**See:** five version lines from each shell. `deploy.sh` is LF in git (the
root `.gitattributes` pins `eol=lf`); if `file` reports CRLF, the working copy
is stale — fix with **[PowerShell]** `git rm --cached deploy/deploy.sh; git
checkout -- deploy/deploy.sh`, re-check, then continue.
**If not:** STOP — install/fix the missing tool now. On 2026-10-10 this laptop
had **no `aws`, no `eb`** and only `C:\Program Files\PostgreSQL\18\bin` (off
PATH) for `psql` — exactly the surprises Step 7b exists to catch.

## 8. Deploy (AWS console) — build the zip, upload, roll back

### 8a. Build the deployable zip on Windows — [PowerShell]

The zip mirrors what `eb deploy`'s `.ebignore` ships: **`Procfile`,
`.gitignore`, `.platform/`, `.ebextensions/`, `server/`** — nothing else.
It must NOT contain `server/node_modules` (the instance installs its own
Linux deps: the `.platform` hooks run `npm install --omit=dev` and verify
`dotenv` + `sharp` before the app starts), any `.env` (secrets live in Step
7's Environment properties), the Expo app, or logs.

```powershell
# from the repo root, on the exact commit being deployed:
cd 'c:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider'
git checkout fix/rc1-stale-boot-log
$sha = git rev-parse --short HEAD      # MUST equal the SHA recorded at the top

# rebuild dist so the zip carries fresh bytecode (Step 0 / §1b gate this):
cd server; npm run build; cd ..

# stage exactly the five shipping paths:
$stage = "$env:TEMP\vura-eb\app"
Remove-Item -Recurse -Force "$env:TEMP\vura-eb" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item Procfile,.gitignore -Destination $stage
Copy-Item .platform,.ebextensions -Destination $stage -Recurse
Copy-Item server -Destination "$stage\server" -Recurse
Remove-Item -Recurse -Force "$stage\server\node_modules","$stage\server\logs" -ErrorAction SilentlyContinue
Get-ChildItem "$stage\server" -Filter *.log -File -Recurse | Remove-Item -Force
Remove-Item -Force "$stage\server\.env" -ErrorAction SilentlyContinue

# zip with Windows' built-in tar (bsdtar writes proper zip entries;
# Compress-Archive stores backslashes that some Linux unzip tools choke on):
$zip = "vura-$sha-$(Get-Date -Format yyyyMMdd-HHmm).zip"
tar -a -c -f $zip -C $stage Procfile .gitignore .platform .ebextensions server
```

### 8b. Confirm the zip's contents BEFORE uploading — [PowerShell]

```powershell
tar -tf $zip | Select-String '^Procfile$|^\.platform/|^\.ebextensions/|^server/package.json|^server/dist/index.js'
#   -> all five must print
tar -tf $zip | Select-String 'node_modules|\.env$|figma-ui|expo|\.log$'
#   -> must print NOTHING
"{0:N1} MB" -f ((Get-Item $zip).Length / 1MB)   # expect a few MB, not hundreds
```

**See:** the five required entries print; the forbidden grep prints nothing;
size is a few MB. **If not:** STOP — never upload a zip that fails 8b.

### 8c. Upload it with a version label — [browser]

1. Elastic Beanstalk → Environments → `vura-rider-prod` → button
   **Upload and deploy** (top right of the environment dashboard).
2. **Version label**: `vura-<sha>-<yyyyMMdd-HHmm>` — same as the zip name;
   letters/digits/hyphen only, no slashes (that is what deploy.sh enforced).
3. **Source** → Local file → **Choose file** → pick the 8a zip → **Deploy**.
4. Watch **Events**: the deploy runs the `.platform` npm-install hooks
   (~2–6 min for a node_modules-free zip) then the health check.

**See:** the SAME verification as always — label `vura-<short-sha>-<ts>` on
the environment · `curl /health` → `{"status":"ok"}` · boot log = **new** line
`… driver stale 20s (demote) · loc fresh 20s (candidates) · index evict 40s
(app_config) · build <sha>` + instance id + single-instance warning ·
`/api/dev/diag` answers, `sharp.loads=true` · EB shows 1 instance on the new
label, Health **Ok**.
**If health fails, the old `45s` boot line appears, or >1 instance:** STOP →
DEPLOY_RC1 §6 rollback ladder (config kill switch → redeploy → schema).

### 8d. Roll back to the previous application version — [browser]

1. Left nav **Application versions** (under the application) → the row
   directly above your current label is the previous version.
2. Select its radio button → **Deploy** (top right) → target
   `vura-rider-prod` → **Deploy** → watch **Events** until Health is Ok.

EB rollback = re-deploying an old application version's zip — it does NOT
touch schema or environment properties; for code problems check the
DEPLOY_RC1 §6 ladder order first (config kill switch before redeploy where
it applies). (CLI equivalent — `deploy.sh`, needs aws+eb installed:
Appendix A.4.)

## 9. Three rides

MODULE1_TEST §1–§8, three complete rides (online → GPS ping → flag → request →
accept → trace).
**See:** all 3 finish; every ride carries a `matching_path` stage; `/debug/counters`
moves; path matches live config from step 3 (`enabled=false` → `legacy/kill_switch_off`,
`enabled=true`+`mode=off` → `legacy/rollout_off`); `driver_cells` rows appear,
no `[driverIndex] upsert failed`.
**If any ride fails / no `matching_path` / counters flat:** STOP.

## 10. Allowlist

MODULE1_TEST §5 SQL: set `h3_rollout_mode='allowlist'` (skip if already past that
rung), then idempotently add your rider id.
**See within ~10s, same minute:** your rider `h3 / rollout_allowlist`, a second
non-listed rider `legacy / rollout_not_allowlisted`; full flow green.
**If unchanged after ~10s** or `[dispatch] config read failed` in logs → STOP →
kill switch (`h3_matching_enabled=false`), everyone legacy in seconds.

**After:** DEPLOY_RC1 §7 known pre-existing issues (CarsXE budget; diag read key =
instance's `DEV_LOG_READ_KEY`). **This deploys; it does not merge.** `main` is
merged only after Step 10 (allowlist) passes — see the ORDER rule at the top.

## Stuck? — the ONE thing to capture when a step says STOP

Grab exactly this before anything else (paste output, don't paraphrase):

| Step | Capture this |
|---|---|
| 0 (gates) | last 30 terminal lines — the `tsc` line, the vitest `Tests` summary, and the §1b `dist gate OK`/error text |
| 0b (keystore) | `keytool -list` output for each **copy** (the SHA-256 line) + a screenshot of both backup locations |
| 1 (EB) | EB console screenshot: Auto Scaling min/max values, Health status, instance count |
| 2 (snapshot) | the snapshot name you typed + RDS → Snapshots (Manual) showing it **Available** (screenshot) |
| 3 (pre-check) | the four SELECT outputs exactly as psql printed them (this is also the reviewer paste) |
| 4 (copy-test) | the failing command + its full output, and the TEST_MIGRATION sign-off table state; plus proof 4.6 ran (the Databases list no longer shows `vura-copytest-…`) |
| 5 (001) | the psql stderr of the failed run + `\dt` output |
| 6 (001b) | the pre-check SELECT result (rows returned) + the psql stderr |
| 7 (env vars) | screenshot of Configuration → Software → Environment properties + the list of missing/mismatched key names vs `deploy/production.env` (values may be masked) |
| 7b (tooling) | the five version lines as printed (or the `not recognized` / `command not found` text) + `file deploy/deploy.sh` output |
| 8 (deploy) | the 8b verification output (required/forbidden greps + zip size), the EB **Events** tab during the deploy (screenshot with the label), `curl /health` response + boot-log line |
| 9 (three rides) | the three ride ids + each ride's `matching_path` trace stage from `/debug/trips/<id>/trace` |
| 10 (allowlist) | both riders' `matching_path` stages captured in the same minute + the allowlist SQL you ran |

In every case also note: the exact step, the time, and the SHA from
`git rev-parse --short HEAD` — an unlabelled screenshot is guesswork later.

---

## Appendix A — CLI versions (optional)

The steps above need **no** CLI. Use these only if you prefer scripting —
and note the aws/eb CLIs are **not installed on this laptop** (Step 7b no
longer checks them; install them first if you go this way).

### A.1 — Step 2 snapshot

**[PowerShell]** (Git Bash: `date +%Y%m%d` instead of `Get-Date`):

```powershell
aws rds create-db-snapshot --db-instance-identifier <ID> `
  --db-snapshot-identifier vura-pre-final-$(Get-Date -Format yyyyMMdd)
```

### A.2 — Step 4 restore / inspect / delete

**[PowerShell]** (Git Bash: backslash continuations, `$(date +%Y%m%d-%H%M)`):

```powershell
aws rds restore-db-instance-from-db-snapshot `
  --db-instance-identifier vura-copytest-$(Get-Date -Format yyyyMMdd-HHmm) `
  --db-snapshot-identifier vura-pre-final-<yyyyMMdd> `
  --db-instance-class db.t3.medium --no-publicly-accessible --copy-tags-to-snapshot
aws rds wait db-instance-available --db-instance-identifier vura-copytest-<…>
aws rds describe-db-instances --db-instance-identifier vura-copytest-<…> --query 'DBInstances[0].Endpoint.Address' --output text
aws rds delete-db-instance --db-instance-identifier vura-copytest-<…> --skip-final-snapshot
```

### A.3 — Step 7 env vars

```powershell
eb printenv      # the same table the console shows in Step 7 → Software
```

### A.4 — Step 8 deploy via `deploy.sh` (**[Git Bash] only**; needs aws+eb
installed — neither is on this laptop)

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout fix/rc1-stale-boot-log
git rev-parse --short HEAD     # MUST equal the SHA recorded at the top of this file
bash deploy/deploy.sh vura-rider-prod
```

`deploy.sh` needs: LF line endings (its git blob is LF, root
`.gitattributes` pins `eol=lf` — if bash dies with `set: -o: pipefail: invalid
option name`, the working copy is CRLF: fix with **[PowerShell]**
`Remove-Item deploy/deploy.sh; git checkout -- deploy/deploy.sh`), `git` +
`date` (shipped with Git Bash), and `eb` **on PATH inside Git Bash**. It
uploads the same five shipping paths via `.ebignore` — including
`server/node_modules` (minus native sharp dirs), unlike the 8a zip.
