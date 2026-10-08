-- ─────────────────────────────────────────────────────────────────────────────
-- MODULE 2 — DESTINATION MODE ("Set Destination" / Destination Fit), Q1–Q14.
-- ADDITIVE ONLY: every object uses IF NOT EXISTS / ON CONFLICT DO NOTHING, so
-- re-running is safe (TEST_MIGRATION covers it). Rollback:
--   002_destination_mode.rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. CURRENT destination lives on the driver (Q4: profile = current state).
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_label TEXT;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_set_at TIMESTAMPTZ;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_expires_at TIMESTAMPTZ;

-- 2. Sessions: the daily-limit counter (sast_day = SAST calendar day, Q1/Q5)
--    plus the audit trail for every activation and how it ended.
CREATE TABLE IF NOT EXISTS destination_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  label TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  trips_completed INT NOT NULL DEFAULT 0,
  sast_day DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Johannesburg')::date)
);
CREATE INDEX IF NOT EXISTS idx_destination_sessions_driver_day
  ON destination_sessions (driver_id, sast_day);
-- At most one ACTIVE session per driver is a queryable invariant, not a
-- convention: the sweep and the API both close via `WHERE ended_at IS NULL`.
CREATE INDEX IF NOT EXISTS idx_destination_sessions_active
  ON destination_sessions (driver_id) WHERE ended_at IS NULL;

-- 3. Activation/termination log (every API call and auto-end is auditable).
CREATE TABLE IF NOT EXISTS destination_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_destination_events_driver
  ON destination_events (driver_id, created_at DESC);

-- 4. Config (Q12): master flag seeded FALSE + driver allowlist + every
--    threshold from the approved §8 tables. ON CONFLICT keeps admin tuning.
INSERT INTO app_config (key, value) VALUES ('destination', '{
  "destination_matching_enabled": false,
  "destination_rollout_driver_ids": [],
  "destination_max_activations_per_day": 2,
  "destination_reject_radius_km": 1,
  "destination_arrival_radius_km": 0.5,
  "destination_timeout_hours": 3,
  "destination_match_dropoff_radius_km": 3,
  "destination_match_cross_track_km": 5,
  "destination_match_along_tolerance_km": 0.5
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
