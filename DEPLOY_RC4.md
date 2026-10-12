# DEPLOY_RC4.md — deploy `release-candidate-4` to production (console-first)

> **Console-first:** every step below is an AWS **console** action first; the
> CLI line is given as the reference/alternative. This document deploys. It
> does **not** merge — `release-candidate-4` stays a branch in BOTH repos.
> No keystore, appId, permission or signing changes ship in RC4.

**Branch (rider/server):** `vura-rider` `release-candidate-4`. **Branch
(driver):** `vura-driver` `release-candidate-4` — ships as an APK, **not** via
EB. **Target:** Elastic Beanstalk `vura-rider-prod`, region `af-south-1`,
min=max=1 instance.

**What RC4 adds:**
1. **Migrate-on-boot** (`RUN_MIGRATIONS_ON_BOOT`, default OFF) — the server
   applies migrations 001 → 001b → 002 → 003 itself and logs ONE summary line.
2. **Admin feature flags API** — enable matching / destination / tier for test
   accounts without SQL (`/api/admin/features*`).
3. **Driver feature-status endpoint** — `GET /api/drivers/feature-status`
   (the one call the driver app's home screen + Feature status page use).
4. **Dispatch trace** — `radius_km` + `radius_ladder` in `matching_path`.
5. **Driver APK 1.3** (versionCode 4) — both entry buttons always visible
   (greyed + reason), Account → Feature status page, old-WebView floor.
6. **Rider app** — old-Android-WebView guard for the map (Chrome 70 floor).

---

## 1. Preflight gates (your machine, from the branch)

```powershell
git checkout release-candidate-4 && git pull
git --no-pager log --oneline -1            # RECORD this SHA

cd server
npx tsc --noEmit                           # 0 errors
npx vitest run                             # 220 passed / 12 skipped, 16 files
Set-Location ..
node _legacycheck.mjs                      # must print IDENTICAL=true vs main

cd ..\vura-driver\figma-ui                 # driver repo, sibling checkout
npm test                                   # 41 passed / 0 failed
npx tsc --noEmit                           # 0 errors
Set-Location ..\..

cd ..\vura-rider                           # rider app side
npm run test:webview                       # 9 passed / 0 failed (scan gate)
```

Any red → stop, fix, re-run. Never deploy around a gate.

## 2. Rebuild and COMMIT `server/dist` (the deployed artefact)

**EB never runs `tsc`; `server/dist` IS what runs.** RC4 commits include a
fresh dist, but rebuild after any later commit:

```powershell
cd server ; npm run build
git add dist ; git commit -m "deploy: rebuild server/dist for RC4 deploy"
git status --porcelain server/dist          # must be CLEAN
```

Hard gate (same as RC3 §1b): `npm run build` again and require
`git status --porcelain dist` empty, and dist's last commit not older than
src's.

## 3. Fresh RDS snapshot (console FIRST)

1. RDS console → Databases → your instance → **Actions → Take snapshot**.
2. Name it `vura-pre-rc4-YYYYMMDD`. Wait until status = **Available**.
   CLI alternative:
   `aws rds create-db-snapshot --db-instance-identifier <ID> --db-snapshot-identifier vura-pre-rc4-$(date +%Y%m%d)`.

## 4. Pull the RC4 branch on the EB environment's source

Console: Elastic Beanstalk → `vura-rider-prod` → the environment's source is
the `release-candidate-4` branch of `vuradeveloper/vura-rider` (or from your
machine: `eb use vura-rider-prod && git checkout release-candidate-4 && git pull`).

## 5. Turn migrations ON for ONE boot

Console: EB → `vura-rider-prod` → Configuration → Software → **Environment
properties** → add `RUN_MIGRATIONS_ON_BOOT` = `true` → Apply.
CLI: `eb setenv RUN_MIGRATIONS_ON_BOOT=true -e vura-rider-prod`.
(The env change itself replaces the instance — that boot is the migration boot.)

## 6. Deploy + status + read the ONE summary line

```powershell
eb deploy -e vura-rider-prod
eb status        # expect: Ok / Green
```

Then read the boot summary line (console: EB → Logs → **Last 100 lines**, or
`eb logs --all | grep "\[migrate\]"`):

```
[migrate] summary applied=X skipped=Y failed=W
```

**Expected on this production database (001/001b/002 already applied, 003 new):**

```
[migrate] applied 003_performance_tier.sql
[migrate] summary applied=1 skipped=3 failed=0
```

A fully-migrated DB later reads `applied=0 skipped=4 failed=0`. **Anything
with `failed>0` → stop and read the `[migrate] FAILED <file>: <exact error>`
line above it** (the boot continues; the affected feature simply stays OFF).

## 7. Turn migrations OFF again (immediately)

Console: same Environment properties page → set `RUN_MIGRATIONS_ON_BOOT` =
`false` → Apply (or `eb setenv RUN_MIGRATIONS_ON_BOOT=false`). Every later
boot logs `[migrate] RUN_MIGRATIONS_ON_BOOT is not 'true' — skipped`.

## 8. Enable matching + destination + tier for the TEST driver (no SQL)

One admin call (auth = your admin Firebase ID token; the caller's email must
be in `ADMIN_EMAILS`):

```powershell
curl.exe -X POST https://api.ridevura.com/api/admin/features/enable `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <ADMIN_FIREBASE_ID_TOKEN>" `
  -d '{\"driverEmails\":[\"test.driver@example.com\"],\"features\":[\"matching\",\"destination\",\"performance_tier\"]}'
```

(Identifiers may be combined: `driverIds`, `driverEmails`, `driverPhones`,
`riderIds`, `riderEmails`, `riderPhones`; `features` omitted = all three.)

**Expected response (HTTP 200):**

```json
{
  "server_build": "<short-commit-of-RC4>",
  "resolved": {
    "driver_users": [{ "id": "<users.id>", "role": "driver", "email": "test.driver@example.com" }],
    "rider_users": [],
    "driver_ids": ["<users.id>"],
    "rider_ids": []
  },
  "flags": {
    "matching": { "h3_matching_enabled": true, "h3_rollout_mode": "all", "...": "..." },
    "destination": { "destination_matching_enabled": true, "destination_rollout_driver_ids": ["<users.id>"], "...": "..." },
    "performance_tier": { "performance_tier_enabled": true, "performance_tier_rollout_driver_ids": ["<users.id>"], "...": "..." }
  }
}
```

Errors: `403 {"error":"Admin only"}` (not in ADMIN_EMAILS) ·
`409 {"error":"app_config row '…' missing — run migrations first (RUN_MIGRATIONS_ON_BOOT=true)","code":"no_row"}` (do step 5-6 again).

**Verify on the phone:** driver app → Account → **Feature status** →
Destination **On**, Tier **On**, Matching `all` (or `allowlist`) + radius km.
Home: both buttons now tappable.

## 9. Driver APK

Install `vura-driver-figma-2026-10-12-rc4.apk` (versionCode 4 / versionName
1.3, signed with the same machine debug key as every previous RC build —
fingerprint `B8:48:7F:…:02:9D`). The rider RC4 APK is intentionally NOT
produced until its release keystore is located (its shipped APKs are signed
with fingerprint `96:BE:D8:…:AF:96`, whose keystore is not on the build
machine — no new keystore will be created).

---

**Rollback:** redeploy the previous EB application version (Console →
Releases → deploy the prior one) and, if the DB needs it, restore the
`vura-pre-rc4-*` snapshot. RC4 migrations are additive; leaving 003 applied
with flags OFF is safe (features stay off).
the `release-candidate-4` branch of `vuradeveloper/vura-rider` (or from your
machine: `eb use vura-rider-prod && git checkout release-candidate-4 && git pull`).

## 5. Turn migrations ON for ONE boot

Console: EB → `vura-rider-prod` → Configuration → Software → **Environment
properties** → add `RUN_MIGRATIONS_ON_BOOT` = `true` → Apply.
CLI: `eb setenv RUN_MIGRATIONS_ON_BOOT=true -e vura-rider-prod`.
(The env change itself replaces the instance — that boot is the migration boot.)

## 6. Deploy + status + read the ONE summary line

```powershell
eb deploy -e vura-rider-prod
eb status        # expect: Ok / Green
```

Then read the boot summary line (console: EB → Logs → **Last 100 lines**, or
`eb logs --all | grep "\[migrate\]"`):

```
[migrate] summary applied=X skipped=Y failed=W
```

**Expected on this production database (001/001b/002 already applied, 003 new):**

```
[migrate] applied 003_performance_tier.sql
[migrate] summary applied=1 skipped=3 failed=0
```

A fully-migrated DB later reads `applied=0 skipped=4 failed=0`. **Anything
with `failed>0` → stop and read the `[migrate] FAILED <file>: <exact error>`
line above it** (the boot continues; the affected feature simply stays OFF).