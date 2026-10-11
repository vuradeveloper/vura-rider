# DEPLOY_RC3.md — deploy `release-candidate-3` to production (console-first)

> **Console-first:** every step below is an AWS **console** action first; the
> CLI line is given as the reference/alternative. The deploy itself follows
> `FINAL_PREFLIGHT.md` for environment/health navigation.

**Branch (rider):** `release-candidate-3` — record the real tip before doing
anything: `git rev-parse --short HEAD` (authoring tip: `5c3dacb`, plus the
RC3 doc commits). **Branch (driver):** `vura-driver` `release-candidate-3`
(authoring tip: `606b46e`) — ships as an APK, **not** via EB.

**Target:** Elastic Beanstalk `vura-rider-prod`, region `af-south-1`,
**min=max=1 instance** (§6). **One new migration: `003_performance_tier.sql`.**

**What RC3 adds:** Module 3 performance tier (flag **OFF** by seed), driver
Tier screen + RC3 APK (versionCode 2), env-driven provider seams with boot
logging (no public demo in production), and this release's docs.

> **This document deploys. It does not merge.** `release-candidate-3` stays a
> branch in BOTH repos; merging to `main` is a separate, deliberate decision
> after `LAUNCH_TEST.md` passes. No keystore, appId, permission or signing
> changes ship anywhere in RC3.

---

## 1. Preflight gates (your machine, from the branch)

```powershell
git checkout release-candidate-3 && git pull
git --no-pager log --oneline -1            # RECORD this SHA — it is the truth

cd server
npx tsc --noEmit                           # type gate — 0 errors
npx vitest run                             # mocked suite — 200 passed / 12 skipped
# real-Postgres suite (scratch container running, optional but recommended):
$env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/dispatch.integration.test.ts   # 17/17
Set-Location ..
node _legacycheck.mjs                      # must print IDENTICAL=true vs main

cd ..\vura-driver\figma-ui                  # driver repo, sibling checkout
npm test                                    # 26 passed / 0 failed
npx tsc --noEmit                           # 0 errors
```

Any red → stop, fix, commit, re-run. Never deploy around a gate.

### 1a. Rebuild and COMMIT `server/dist` — the single most-missed step

**The EB hooks never run `tsc`; `server/dist` IS the deployed artefact and it
is tracked in git.** RC3's commits include dist, but a rebuild after any later
commit is mandatory:

```powershell
cd server ; npm run build
git add dist ; git commit -m "deploy: rebuild server/dist for RC3 deploy"
git status --porcelain server/dist          # from repo root — must be CLEAN
```

### 1b. HARD GATE — `dist gate OK` (**checklist FAILS here otherwise**)

Both checks from `server/` (git pathspecs resolve relative to cwd). Full
reasoning + failure incident: `DEPLOY_RC1.md` §1b.

```powershell
# CHECK 1 — committed dist is byte-identical to a fresh build of committed src.
cd server ; npm run build
$diff = git status --porcelain dist
if ($diff) { Write-Error "FAIL: dist differs from a fresh build — commit it (§1a)"; exit 1 }

# CHECK 2 — dist does not predate the newest src commit.
$srcT  = [int](git log -1 --format=%ct -- src)
$distT = [int](git log -1 --format=%ct -- dist)
if ($distT -lt $srcT) { Write-Error "FAIL: dist predates src — §1a"; exit 1 }
Write-Host "dist gate OK"
```

Do not continue until you have `dist gate OK`.

## 2. Database preflight + migration 003 (console-first)

**Order rule (fresh environment only):** `001` → `001b` (**single statement,
NO wrapping transaction — `CREATE INDEX CONCURRENTLY`**) → `002` → `003`.
Production already has 001/001b/002 (verify, never re-run blindly); **RC3
applies only `003`.**

1. **Snapshot first** (RDS console → Actions → Take snapshot), or
   `aws rds create-db-snapshot --db-instance-identifier <ID> --db-snapshot-identifier vura-pre-rc3-$(date +%Y%m%d)`.
2. Read-only checks (Query tool, autocommit ON, `ON_ERROR_STOP` in psql):
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename='ride_offers'
     AND indexname='idx_ride_offers_one_active_per_driver';   -- 001b present
   SELECT key FROM app_config WHERE key IN ('matching','destination');  -- both rows
   SELECT count(*) FROM app_config WHERE key='performance_tier';        -- 0 = not applied yet
   ```
3. Apply **003** (psql, run the FILE twice — idempotent by design):
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/003_performance_tier.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/003_performance_tier.sql   # exit 0 again
   ```
   (pgAdmin/DBeaver: open the file, Execute with autocommit ON — no BEGIN.)
4. Verify seeds:
   ```sql
   SELECT tier, rank FROM performance_tier_thresholds ORDER BY rank;  -- bronze..platinum
   SELECT value->>'performance_tier_enabled' FROM app_config WHERE key='performance_tier';  -- "false"
   ```
Full checklist: `server/migrations/TEST_MIGRATION.md` § 003.

## 3. Environment properties preflight (EB console → Configuration → Software)

RC3 makes the provider seams production-strict (`PLAN_PUBLIC_SERVERS.md`) —
verify BEFORE deploying so the boot log comes up clean:

| Property | State |
|---|---|
| `ROUTE_PROVIDER_URL` | must be SET (self-hosted OSRM per `deploy/SELFHOST-MAPS.md`) — unset in production now means `/api/route` answers 503 |
| `NOMINATIM_URL` | set if the geocode fallback is wanted without HERE; unset only acceptable while `HERE_API_KEY` stays healthy |
| `SHARE_TILE_URL` | **new** — set it if the trip-share page should show raster tiles from your own tile server; unset = grey map + markers (never public OSM tiles from production) |
| `SEARCH_PROVIDER` | optional: `here` / `nominatim`; unset = HERE → Nominatim |
| `HERE_API_KEY`, `FIREBASE_*`, `DB_*`, `PAYSTACK_*`, `ALLOWED_ORIGINS`, `ADMIN_EMAILS`, `DEV_LOG_*` | unchanged from RC1/Module2 state (see `FINAL_PREFLIGHT.md` env table) |

Module 3 needs **no env var** — its flag is the DB row seeded `false` in 003.

## 4. Deploy (console-first)

1. EB console → `vura-rider-prod` → **Upload and deploy** (or Versions →
   Deploy the RC3 label) — **All-at-once** (single instance, §6).
2. CLI equivalent: `bash deploy/deploy.sh vura-rider-prod` from the branch
   (wrapper strips illegal `/` labels).
3. Record the version label (`vura-<short>-<ts>`); Events page must finish
   **Green** with no health-grace failures.

## 5. Verify (console + URL + device)

| Check | Expect |
|---|---|
| EB → Dashboard | health **Green**, **exactly 1** instance, version = RC3 label |
| `curl https://<host>/health` | `{"status":"ok",...}` |
| Boot log | `[offerWorker] started … build <rc3-sha>` (matches §1 SHA) |
| Boot log | **`[providers]` table: every seam `(env)`** — any `NOT CONFIGURED` line means §3 was skipped → fix env, redeploy |
| Boot log | single-instance WARNING still present; NO `[tier] recalc` lines (flag off = silent) |
| `GET /api/dev/diag?key=$DEV_LOG_READ_KEY` | answers; `sharp.loads=true` |
| SQL | `SELECT count(*) FROM performance_tier_runs;` → 0; `driver_tiers` empty (flag off) |
| Ride smoke | book → offer → accept → complete end-to-end (`LAUNCH_TEST.md` §1–§2) |
| Device APK | install `vura-driver-rc3-release-signed.apk` (versionCode 2); `STAGE_ALL_MANUAL_TEST.md` A + T1 (Tier button absent while flag off) |
| Driver repo gates | `npm test` 26/26, `tsc --noEmit` 0 — recorded in §1 |

Then run **`LAUNCH_TEST.md`** end-to-end; Module 3 stays flag-OFF at launch
(rollout order lives in `MODULE3_TEST.md` §3 and is a deliberate later step).

## 6. Single instance — hard requirement (unchanged from RC1)

EB **min=max=1**, never a rolling batch with an extra instance: no socket.io
adapter; `offerWorker`, the destination sweep and the tier scheduler have
per-process guards only (the tier run-ledger is DB-backed, but two instances
would still double-tick everything else).

## 7. Rollback (fastest → fullest)

1. **Module 3 kill switch (seconds, no redeploy):**
   ```sql
   UPDATE app_config SET value = jsonb_set(value, '{performance_tier_enabled}', 'false')
     WHERE key='performance_tier';            -- ~10 s cache; recalc/tie-break/screens all inert
   -- or hide only the screens: empty the allowlist array in the same row.
   ```
2. **Provider seam escape (seconds):** set the missing env var in the EB
   console (503s stop as soon as the property applies) — you never "fix" this
   by pointing at a public demo in production.
3. **Redeploy the previous version:** EB console → Versions → previous label →
   Deploy (rebuild `server/dist` to match whatever commit you roll back to).
4. **Schema (last resort, snapshot first):** `003_performance_tier.rollback.sql`
   (drops the three Module-3 tables + config row; 001/001b/002 untouched).
5. **APK:** devices keep versionCode 2 (flag switches already cover behaviour);
   downgrade needs `adb install -r` of an older signed APK — avoid.

## 8. Ordered command checklist (the whole deploy, copy-paste)

```powershell
# ── 0. Record what you are shipping ──────────────────────────────────────
git checkout release-candidate-3 && git pull
$RIDER = git rev-parse --short HEAD; Write-Host "rider SHA: $RIDER"

# ── 1. Gates (machine) ──────────────────────────────────────────────────
cd server
npx tsc --noEmit                      # expect: silent, exit 0
npx vitest run                        # expect: 200 passed / 12 skipped
# optional real Postgres:
#   $env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/dispatch.integration.test.ts  # 17/17
Set-Location ..
node _legacycheck.mjs                 # expect: [main(...) vs HEAD] IDENTICAL=true
cd ..\vura-driver\figma-ui
npm test                              # expect: 26 passed / 0 failed
npx tsc --noEmit                      # expect: silent, exit 0
Set-Location ..\vura-rider

# ── 2. dist gate ────────────────────────────────────────────────────────
cd server
npm run build
git add dist; git commit -m "deploy: rebuild server/dist for RC3 deploy"
$diff = git status --porcelain dist; if ($diff) { throw "FAIL dist differs" }
$srcT = [int](git log -1 --format=%ct -- src); $distT = [int](git log -1 --format=%ct -- dist)
if ($distT -lt $srcT) { throw "FAIL dist predates src" }
Write-Host "dist gate OK"
Set-Location ..

# ── 3. Database (take an RDS snapshot FIRST in the console) ─────────────
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/003_performance_tier.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/003_performance_tier.sql   # exit 0 again
psql "$DATABASE_URL" -c "SELECT tier FROM performance_tier_thresholds ORDER BY rank;"   # 4 rows
psql "$DATABASE_URL" -c "SELECT value->>'performance_tier_enabled' FROM app_config WHERE key='performance_tier';"  # false

# ── 4. Environment (EB console, §3): verify ROUTE_PROVIDER_URL /
#       NOMINATIM_URL / SHARE_TILE_URL — then push and deploy ─────────────
git push origin release-candidate-3
bash deploy/deploy.sh vura-rider-prod          # or: console → Upload and deploy

# ── 5. Verify ───────────────────────────────────────────────────────────
curl https://api.ridevura.com/health           # {"status":"ok"...}
# boot log: [providers] table = all "(env)", NO [tier] recalc lines, build = $RIDER
# then run: LAUNCH_TEST.md §0-§2 + figma-ui/STAGE_ALL_MANUAL_TEST.md (flag-off cases)
```


