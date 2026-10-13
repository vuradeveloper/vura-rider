-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN V2 — PHASE 2: RIDER MODERATION (suspend/ban) + INTERNAL NOTES.
-- ADDITIVE ONLY: side tables keyed on users(id); no legacy columns are changed,
-- so a database that never runs this migration behaves exactly as before.
-- Rollback: 006_admin_riders.rollback.sql
--
-- ENFORCEMENT POSTURE (same as the driver gate): the tables record state and
-- the admin console can set it immediately, but blocking a suspended rider
-- from POST /api/rides/request only happens when `rider_gate` is enabled in
-- app_config — the seed keeps it OFF, so enabling is an explicit ops action.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. MODERATION — absent row = active (legacy riders are untouched).
CREATE TABLE IF NOT EXISTS rider_moderation (
  rider_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'banned')),
  reason TEXT,
  until TIMESTAMPTZ,
  actor_email TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. STATUS HISTORY — append-only transitions (who changed what, why).
CREATE TABLE IF NOT EXISTS rider_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status VARCHAR(20) NOT NULL,
  to_status VARCHAR(20) NOT NULL,
  reason TEXT,
  actor_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rider_status_history_rider
  ON rider_status_history (rider_id, created_at DESC);

-- 3. INTERNAL NOTES — support context attached to a rider (audited on write).
CREATE TABLE IF NOT EXISTS rider_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rider_notes_rider
  ON rider_notes (rider_id, created_at DESC);

-- 4. GATE FLAG — seeded OFF (safe-by-default). Enabling it is an explicit
--    ops action (UPDATE app_config SET value = '{"enabled":true}' ...), and
--    the console reports the state; enforcement then activates on both
--    booking paths (REST + socket) within the 10s config cache.
INSERT INTO app_config (key, value) VALUES ('rider_gate', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
