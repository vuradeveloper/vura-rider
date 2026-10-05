-- ═══════════════════════════════════════════════════════════════════════════
-- 001b — ONE ACTIVE OFFER PER DRIVER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ RUN THIS SEPARATELY FROM 001, WITH --single-transaction OMITTED.
--
-- WHY IT IS NOT IN 001
--
-- This uses CREATE UNIQUE INDEX CONCURRENTLY, which PostgreSQL refuses to run
-- inside a transaction block:
--
--     ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--
-- 001 is wrapped in BEGIN/COMMIT, so the index had to move out. CONCURRENTLY is
-- worth it here: this index is built on an EXISTING, possibly large ride_offers
-- table, and a plain CREATE INDEX would take a ShareLock that blocks every
-- INSERT/UPDATE for the duration of the build. CONCURRENTLY builds it without
-- blocking writes, and skips rows that are already invalid.
--
-- HOW TO RUN (exact commands)
--
--   1. Back up first:
--        aws rds create-db-snapshot \
--          --db-instance-identifier <ID> \
--          --db-snapshot-identifier vura-pre-module1-$(date +%Y%m%d)
--
--   2. Apply 001 (tables + config), normally:
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_h3_driver_index.sql
--
--   3. Run the PRE-CHECK below. If it returns rows, run the FIX, then re-run it.
--
--   4. ONLY THEN apply this file:
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001b_offer_unique_index.sql
--
--   5. Verify:
--        psql "$DATABASE_URL" -c "\di idx_ride_offers_one_active_per_driver"
--
-- STEP 3 — PRE-CHECK: drivers holding two or more 'pending' offers
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected on a healthy database: ZERO rows.
SELECT driver_id,
       COUNT(*)                AS pending_offers,
       array_agg(id ORDER BY created_at) AS offer_ids,
       MIN(created_at)         AS oldest,
       MAX(created_at)         AS newest
  FROM ride_offers
 WHERE status = 'pending'
 GROUP BY driver_id
HAVING COUNT(*) > 1;
--
-- IF IT RETURNS ROWS
--
-- The index cannot be created while a driver holds two live offers. Expire the
-- duplicates, KEEPING THE NEWEST for each driver (that driver's phone is still
-- showing a countdown, so their offer must stay valid):
--
--   BEGIN;
--   UPDATE ride_offers ro
--      SET status        = 'expired',
--          decline_reason= 'migration_duplicate_pending',
--          updated_at    = NOW()
--     FROM (
--       SELECT id FROM (
--         SELECT id,
--                ROW_NUMBER() OVER (
--                  PARTITION BY driver_id ORDER BY created_at DESC, id DESC
--                ) AS rn
--           FROM ride_offers
--          WHERE status = 'pending'
--       ) ranked
--       WHERE ranked.rn > 1
--     ) dupes
--    WHERE ro.id = dupes.id;
--   COMMIT;
--
-- Notes on that UPDATE:
--   * 'expired' is already in the status CHECK constraint
--     (index.ts:490: CHECK (status IN ('pending','accepted','declined','expired'))).
--   * 'migration_duplicate_pending' is 26 chars and fits decline_reason VARCHAR(60).
--   * The tiebreaker (id DESC) makes it deterministic when two offers share a
--     created_at, so re-running is safe.
--   * Nothing is deleted; the rows are kept for the audit trail.
--
-- Re-run the PRE-CHECK afterwards. It must return zero rows.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE INDEX ITSELF — run LAST, outside any transaction
-- ═══════════════════════════════════════════════════════════════════════════
-- This is the guarantee the Redis SET NX lock was meant to provide, done
-- properly. A partial unique index is transactional and, unlike a Redis TTL
-- lock, cannot expire mid-offer. Two concurrent accepts for one driver: the
-- second INSERT raises a unique violation and that driver is never offered twice.
--
-- CONCURRENTLY + IF NOT EXISTS together are safe. If a prior attempt left an
-- INVALID index behind (an interrupted build), PostgreSQL will NOT rebuild it --
-- drop it first:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_ride_offers_one_active_per_driver;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ride_offers_one_active_per_driver
  ON ride_offers (driver_id)
  WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════
-- POST-CHECK — the index must be VALID, not INVALID.
-- An interrupted CONCURRENTLY build leaves an INVALID index that is silently
-- NOT enforcing the constraint. Verify:
-- ═══════════════════════════════════════════════════════════════════════════
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE indexname = 'idx_ride_offers_one_active_per_driver';
--
--   SELECT c.relname AS index_name, i.indisvalid, i.indisready
--     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--    WHERE c.relname = 'idx_ride_offers_one_active_per_driver';
--
-- Expected: indisvalid = true AND indisready = true.
-- If indisvalid is false, the build failed or was interrupted: drop and re-run.
--
-- ROLLBACK (also cannot run inside a transaction):
--   DROP INDEX CONCURRENTLY IF EXISTS idx_ride_offers_one_active_per_driver;