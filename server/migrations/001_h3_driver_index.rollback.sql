-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK FOR 001_h3_driver_index
--
-- Removes ONLY objects created by that migration. It cannot touch data that
-- predates Module 1, so it is safe to run at any time.
--
-- ⚠ RUN THE KILL-SWITCH UPDATE FIRST if H3 matching is currently enabled,
--   otherwise the running server keeps writing to driver_cells between the
--   UPDATE and the DROP.
--
--   psql -h HOST -U USER -d DBNAME -f 001_h3_driver_index.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — RUN FIRST, ON ITS OWN. MUST NOT be inside a transaction.
-- ═══════════════════════════════════════════════════════════════════════════
-- DROP INDEX CONCURRENTLY cannot run inside a transaction block, so it is
-- deliberately OUTSIDE the BEGIN/COMMIT used by Part B. Running this file as a
-- whole is correct: psql commits each top-level statement on its own.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 001_h3_driver_index.rollback.sql
--
-- Dropping this index RESTORES the pre-Module-1 behaviour, where two drivers
-- could hold pending offers for the same ride.
DROP INDEX CONCURRENTLY IF EXISTS idx_ride_offers_one_active_per_driver;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — everything else, transactional.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Stop H3 matching. The app now falls back to the original haversine query,
--    which reads driver_profiles and is entirely unaffected by this migration.
UPDATE app_config
   SET value = jsonb_set(value, '{h3_matching_enabled}', 'false'),
       updated_at = NOW()
 WHERE key = 'matching';

-- 3. Module 3 scaffolding (empty tables/columns; nothing depends on them yet).
DROP TABLE IF EXISTS driver_metrics;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS performance_tier;

-- 4. New tables from this migration.
DROP TABLE IF EXISTS driver_blocks;
DROP TABLE IF EXISTS app_config;      -- removes the seeded config with it
DROP TABLE IF EXISTS driver_cells;   -- last: cascades idx_driver_cells_*

COMMIT;

-- ── After rollback, restore the default threshold if you want the OLD
--    hardcoded behaviour back exactly (LOCATION_FRESH_SECONDS was 30s before
--    Module 1's work; Module 1 set it to 20s, and Q7 asks for 40s until the 4s
--    heartbeat APK ships). Adjust in dispatch.ts / the H3 config as needed.