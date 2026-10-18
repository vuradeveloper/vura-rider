-- 017 — SAFETY SUITE (admin-visible): ride path history, route/stop/overrun/
-- GPS-silence anomalies, rider check-ins, start PINs, driver rider-preference
-- (shadow mode), SOS alerts with handling workflow, and tunable config.
--
-- Everything here is additive and safety-only: no booking/payment/matching
-- column is altered. Locations are collected ONLY while a ride is active
-- (the ping hook inserts solely when the ride is in accepted/driver_arrived/
-- in_progress) and purged after safety_config.retention_days.

-- The travelled path (also feeds the admin live map's "actual path").
CREATE TABLE IF NOT EXISTS ride_location_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ride_location_points_ride
  ON ride_location_points (ride_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_ride_location_points_age
  ON ride_location_points (recorded_at);

-- One row per detected anomaly, per type, per ride.
CREATE TABLE IF NOT EXISTS ride_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID,
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('deviation','long_stop','overrun','gps_silence')),
  severity VARCHAR(10) NOT NULL DEFAULT 'warn',
  data JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','checkin_sent','safe','no_response','escalated','false_alarm','resolved')),
  handled_by UUID,
  handled_at TIMESTAMPTZ,
  note TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ride_anomalies_ride ON ride_anomalies (ride_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_anomalies_status ON ride_anomalies (status, detected_at DESC);

-- The "Is everything okay?" prompt and its deadline.
CREATE TABLE IF NOT EXISTS ride_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  anomaly_id UUID REFERENCES ride_anomalies(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  respond_by TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  response VARCHAR(10) CHECK (response IN ('safe','sos')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','answered','no_response','escalated'))
);
CREATE INDEX IF NOT EXISTS idx_ride_checkins_status ON ride_checkins (status, respond_by);

-- Single-use start code: rider sees it, driver must key it in before begin.
CREATE TABLE IF NOT EXISTS ride_pins (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Driver-controlled preference (§2). SHADOW MODE: stored + logged, NOT yet
-- applied to dispatch — matching flips on only after real rider data exists.
CREATE TABLE IF NOT EXISTS driver_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  women_only BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SOS events with a handling workflow for the console.
CREATE TABLE IF NOT EXISTS sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
  triggered_by UUID REFERENCES users(id),
  triggered_by_role VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','acknowledged','resolved')),
  payload JSONB,
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_status ON sos_alerts (status, created_at DESC);

-- Tunable thresholds + retention period (single settings document).
CREATE TABLE IF NOT EXISTS safety_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- Driver gender (optional): gates WHO SEES the "only women riders" toggle.
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS gender VARCHAR(10);

-- When the driver keyed the PIN and the trip began (overrun + silence baseline).
ALTER TABLE rides ADD COLUMN IF NOT EXISTS trip_started_at TIMESTAMPTZ;
