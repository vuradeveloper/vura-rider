# DEPLOY_RC1.md — deploy `release-candidate-1` to production

**Branch:** `release-candidate-1` @ `12ae348` (18 commits ahead of `main`,
already on `origin`).
**Target:** AWS Elastic Beanstalk, environment `vura-rider-prod`, region
`af-south-1`, **min=max=1 instance** (hard requirement — see §5).

RC1 = Module 1 (H3 matching + rollout control) + offer-delivery hardening +
push-delivery fixes + the real-Postgres migration guard + the single-instance
boot warning. It contains **no new migration** (001/001b already applied when
Module 1 was prepared — verify, don't re-run blindly).

> **This document deploys. It does not merge.** `release-candidate-1` stays a
> branch; merging into `main` is a separate, deliberate decision after the
> verification run passes.

---

## 1. Preflight gates (run on your machine, from the branch)

```powershell
git checkout release-candidate-1 && git pull
git --no-pager log --oneline -1          # expect 12ae348 ...
cd server
npx tsc --noEmit                          # type gate — must be 0 errors
npx vitest run                            # mocked suite — all green, no DB needed
# real-Postgres suite (optional but recommended, needs the scratch container):
$env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/dispatch.integration.test.ts
```

### 1a. Rebuild and COMMIT `server/dist` — the single most-missed step

**The EB hooks never run `tsc`; `server/dist` is the deployed artefact and it
is tracked in git.** As of writing, `dist` was last built at `1f3a4c9` — it
predates Module 1 entirely, so deploying without a rebuild ships months-old
code with a green test run.

```powershell
cd server
npm run build
git status --porcelain dist               # must show changes (it is stale)
git add dist && git commit -m "deploy: rebuild server/dist for RC1 (12ae348)"
git status --porcelain server/dist        # from repo root — must be CLEAN now
```

Ship `node_modules` note: `.ebignore` re-includes `server/node_modules` so a
fresh instance boots without a 100 MB install — only pure-JS packages are safe
there (the `sharp`/`@img/sharp-win32-x64` trap from `_LIVE_STATE.md`; both EB
hooks verify `sharp` can actually **encode** — if that guard fails, the deploy
is not done).

## 2. Database preflight (read-only checks, prod)

Migrations are applied **manually with psql** — nothing at boot runs them.

```sql
-- 001 + 001b must already exist (Module 1 prep):
SELECT key FROM app_config WHERE key = 'matching';          -- 1 row
SELECT h3_matching_enabled, h3_rollout_mode FROM app_config WHERE key='matching';
--   seed was false/'off'; whatever it is NOW is the live rollout state
SELECT COUNT(*) FROM information_schema.tables
 WHERE table_name IN ('driver_cells','driver_blocks','driver_metrics');  -- 3
-- 001b unique index present:
SELECT indexname FROM pg_indexes WHERE tablename='ride_offers'
 AND indexname = 'idx_ride_offers_one_active_per_driver';       -- 001b unique index
```

Take a snapshot first if anything is unexpected:
`aws rds create-db-snapshot --db-instance-identifier <ID> --db-snapshot-identifier vura-pre-rc1-$(date +%Y%m%d)`.

Full checklist: `server/migrations/TEST_MIGRATION.md` (§0–§4).

## 3. Deploy

```bash
git checkout release-candidate-1
bash deploy/deploy.sh vura-rider-prod     # = eb deploy --label vura-<short>-<ts>
```

The wrapper strips local `/`-containing tags (they break EB's version-label
constraint) and always passes its own slash-free label.

## 4. Verify (on the instance / against the URL)

| Check | Expect |
|---|---|
| `curl https://<host>/health` | `{"status":"ok",...}` |
| boot log | `[offerWorker] started (2s tick · offer TTL 15s · driver stale 45s)` |
| boot log | instance id line + `WARNING: multi-instance delivery is unsupported until a socket.io adapter exists` |
| `GET /api/dev/diag?key=$DEV_LOG_READ_KEY` | answers; `sharp.loads=true`; dispatch/queue blocks present (wrong key → `401 {"error":"bad read key"}`; missing route → `404 {"error":"Route not found"}`) |
| `GET /debug/counters` | reachable; offer counters moving when a ride is booked |
| EB console | exactly **1** instance, deploy version = `vura-12ae348-<ts>` |

Then run **`MODULE1_TEST.md` §1–§6** end-to-end (driver online → GPS ping →
flag on → offer → accept → trace). Only after it passes, do the Module 1
rollout flip (§5 of that file) if it is not already rolled out.

## 5. Single instance — hard requirement

Elastic Beanstalk **min=max=1**, never a rolling batch with an extra instance:
there is no socket.io adapter, and `offerWorker` + the destination sweep have
only per-process overlap guards — two instances would double-tick them and
double-deliver offers.

## 6. Rollback (fastest → fullest)

1. **Config kill switch (seconds, no redeploy):**
   ```sql
   UPDATE app_config SET value = jsonb_set(value, '{h3_matching_enabled}', 'false')
    WHERE key = 'matching';   -- cache picks it up in ~10 s
   ```
   Matching falls back to the pre-Module-1 path (flag-OFF equivalence is unit-tested).
2. **Redeploy the previous build:** `bash deploy/deploy.sh` from the last known
   good commit, or pick the previous version label in the EB console and
   "Deploy". Remember to rebuild `server/dist` to match whatever you deploy.
3. **Schema (last resort, snapshot first):** `001b` then `001` rollback scripts
   (`server/migrations/*.rollback.sql`) — only when the schema itself must go;
   the H3 index rebuilds itself from the next GPS ping.

## 7. Known pre-existing issues — NOT fixed by RC1

From `_LIVE_STATE.md` (verify on the live instance after deploy): the CarsXE
photo budget may be exhausted (`carsxe.budget.blocked=true` — raise the cap or
upgrade the plan; no deploy fixes it), and the local diag read key is the
instance's `DEV_LOG_READ_KEY`, not the repo fallback.
