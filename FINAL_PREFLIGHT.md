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
**Shells (Windows):** every command block below is labelled **[PowerShell]** or
**[Git Bash]** — run it in that shell only. `date +%Y…`, `"$DATABASE_URL"`,
backslash continuations, and `bash deploy/deploy.sh` are Git Bash; `$env:…`,
`` ` `` continuations, and `Get-Date` are PowerShell. Plain `bash` typed in
PowerShell on this laptop resolves to the broken WSL stub — use the **Git Bash**
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

## 1. EB min=max=1

EB console → `vura-rider-prod` → Configuration: Auto Scaling **min=max=1**,
deploy policy All-at-once (never `RollingWithAdditionalBatch`).
**See:** exactly 1 instance, Health Green.
**If not:** STOP — two instances double-tick `offerWorker` (DEPLOY_RC1 §5).

## 2. Snapshot

**[PowerShell]:**

```powershell
aws rds create-db-snapshot --db-instance-identifier <ID> `
  --db-snapshot-identifier vura-pre-final-$(Get-Date -Format yyyyMMdd)
```

**[Git Bash]** (same snapshot, if you prefer Git Bash):

```bash
aws rds create-db-snapshot --db-instance-identifier <ID> \
  --db-snapshot-identifier vura-pre-final-$(date +%Y%m%d)
```
**See:** snapshot reaches state `available` before step 5.
**If not:** STOP.

## 3. Pre-check SQL (read-only, prod)

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

**4.1 Restore the snapshot to a temporary instance — [PowerShell]:**

```powershell
aws rds restore-db-instance-from-db-snapshot `
  --db-instance-identifier vura-copytest-$(Get-Date -Format yyyyMMdd-HHmm) `
  --db-snapshot-identifier vura-pre-final-<yyyyMMdd-from-step-2> `
  --db-instance-class db.t3.medium `
  --no-publicly-accessible `
  --copy-tags-to-snapshot
```

**[Git Bash]** equivalent:

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier vura-copytest-$(date +%Y%m%d-%H%M) \
  --db-snapshot-identifier vura-pre-final-<yyyyMMdd-from-step-2> \
  --db-instance-class db.t3.medium \
  --no-publicly-accessible \
  --copy-tags-to-snapshot
```

**See:** JSON with `"DBInstanceStatus": "creating"` and your
`vura-copytest-…` identifier. Class/flags: `db.t3.medium` is fine for testing
(never pick a prod-sized class for a throwaway); `--no-publicly-accessible`
keeps the copy off the internet — you then reach it only from inside the VPC
(bastion / SSM port-forward). If you have no in-VPC route, replace
`--no-publicly-accessible` with `--publicly-accessible` AND a dedicated
security group that allows 5432 **only from your current IP/32** — an
open-to-the-world copy of prod data is a STOP-grade mistake. A dedicated SG
(add to the restore command as `--vpc-security-group-ids sg-…`):

```powershell
# [PowerShell] make one, scoped to your IP, if you go the public route:
aws ec2 create-security-group --group-name vura-copytest-sg --description "temporary copy-test access" --vpc-id <vpc-id-of-prod-db>
aws ec2 authorize-security-group-ingress --group-id <new-sg-id> --protocol tcp --port 5432 --cidr <your-ip>/32
```

**4.2 Wait for it to be available — [either shell]:**

```powershell
aws rds wait db-instance-available --db-instance-identifier vura-copytest-<…>
```
Takes ~5–15 min for a snapshot restore; the command prints nothing and exits
0 when the instance is `available`. **If it times out (10 min default, re-run
it) or ends in `failed`:** STOP.

**4.3 Get its endpoint — [either shell]:**

```powershell
aws rds describe-db-instances --db-instance-identifier vura-copytest-<…> --query 'DBInstances[0].Endpoint.Address' --output text
```
**See:** one `vura-copytest-….…af-south-1.rds.amazonaws.com` hostname (or the
in-VPC address). Note it as `COPY_HOST`.

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

**4.6 DELETE the temporary instance — do this even if 4.5 STOPped — [either shell]:**

```powershell
aws rds delete-db-instance --db-instance-identifier vura-copytest-<…> --skip-final-snapshot
```
**See:** JSON `"DBInstanceStatus": "deleting"`; billing for the copy stops when
it is gone (~5–10 min). If you created the temporary SG in 4.1, delete it too:

```powershell
aws ec2 delete-security-group --group-id <new-sg-id>
```
**If deletion refuses** (e.g. automated backups): re-run with
`--delete-automated-backups`. A forgotten copytest instance is a monthly
credit-card line item — confirm with
`aws rds describe-db-instances --db-instance-identifier vura-copytest-<…>`
that it ends in `DBInstanceNotFoundFault`.

## 5. 001 (prod)

Only if step 3 showed the 4 tables missing — **[Git Bash]**:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql
```

run it **twice**. **[PowerShell]** equivalent (`"$DATABASE_URL"` is bash
syntax — PowerShell's env-var form is `$env:DATABASE_URL`):

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

(plain psql — **no wrapping transaction**, CONCURRENTLY).
**See:** index present + `indisvalid=true`.
**Already present:** skip.

## 7. Env vars

**[PowerShell or Git Bash]** (the EB CLI works in both — `eb printenv`):

`eb printenv` vs `deploy/production.env` + the required table in
`AWS-NEW-ACCOUNT-SETUP.md` §4 (`env.prod.example` template).
**See:** every required var present — `NODE_ENV/PORT/DB_*/FIREBASE_*`
(`FIREBASE_PRIVATE_KEY_B64` decodes)/`AWS_S3_*`/`ALLOWED_ORIGINS`/
`PUBLIC_BASE_URL`/rate limits/`PAYSTACK_*`/`RESEND_*`/`ADMIN_EMAILS`/
`DEV_LOG_*_KEY`.
**If `DB_*` or `FIREBASE_*` missing or wrong:** STOP.

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

## 8. Deploy — **[Git Bash] only**

Run in the **Git Bash** app (the WSL-stub `bash` in PowerShell cannot execute
this script — Step 7b proved which `bash` you have):

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout fix/rc1-stale-boot-log
git rev-parse --short HEAD     # MUST equal the SHA recorded at the top of this file
bash deploy/deploy.sh vura-rider-prod
```

`deploy.sh` needs: LF line endings (Step 7b checked), `git` + `date` (shipped
with Git Bash), and `eb` **on PATH inside Git Bash** — if Git Bash says
`eb: command not found` while PowerShell finds it, fix the PATH in Git Bash's
`~/.bash_profile`, do not retype the deploy by hand.
**See:** label `vura-<short-sha>-<ts>` · `curl /health` → `{"status":"ok"}` ·
boot log = **new** line `… driver stale 20s (demote) · loc fresh 20s (candidates)
· index evict 40s (app_config) · build <sha>` + instance id + single-instance
warning · `/api/dev/diag` answers, `sharp.loads=true` · EB shows 1 instance on
the new label.
**If health fails, the old `45s` boot line appears, or >1 instance:** STOP →
DEPLOY_RC1 §6 rollback ladder (config kill switch → redeploy → schema).

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
