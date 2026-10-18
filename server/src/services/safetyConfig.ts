// ─────────────────────────────────────────────────────────────────────────────
// SAFETY CONFIG — every anomaly/check-in/PIN/retention threshold the admin
// console can tune, with the 017 DDL self-healed here (same money-table
// pattern: a host that boots without migrations still gets a working feature).
// Single settings document under key 'settings'.
// ─────────────────────────────────────────────────────────────────────────────
import { queryOne, execute } from "../config/database";

export interface SafetySettings {
  /** Route deviation beyond this distance (m) flags the ride. */
  deviation_m: number;
  /** Stationary longer than this away from pickup/drop-off = unnecessary stop. */
  stop_seconds: number;
  /** ...but never inside this radius (m) of the pickup or drop-off point. */
  stop_exclusion_m: number;
  /** Trip taking this % longer than the estimate (with overrun_min_s floor). */
  overrun_pct: number;
  /** Minimum seconds over the estimate before flagging (kills false alarms). */
  overrun_min_s: number;
  /** No GPS ping while in_progress for this long = silent GPS. */
  gps_silence_s: number;
  /** Rider must answer a check-in within this many seconds → admin alert. */
  checkin_timeout_s: number;
  /** Ride location points older than this are deleted (privacy). */
  location_retention_days: number;
  /** Wrong PIN attempts before the code locks and the rider is alerted. */
  max_pin_attempts: number;
}

export const DEFAULT_SAFETY: SafetySettings = {
  deviation_m: 300,
  stop_seconds: 180,
  stop_exclusion_m: 120,
  overrun_pct: 60,
  overrun_min_s: 420,
  gps_silence_s: 120,
  checkin_timeout_s: 120,
  location_retention_days: 30,
  max_pin_attempts: 3,
};

/** Bounds for PUT validation: [min, max] per key. */
const BOUNDS: Record<keyof SafetySettings, [number, number]> = {
  deviation_m: [50, 5000],
  stop_seconds: [30, 3600],
  stop_exclusion_m: [0, 1000],
  overrun_pct: [10, 300],
  overrun_min_s: [60, 7200],
  gps_silence_s: [30, 3600],
  checkin_timeout_s: [15, 600],
  location_retention_days: [1, 365],
  max_pin_attempts: [1, 10],
};

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS safety_config (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by UUID)`,
  `CREATE TABLE IF NOT EXISTS ride_location_points (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE, driver_id UUID, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_ride_location_points_ride ON ride_location_points (ride_id, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ride_location_points_age ON ride_location_points (recorded_at)`,
  `CREATE TABLE IF NOT EXISTS ride_anomalies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE, driver_id UUID, type VARCHAR(20) NOT NULL CHECK (type IN ('deviation','long_stop','overrun','gps_silence')), severity VARCHAR(10) NOT NULL DEFAULT 'warn', data JSONB, status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','checkin_sent','safe','no_response','escalated','false_alarm','resolved')), handled_by UUID, handled_at TIMESTAMPTZ, note TEXT, detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_ride_anomalies_status ON ride_anomalies (status, detected_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ride_checkins (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE, anomaly_id UUID REFERENCES ride_anomalies(id) ON DELETE CASCADE, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), respond_by TIMESTAMPTZ NOT NULL, responded_at TIMESTAMPTZ, response VARCHAR(10) CHECK (response IN ('safe','sos')), status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','answered','no_response','escalated')))`,
  `CREATE INDEX IF NOT EXISTS idx_ride_checkins_status ON ride_checkins (status, respond_by)`,
  `CREATE TABLE IF NOT EXISTS ride_pins (ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE, pin_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, locked_at TIMESTAMPTZ, verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS driver_preferences (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, women_only BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sos_alerts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ride_id UUID REFERENCES rides(id) ON DELETE SET NULL, triggered_by UUID REFERENCES users(id), triggered_by_role VARCHAR(20), status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved')), payload JSONB, acknowledged_by UUID, acknowledged_at TIMESTAMPTZ, resolved_by UUID, resolved_at TIMESTAMPTZ, outcome TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_sos_alerts_status ON sos_alerts (status, created_at DESC)`,
  `ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS gender VARCHAR(10)`,
  `ALTER TABLE rides ADD COLUMN IF NOT EXISTS trip_started_at TIMESTAMPTZ`,
];

let ensured = false;
export async function ensureSafetyTables(): Promise<void> {
  if (ensured) return;
  for (const ddl of DDL) {
    await execute(ddl).catch(() => { /* pre-existing */ });
  }
  ensured = true;
}

/** Stored settings merged over defaults — never throws, safe on any host. */
export async function getSafetySettings(): Promise<SafetySettings> {
  try {
    await ensureSafetyTables();
    const row = await queryOne<{ value: unknown }>(
      "SELECT value FROM safety_config WHERE key = 'settings'"
    );
    const stored = (row?.value ?? {}) as Record<string, unknown>;
    const merged: Record<string, number> = { ...DEFAULT_SAFETY };
    for (const k of Object.keys(DEFAULT_SAFETY) as (keyof SafetySettings)[]) {
      const v = Number(stored[k]);
      if (Number.isFinite(v) && v >= BOUNDS[k][0] && v <= BOUNDS[k][1]) merged[k] = v;
    }
    return merged as unknown as SafetySettings;
  } catch {
    return { ...DEFAULT_SAFETY };
  }
}

/** Validate + persist the settings document. Throws on bad input. */
export async function putSafetySettings(
  patch: Partial<SafetySettings>,
  actorId?: string | null
): Promise<SafetySettings> {
  const next: Record<string, number> = { ...(await getSafetySettings()) };
  for (const [k, raw] of Object.entries(patch)) {
    if (!(k in DEFAULT_SAFETY)) throw new Error(`Unknown safety setting: ${k}`);
    const v = Number(raw);
    const [min, max] = BOUNDS[k as keyof SafetySettings];
    if (!Number.isFinite(v) || v < min || v > max) {
      throw new Error(`${k} must be between ${min} and ${max}`);
    }
    next[k] = Math.floor(v);
  }
  await ensureSafetyTables();
  await execute(
    `INSERT INTO safety_config (key, value, updated_at, updated_by)
     VALUES ('settings', $1::jsonb, NOW(), $2)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW(), updated_by = $2`,
    [JSON.stringify(next), actorId ?? null]
  );
  return next as unknown as SafetySettings;
}
