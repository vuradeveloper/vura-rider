# FINAL_PREFLIGHT.md — ordered go-live checklist for `fix/rc1-stale-boot-log`

**Branch:** `fix/rc1-stale-boot-log` @ `3114340` (= RC1 `12ae348` + staleness
fixes `2da9888`, `3114340`). **No merge to main. No deploy until every step
shows its "what I should see". Any miss → STOP — do not continue.**

**ORDER (hard rule):**
1. **Deploy this Module 1 branch FIRST** (`fix/rc1-stale-boot-log` → `vura-rider-prod`),
   running §1–§10 in order — Step 10 (allowlist) must pass.
2. **`main` is merged only AFTER Step 10's allowlist test passes** — never
   before it, never in parallel with the deploy. Module 2 (`module2-destination`
   / `release-candidate-2`, flags OFF) merges after that, same rule.
Detail: `DEPLOY_RC1.md` · `server/migrations/TEST_MIGRATION.md` · `MODULE1_TEST.md`.

## Step 0 — Gates (this laptop, before anything else)

`cd server && npx tsc --noEmit && npx vitest run`, then DEPLOY_RC1 §1a
(rebuild + commit `server/dist`) and §1b (both checks).
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

```bash
aws rds create-db-snapshot --db-instance-identifier <ID> \
  --db-snapshot-identifier vura-pre-final-$(date +%Y%m%d)
```
**See:** snapshot reaches state `available` before step 5.
**If not:** STOP.

## 3. Pre-check SQL (read-only, prod) — DEPLOY_RC1 §2

**See:** `matching` row = 1 · `driver_cells`+`driver_blocks`+`driver_metrics`
= 3 tables · `idx_ride_offers_one_active_per_driver` present · record current
`h3_matching_enabled` / `h3_rollout_mode` (that is live rollout truth).
**If tables/index missing** → continue; steps 5/6 apply them.
**If anything else is unexpected** (duplicate `matching` rows, odd values) → STOP.

## 4. Copy-test commands (against a RESTORE of the snapshot — never prod)

TEST_MIGRATION §0–§7 on the copy: `001` twice · seed duplicate · 001b pre-check
sees it · FIX → 0 rows · index `indisvalid=true` + enforced-23505 · kill switch
toggles · rollback + re-apply.
**See:** every §Sign-off box checked.
**If any box fails:** STOP.

## 5. 001 (prod)

Only if step 3 showed the 4 tables missing:
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql` — run it **twice**.
**See:** exit 0 both runs · `\dt` lists the 4 tables · `matching` seed = exactly 1 row.
**Already present (step 3):** skip — verify only, do not re-run blindly.
**If error:** STOP.

## 6. 001b (prod)

Only if step 3 showed the index missing: pre-check SELECT must return **0 rows**
(it returns rows → STOP: clear the duplicate pending offers first), then
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001b_offer_unique_index.sql`
(plain psql — **no wrapping transaction**, CONCURRENTLY).
**See:** index present + `indisvalid=true`.
**Already present:** skip.

## 7. Env vars

`eb printenv` vs `deploy/production.env` + the required table in
`AWS-NEW-ACCOUNT-SETUP.md` §4 (`env.prod.example` template).
**See:** every required var present — `NODE_ENV/PORT/DB_*/FIREBASE_*`
(`FIREBASE_PRIVATE_KEY_B64` decodes)/`AWS_S3_*`/`ALLOWED_ORIGINS`/
`PUBLIC_BASE_URL`/rate limits/`PAYSTACK_*`/`RESEND_*`/`ADMIN_EMAILS`/
`DEV_LOG_*_KEY`.
**If `DB_*` or `FIREBASE_*` missing or wrong:** STOP.

## 8. Deploy

```bash
git checkout fix/rc1-stale-boot-log   # HEAD = 3114340 + any §0 dist commit
bash deploy/deploy.sh vura-rider-prod
```
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
