-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE 1 — H3 DRIVER INDEXING
-- ADDITIVE ONLY. Creates new tables and indexes. Drops, renames and rewrites
-- NOTHING on an existing table. Safe to run against live traffic.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ TAKE AN RDS SNAPSHOT FIRST.
--
-- WHY THIS IS SAFE TO RUN ON A LIVE DATABASE
--
-- 1. CREATE TABLE IF NOT EXISTS  — brand-new tables. No lock on rides,
--    ride_offers or driver_profiles. Zero impact on the booking path.
-- 2. CREATE INDEX IF NOT EXISTS  — CONCURRENTLY would avoid even a brief
--    lock, but it cannot run inside a transaction block. On brand-new,
--    empty tables there is nothing to lock and nothing to read, so a plain
--    CREATE INDEX is instant and cannot block a ride.
-- 3. ALTER TABLE ... ADD COLUMN IF NOT EXISTS — only ever adds. Postgres
--    takes an ACCESS EXCLUSIVE lock, but only for the duration of a
--    metadata-only change (milliseconds, no table rewrite).
-- 4. Every statement is independently re-runnable. No DROP, no TRUNCATE,
--    no UPDATE on an existing table, no NOT NULL without a default.
--
-- rides.tier and driver_profiles.tier are deliberately LEFT ALONE. They are
-- dead columns, cleaned up in a separate migration after Module 3.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Driver live position, indexed by H3 cell ────────────────────────────
-- One row per driver (not one per cell). Per-cell membership in Redis was the
-- original design; Postgres answers the same query transactionally and with no
-- extra infrastructure. See services/driverIndex.ts for the interface that lets
-- a Redis implementation be dropped in later.
CREATE TABLE IF NOT EXISTS driver_cells (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cell_res8    VARCHAR(20) NOT NULL,
  -- Populated now so the Phase 2 heatmap is only a GROUP BY later (Q10).
  cell_res7    VARCHAR(20),
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  heading      DOUBLE PRECISION,
  status       VARCHAR(20) NOT NULL,
  tier         VARCHAR(20),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Matching asks: "which drivers are in these cells, and are they fresh?"
CREATE INDEX IF NOT EXISTS idx_driver_cells_cell
  ON driver_cells (cell_res8, last_seen_at);

-- The eviction sweep asks: "who has gone quiet?"
CREATE INDEX IF NOT EXISTS idx_driver_cells_fresh
  ON driver_cells (last_seen_at);

-- ── 2. Runtime configuration (thresholds live here, never in code) ─────────
-- MUST be created here, BEFORE the seed INSERT at the bottom of this file --
-- the seed runs against this table, so on a fresh database the create has to
-- come first (ON_ERROR_STOP would otherwise abort at the seed).
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Rider blocks a driver (Q9: new, no UI yet) ─────────────────────────
CREATE TABLE IF NOT EXISTS driver_blocks (
  rider_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rider_id, driver_id)
);

-- Reverse lookup is never needed (we only ask "has rider X blocked Y?"), so
-- the composite primary key above is the only index required.

-- ── 4. One active offer per driver ────────────────────────────────────────
-- DELIBERATELY NOT HERE. This index uses CREATE UNIQUE INDEX CONCURRENTLY,
-- which CANNOT run inside a transaction block, and this file is wrapped in
-- BEGIN/COMMIT. It lives in 001b_offer_unique_index.sql instead.
--
-- If any row already violates the rule the index creation fails, surfacing real
-- bad data instead of hiding it. Run the pre-check in 001b before applying.

-- ── 5. Performance tier (Module 3) ────────────────────────────────────────
-- Added now, empty, so Module 3 never has to alter a live table.
CREATE TABLE IF NOT EXISTS driver_metrics (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_days       INTEGER NOT NULL DEFAULT 90,
  completed_trips   INTEGER NOT NULL DEFAULT 0,
  offers_received   INTEGER NOT NULL DEFAULT 0,
  offers_accepted   INTEGER NOT NULL DEFAULT 0,
  driver_cancels    INTEGER NOT NULL DEFAULT 0,
  rating_avg        NUMERIC(3,2) NOT NULL DEFAULT 0,
  ratings_count     INTEGER NOT NULL DEFAULT 0,
  points            INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS performance_tier VARCHAR(20) DEFAULT 'bronze';

COMMIT;

-- ── Seed defaults ─────────────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING: re-running never clobbers tuned values.
INSERT INTO app_config (key, value) VALUES
  ('matching', '{
    "h3_matching_enabled": false,
    "h3_rollout_mode": "off",
    "h3_rollout_rider_ids": [],
    "h3_rollout_percent": 0,
    "match_radius_km": [3, 5, 7],
    "search_timeout_ms": 90000,
    "still_looking_msg_ms": 30000,
    "h3_match_res": 8,
    "h3_heatmap_res": 7,
    "stale_seconds": 40,
    "max_position_age_seconds": 300,
    "offer_ttl_seconds": 15,
    "avg_speed_kmh": 40,
    "min_driver_rating": 0,
    "required_vehicle_category": null
  }')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- POST-MIGRATION VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--   SELECT key, value FROM app_config;
--   SELECT count(*) FROM driver_cells;        -- expect 0; filled at runtime
--
-- ── INSTANT KILL SWITCH ───────────────────────────────────────────────────
-- If H3 matching misbehaves in production, revert to the original haversine
-- matching with no redeploy:
--
--   UPDATE app_config
--      SET value = jsonb_set(value, '{h3_matching_enabled}', 'false')
--    WHERE key = 'matching';
--
-- Takes effect within ~10s (the config cache TTL). Restore with 'true'.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK  (also valid as migrations/001_h3_driver_index.rollback.sql)
-- Safe at any time. Removes only objects THIS migration created.
--
--   BEGIN;
--   -- Flip the switch off FIRST if matching is still enabled, so the app
--   -- falls back to haversine and stops writing to driver_cells.
--   UPDATE app_config
--      SET value = jsonb_set(value, '{h3_matching_enabled}', 'false')
--    WHERE key = 'matching';
--   DROP INDEX  IF EXISTS idx_ride_offers_one_active_per_driver;
--   DROP TABLE   IF EXISTS driver_metrics;
--   ALTER TABLE driver_profiles DROP COLUMN IF EXISTS performance_tier;
--   DROP TABLE   IF EXISTS driver_blocks;
--   DROP TABLE   IF EXISTS app_config;
--   DROP TABLE   IF EXISTS driver_cells;   -- cascades its own indexes
--   COMMIT;
--
-- driver_cells is dropped last and is the only new table holding live rows.
-- Losing it costs nothing: it is rebuilt from the next GPS ping of every
-- online driver.
-- ═══════════════════════════════════════════════════════════════════════════
