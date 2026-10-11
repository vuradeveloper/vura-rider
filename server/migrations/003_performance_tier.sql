-- ─────────────────────────────────────────────────────────────────────────────
-- MODULE 3 — PERFORMANCE TIER ("Driver Tiers" / matching tie-break).
-- ADDITIVE ONLY: every object uses IF NOT EXISTS / ON CONFLICT DO NOTHING, so
-- re-running is safe (TEST_MIGRATION covers it). Rollback:
--   003_performance_tier.rollback.sql
--
-- Nothing here is read unless the `performance_tier` config flag is ON
-- (seeded FALSE below), so applying 003 in production is invisible until the
-- deliberate rollout.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. THE TIER TABLE — one row per driver: current tier + the metrics snapshot
--    the nightly recalc last wrote. `tier` is the canonical lowercase name
--    (display names live in the thresholds table / server code, never here).
CREATE TABLE IF NOT EXISTS driver_tiers (
  driver_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'bronze',
  -- The metrics snapshot (90-day rolling window) this tier was decided on.
  points INT NOT NULL DEFAULT 0,
  rating_avg NUMERIC(4,2) NOT NULL DEFAULT 0,
  accept_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  cancel_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  rides_completed INT NOT NULL DEFAULT 0,
  offers_received INT NOT NULL DEFAULT 0,
  offers_accepted INT NOT NULL DEFAULT 0,
  offers_timedout INT NOT NULL DEFAULT 0,
  driver_cancels INT NOT NULL DEFAULT 0,
  -- The rolling window those numbers cover (audit: "computed over what?").
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  -- Demotion grace (§Module 3): a driver who stops qualifying KEEPS the tier
  -- for `grace` days; `demote_after` is when that protection expires and
  -- `demote_pending_tier` is where they will land if still under-qualified.
  at_risk BOOLEAN NOT NULL DEFAULT FALSE,
  demote_after DATE,
  demote_pending_tier TEXT,
  last_eval_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. AUDIT TRAIL — every promotion/demotion, append-only.
CREATE TABLE IF NOT EXISTS driver_tier_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_tier TEXT NOT NULL,
  new_tier TEXT NOT NULL,
  reason TEXT NOT NULL,            -- 'promotion' | 'demotion_grace_expired'
  points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_tier_history_driver
  ON driver_tier_history (driver_id, created_at DESC);

-- 3. THRESHOLDS — the approved §Module 3 table, SQL-editable without a deploy.
--    ALL criteria must be met (points AND rating AND accept AND cancel);
--    a driver qualifies for the HIGHEST tier they fully meet, else Bronze.
--    commission_percent is DISPLAY-ONLY data (Tier screen + docs); payments
--    never read it — the fare pipeline is untouched by Module 3.
CREATE TABLE IF NOT EXISTS performance_tier_thresholds (
  tier TEXT PRIMARY KEY,                  -- canonical lowercase
  display_name TEXT NOT NULL,             -- 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
  rank INT NOT NULL UNIQUE,               -- ordering for "highest tier met"
  min_points INT NOT NULL,                -- completed rides in the window
  min_rating NUMERIC(3,2) NOT NULL,
  min_accept_percent NUMERIC(5,2) NOT NULL,
  max_cancel_percent NUMERIC(5,2) NOT NULL,
  commission_percent NUMERIC(5,2) NOT NULL
);
INSERT INTO performance_tier_thresholds
  (tier, display_name, rank, min_points, min_rating, min_accept_percent, max_cancel_percent, commission_percent)
VALUES
  ('bronze',   'Bronze',   1,   0, 4.00,  0, 20, 25),
  ('silver',   'Silver',   2, 150, 4.60, 60, 10, 22),
  ('gold',     'Gold',     3, 400, 4.75, 70,  6, 20),
  ('platinum', 'Platinum', 4, 800, 4.85, 80,  4, 18)
ON CONFLICT (tier) DO NOTHING;

-- 4. RUN LEDGER — the nightly 02:00 SAST recalc writes one row per SAST day;
--    the INSERT .. ON CONFLICT is what stops a second run on the same day
--    (double scheduler tick, boot catch-up after a crash). Manual triggers are
--    operator actions and are NOT day-limited: they write 'manual' rows, which
--    the partial unique index below deliberately excludes.
CREATE TABLE IF NOT EXISTS performance_tier_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,                                  -- SAST day
  trigger_source TEXT NOT NULL DEFAULT 'nightly',          -- 'nightly' | 'manual'
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  drivers_processed INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'                   -- 'running' | 'done' | 'failed'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_performance_tier_runs_nightly
  ON performance_tier_runs (run_date) WHERE trigger_source = 'nightly';

-- 5. CONFIG — master flag seeded FALSE + driver allowlist for the Tier screen
--    + the window/grace/HH knobs. ON CONFLICT keeps admin tuning.
INSERT INTO app_config (key, value) VALUES ('performance_tier', '{
  "performance_tier_enabled": false,
  "performance_tier_rollout_driver_ids": [],
  "performance_tier_window_days": 90,
  "performance_tier_grace_days": 7,
  "performance_tier_recalc_hour_sast": 2
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
