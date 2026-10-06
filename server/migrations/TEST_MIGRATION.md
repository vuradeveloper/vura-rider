# TEST_MIGRATION.md — Module 1 migration checklist (001 + 001b + rollback)

**Scope:** prove the SQL works BEFORE touching production. Run every step against
a **copy/snapshot** of the database, never against `vura-rider-prod` directly.

> These are the SQL checks the unit tests CANNOT make. `driverIndex.test.ts`
> mocks the database, so it proves the logic but not that Postgres accepts the
> statements. Everything below is what that gap covers.
>
> **Now partly automated:** `src/services/dispatch.integration.test.ts` runs
> steps 1 (001 applied twice), 5 (index created CONCURRENTLY + `indisvalid`
> post-check + enforced-23505 proof) and parts of 6/7 against a scratch
> Postgres (Docker) whenever `VURA_TEST_DB_PORT` is set. The remaining manual
> steps are the ones that need a COPY of real data: duplicate-seed detection
> (step 2-4 against production-shaped rows), the runtime smoke, and the full
> rollback cycle on a production snapshot.

---

## 0. Preconditions

- [ ] Take an RDS snapshot (or restore a copy of prod into a scratch DB):
      `aws rds create-db-snapshot --db-instance-identifier <ID> --db-snapshot-identifier vura-pre-module1-$(date +%Y%m%d)`
- [ ] Connect psql to the **copy**, with `ON_ERROR_STOP` on every run:
      `export DATABASE_URL='postgres://...'`
- [ ] Confirm current shape: `psql "$DATABASE_URL" -c "\dt"` — `driver_cells`,
      `app_config`, `driver_blocks`, `driver_metrics` must **NOT** exist yet.

---

## 1. Run `001_h3_driver_index.sql` on the copy

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql
```

- [ ] Exit code 0 (no error at the seed INSERT — the table create now precedes it).
- [ ] Re-run the same command a second time — exit code 0 again (fully idempotent).
- [ ] `psql "$DATABASE_URL" -c "\dt"` now lists `driver_cells`, `app_config`,
      `driver_blocks`, `driver_metrics`.
- [ ] `psql "$DATABASE_URL" -c "\d driver_cells"` shows PK on `user_id` and the two
      indexes `idx_driver_cells_cell`, `idx_driver_cells_fresh`.
- [ ] Config seed present:
      `SELECT key, value FROM app_config WHERE key = 'matching';` → one row,
      `h3_matching_enabled = false` (flag stays OFF until the rollout step
      turns it on deliberately), `stale_seconds = 40`, `h3_match_res = 8`.
- [ ] Re-running the seed does not duplicate: that SELECT still returns 1 row.

---

## 2. Seed a duplicate-offer violation (proves the pre-check actually detects)

The unique index in 001b only works if no driver holds two pending offers.
Deliberately create that state on the copy (UUIDs must exist in `users`/`rides`):

```sql
INSERT INTO ride_offers (id, ride_id, driver_id, status, expires_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), '<rideA>', '<driverUUID>', 'pending', NOW() + interval '15 s', NOW(), NOW()),
  (gen_random_uuid(), '<rideB>', '<driverUUID>', 'pending', NOW() + interval '15 s', NOW(), NOW());
```

- [ ] Both rows inserted (no unique index exists yet — that's expected).

---

## 3. Run the 001b PRE-CHECK — must show the duplicate

Run only the pre-check SELECT (the first statement in `001b_offer_unique_index.sql`):

```sql
SELECT driver_id, COUNT(*) AS pending_offers, array_agg(id ORDER BY created_at) AS offer_ids
  FROM ride_offers WHERE status = 'pending'
 GROUP BY driver_id HAVING COUNT(*) > 1;
```

- [ ] Returns **1 row** — the driver seeded in step 2, `pending_offers = 2`.

---

## 4. Run the FIX (expire the older offer, keep the newest)

Copy the `UPDATE ... FROM (SELECT ... ROW_NUMBER() ...)` block from the 001b
comments and run it in a transaction:

- [ ] The UPDATE reports 1 row affected.
- [ ] Re-run the pre-check from step 3 → **0 rows**.
- [ ] The newest offer is still `status = 'pending'`; the older one is
      `status = 'expired'` with `decline_reason = 'migration_duplicate_pending'`.

---

## 5. Apply the unique index (CONCURRENTLY — outside any transaction)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ride_offers_one_active_per_driver
     ON ride_offers (driver_id) WHERE status = 'pending';"
```

- [ ] Exit code 0.
- [ ] **Post-check — must be VALID, not INVALID:**

```sql
SELECT c.relname, i.indisvalid, i.indisready
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname = 'idx_ride_offers_one_active_per_driver';
```

- [ ] `indisvalid = true` AND `indisready = true`.
- [ ] Constraint actually enforced — a second pending offer for a driver who
      already has one now **fails**:

```sql
-- expect: ERROR: duplicate key value violates unique constraint
--         idx_ride_offers_one_active_per_driver
INSERT INTO ride_offers (id, ride_id, driver_id, status, expires_at, created_at, updated_at)
VALUES (gen_random_uuid(), '<rideC>', '<driverUUID>', 'pending', NOW() + interval '15 s', NOW(), NOW());
```

> **Do NOT wrap this step in `BEGIN`.** `CREATE UNIQUE INDEX CONCURRENTLY`
> cannot run inside a transaction block. psql autocommits each statement, so
> running the file directly is fine — but if an attempt ever leaves an INVALID
> index behind, drop it first:
> `DROP INDEX CONCURRENTLY IF EXISTS idx_ride_offers_one_active_per_driver;`

---

## 6. Runtime smoke (on the copy)

- [ ] Point a dev server at the copy, start it, confirm no startup errors.
- [ ] `SELECT count(*) FROM driver_cells;` starts at 0 and grows once a driver
      app sends a location ping.
- [ ] Kill switch works:
      `UPDATE app_config SET value = jsonb_set(value, '{h3_matching_enabled}', 'false') WHERE key = 'matching';`
      → server falls back to haversine within ~10s (config cache TTL);
      flip back to `'true'`.

---

## 7. Rollback test — prove we can get out

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.rollback.sql
```

- [ ] Exit code 0. (Part A: `DROP INDEX CONCURRENTLY` runs first, outside the
      transaction; Part B then runs BEGIN/COMMIT.)
- [ ] `\dt` — `driver_cells`, `app_config`, `driver_blocks`, `driver_metrics` gone.
- [ ] `driver_profiles.performance_tier` column gone.
- [ ] `idx_ride_offers_one_active_per_driver` gone.
- [ ] Pre-existing tables (`rides`, `ride_offers`, `users`, `driver_profiles`)
      **untouched** — row counts unchanged.
- [ ] Re-run 001 afterwards → succeeds again (apply → rollback → apply works on
      the same copy, so neither direction is destructive to shared data).

---

## Sign-off

| Step | Done by | Date |
|------|---------|------|
| 001 on copy (twice) | | |
| Duplicate seed + 001b pre-check sees it | | |
| FIX → pre-check 0 rows | | |
| Index applied, indisvalid = true, constraint enforced | | |
| Kill switch toggles | | |
| Rollback + re-apply | | |

**Only after all boxes above: run 001 and 001b against production**
(in that order, snapshot taken first, 001b outside any wrapping transaction).
