# DEPLOY_MODULE2.md — deploy Module 2 (Set Destination) on top of RC1

**Branch:** `module2-destination` @ `11b2f59` = `release-candidate-1` (ancestor)
+ the Module 2 series (`4a`…`4g`, `4c-fix`, and the `4h` review fixes 1–5).
**Target:** the same EB environment as RC1 — `vura-rider-prod`, `af-south-1`,
**min=max=1 instance**.

> **This document deploys. It does not merge and it does not touch
> `vura-driver`.** The driver-app Set-Destination UI ships separately; the
> server goes first with both flags OFF, is verified invisible, then rolled out
> per driver. `module2-destination` stays a branch until a deliberate merge.

**Order matters:** `DEPLOY_RC1.md` first (Module 1 must be live and verified —
`MODULE2_TEST.md` §0 requires it). This document is only what comes after.

---

## 1. Preflight gates (from the branch, on your machine)

```powershell
git checkout module2-destination && git pull
git --no-pager log --oneline -1           # expect 11b2f59 ...
cd server
npx tsc --noEmit                           # 0 errors
npx vitest run                             # 155 passed / 9 skipped (skip = real-PG only)
```

### 1a. Rebuild and COMMIT `server/dist` (hard gate)

The EB hooks never run `tsc` — **`server/dist` is the deployed artefact** and
it has never been built for Module 1 or Module 2 (last build: `1f3a4c9`).
Deploying without this step ships months-old code with a green test run.

```powershell
cd server
npm run build
git add dist && git commit -m "deploy: rebuild server/dist for Module 2 (11b2f59)"
git status --porcelain server/dist         # from repo root — must be CLEAN
```

## 2. Database: apply `002_destination_mode.sql`

Additive only (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`), idempotent —
apply **after a snapshot**:

```bash
aws rds create-db-snapshot --db-instance-identifier <ID> \
  --db-snapshot-identifier vura-pre-module2-$(date +%Y%m%d)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/002_destination_mode.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/002_destination_mode.sql   # must exit 0 again
```

Verify (checklist: `server/migrations/TEST_MIGRATION.md` §002):

```sql
SELECT key, value FROM app_config WHERE key = 'destination';
--   exactly 1 row, destination_matching_enabled = false,
--   destination_rollout_driver_ids = [],
--   destination_max_minutes_without_trip = 180,
--   destination_offline_grace_seconds = 300,
--   destination_arrival_radius_km = 0.5, destination_reject_radius_km = 1
SELECT column_name FROM information_schema.columns
 WHERE table_name='driver_profiles' AND column_name LIKE 'destination\_%';  -- 5 columns
SELECT column_name FROM information_schema.columns
 WHERE table_name='destination_sessions' AND column_name IN
       ('destination_expires_at','trips_completed','end_reason','sast_day');  -- 4 columns
SELECT COUNT(*) FROM information_schema.tables
 WHERE table_name IN ('destination_sessions','destination_events');           -- 2 tables
```

Rollback script: `server/migrations/002_destination_mode.rollback.sql`
(additive; destroys session history — `pg_dump destination_sessions destination_events` first).

## 3. Deploy

```bash
git checkout module2-destination
bash deploy/deploy.sh vura-rider-prod      # eb deploy --label vura-<short>-<ts>
```

## 4. Verify — invisible first, then roll out

1. **Boot:** `/health` ok; `[offerWorker] started (2s tick · …)`; the
   single-instance WARNING; instance count still **1**.
2. **Flags are OFF → feature invisible:** run **`MODULE2_TEST.md` §1** —
   activation → 403 `disabled`, `destination_sessions` empty, no
   `destination_filter` trace stage, matching byte-identical to Module 1.
3. **Full manual pass:** `MODULE2_TEST.md` §0–§9 on this instance
   (open rollout §2 → happy path §3 → rules §4 → socket §5 → matching §6 →
   auto-end sweep incl. ping arrival, grace-offline, idle timer, L7e
   `feature_disabled` §7 → completed-trip reset §7b → counters §8 →
   single-instance §9).
4. **Rollout:** keep `destination_matching_enabled=true` and grow
   `destination_rollout_driver_ids` one driver at a time (config cache ~10 s).
   Watch `GET /debug/counters`: `destination_activated`, `destination_ended`,
   `destination_filtered`, and **`destination_predicate_error` (must stay 0 —
   fail-closed)**; logs `[offerWorker] auto-ended N destination session(s)` and
   `[dispatch] destinationFit threw` (must not appear).

**What the `4h` review commits added** (all covered by the tests above):
offline end requires explicit offline or 300 s of heartbeat silence
(`destination_offline_grace_seconds`); arrival runs on **every GPS ping** with
the ~30 s sweep as backup, both closing through one row-guarded `closeSession`;
the idle timer is `destination_max_minutes_without_trip` (180 min) and **resets
on every completed trip** (`trips_completed++`, `destination_expires_at` on the
session row); flag-off / allowlist removal mid-session → status
`paused:true` + sweep end `feature_disabled`.

## 5. Rollback ladder (fastest → fullest)

1. **Kill switch, no redeploy (seconds):**
   ```sql
   UPDATE app_config SET value = jsonb_set(value, '{destination_matching_enabled}', 'false')
    WHERE key = 'destination';
   -- optionally: jsonb_set(..., '{destination_rollout_driver_ids}', '[]')
   ```
   Activation → 403; the next sweep (~30 s) ends every live session with
   `end_reason='feature_disabled'` + push; status shows `paused:true` until
   then; predicate and trace stage disappear (MODULE2_TEST “Rollback” section).
2. **Manual session clear (instant override):** the `UPDATE destination_sessions
   SET ended_at=NOW(), end_reason='cancelled' …` + profile-wipe SQL in
   `MODULE2_TEST.md` “Rollback for this step”.
3. **Schema (last resort):** `psql … -f server/migrations/002_destination_mode.rollback.sql`
   after the pg_dump — removes only Module 2 objects, never Module 1’s.
4. **Code:** redeploy the RC1 build (`DEPLOY_RC1.md` §3 — rebuild `dist` to
   match `12ae348`).

## 6. Hard requirements carried over from RC1

- **One instance only** (min=max=1, no rolling batch): no socket.io adapter;
  the destination sweep has a per-process overlap guard only — two instances
  would double-end sessions and double-push.
- Migrations are **manual** (psql) — nothing applies them at boot.
- Never commit scratch files (`_*.md`, `_*.ps1`, `server/_*.mjs`…) — the repo
  root carries working notes that must stay untracked.

