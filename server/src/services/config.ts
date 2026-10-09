// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME CONFIGURATION — every threshold in one table, editable without a deploy.
//
// WHY THIS EXISTS
//
// Matching thresholds used to be module constants (LOCATION_FRESH_SECONDS,
// OFFER_TTL_SECONDS...) that could only change by editing code and redeploying.
// Worse, devDispatch.ts reported hardcoded copies of them, so the inspector
// could display a value the server was not actually using. Everything tunable is
// now seeded into app_config and read through here, so it can be changed with a
// single SQL UPDATE and corrected in seconds rather than a deploy cycle.
//
// THE FEATURE FLAG
//
// H3_MATCHING_ENABLED is the instant kill-switch for Module 1. When false,
// findCandidates() falls back to the original haversine-over-driver_profiles
// query, so a bad index or a bad radius can be bypassed with an UPDATE and no
// redeploy. It is read from this same table so the same mechanism controls it.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from "../config/database";
import { DEFAULT_MATCH_RES, DEFAULT_HEATMAP_RES } from "../lib/h3";

export interface AppConfig {
  /** Master switch: false => original haversine matching, H3 index unused. */
  h3_matching_enabled: boolean;
  /** Escalation ladder searched in order, e.g. [3, 5, 7]. */
  match_radius_km: number[];
  /** Give up and tell the rider after this long. */
  search_timeout_ms: number;
  /** Rider sees a neutral "still looking" message after this long (Q5). */
  still_looking_msg_ms: number;
  h3_match_res: number;
  h3_heatmap_res: number;
  /**
   * A driver with no update for this long is evicted from the index.
   * 40s today: the shipped driver app pushes GPS every 15s and a heartbeat
   * every 10s. Tunable only through app_config — never in code; revisit when
   * the 4s location/heartbeat intervals planned for the driver app ship.
   * NOTE: a DIFFERENT number from dispatch's DRIVER_STALE_SECONDS and
   * LOCATION_FRESH_SECONDS constants (demotion sweep / candidate freshness).
   * The [offerWorker] boot line prints all three side by side, labelled.
   */
  stale_seconds: number;
  /**
   * POSITION AGE (independent of `stale_seconds`, which measures LIVENESS):
   * a candidate whose last GPS fix (`driver_profiles.last_location_at`) is
   * older than this is excluded from the H3 path even if heartbeats keep
   * them alive. Heartbeat `touch()` refreshes driver_cells.last_seen_at
   * only — never this timestamp.
   */
  max_position_age_seconds: number;
  offer_ttl_seconds: number;
  /** Haversine fallback speed when the routing API fails. */
  avg_speed_kmh: number;
  /**
   * Minimum driver rating for a candidate. 0 disables the filter (the default):
   * a rating floor above 0 would lock out every driver who simply has no ratings
   * yet, which on a new fleet is most of them. Tune upward via app_config only
   * once ratings are widespread.
   */
  min_driver_rating: number;
  /**
   * When set (e.g. "sedan"), only drivers in this vehicle category are offered
   * any ride. null = no vehicle filter (the default; rides carry no vehicle
   * preference today, so a non-null value is an operational override such as a
   * surge-only-sedans policy), and it too lives here rather than in code.
   */
  required_vehicle_category: string | null;
  /**
   * ROLLOUT CONTROL (read with the same 10s cache as everything else):
   *
   *   h3_matching_enabled  MASTER KILL SWITCH. false => legacy path for every
   *                        ride, regardless of the mode below.
   *   h3_rollout_mode      'off'       -> legacy for everyone
   *                        'allowlist' -> H3 only for h3_rollout_rider_ids
   *                        'percent'   -> H3 for riders whose stable bucket
   *                                        (hash of rider id) < percent
   *                        'all'       -> H3 for everyone
   *   h3_rollout_rider_ids rider user ids (users.id), allowlist mode only
   *   h3_rollout_percent   0-100, percent mode only. Stable per rider: the
   *                        same rider always lands in the same bucket, so
   *                        widening the percent never flips a rider's path
   *                        mid-session.
   *
   * Seed: enabled=false, mode='off' — rollout is always an explicit act.
   */
  h3_rollout_mode: "off" | "allowlist" | "percent" | "all";
  h3_rollout_rider_ids: string[];
  h3_rollout_percent: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  // Safe-by-default: H3 matching stays OFF unless app_config explicitly turns
  // it on (the 001 seed writes false; rollout enables it per the checklist).
  // A missing/unreadable app_config therefore behaves exactly like the
  // pre-Module-1 server.
  h3_matching_enabled: false,
  match_radius_km: [3, 5, 7],
  search_timeout_ms: 90_000,
  still_looking_msg_ms: 30_000,
  h3_match_res: DEFAULT_MATCH_RES,
  h3_heatmap_res: DEFAULT_HEATMAP_RES,
  stale_seconds: 40,
  max_position_age_seconds: 300,
  offer_ttl_seconds: 15,
  avg_speed_kmh: 40,
  min_driver_rating: 0,
  required_vehicle_category: null,
  h3_rollout_mode: "off",
  h3_rollout_rider_ids: [],
  h3_rollout_percent: 0,
};

let cached: AppConfig | null = null;
let cachedAt = 0;

/** Config is cached briefly so a hot matching path does not query per offer. */
const CACHE_MS = 10_000;

function coerce(raw: Partial<AppConfig> | null | undefined): AppConfig {
  const cfg = { ...DEFAULT_CONFIG };
  if (!raw) return cfg;
  if (typeof raw.h3_matching_enabled === "boolean") cfg.h3_matching_enabled = raw.h3_matching_enabled;
  if (Array.isArray(raw.match_radius_km) && raw.match_radius_km.length > 0) {
    cfg.match_radius_km = raw.match_radius_km.map(Number).filter((n) => n > 0);
  }
  if (typeof raw.search_timeout_ms === "number") cfg.search_timeout_ms = raw.search_timeout_ms;
  if (typeof raw.still_looking_msg_ms === "number") cfg.still_looking_msg_ms = raw.still_looking_msg_ms;
  if (typeof raw.h3_match_res === "number") cfg.h3_match_res = raw.h3_match_res;
  if (typeof raw.h3_heatmap_res === "number") cfg.h3_heatmap_res = raw.h3_heatmap_res;
  if (typeof raw.stale_seconds === "number") cfg.stale_seconds = raw.stale_seconds;
  if (typeof raw.max_position_age_seconds === "number" && raw.max_position_age_seconds > 0) {
    cfg.max_position_age_seconds = raw.max_position_age_seconds;
  }
  if (typeof raw.offer_ttl_seconds === "number") cfg.offer_ttl_seconds = raw.offer_ttl_seconds;
  if (typeof raw.avg_speed_kmh === "number") cfg.avg_speed_kmh = raw.avg_speed_kmh;
  if (typeof raw.min_driver_rating === "number") cfg.min_driver_rating = raw.min_driver_rating;
  if (typeof raw.required_vehicle_category === "string" && raw.required_vehicle_category.trim()) {
    cfg.required_vehicle_category = raw.required_vehicle_category.trim();
  }
  const modes: Array<AppConfig["h3_rollout_mode"]> = ["off", "allowlist", "percent", "all"];
  if (typeof raw.h3_rollout_mode === "string" && modes.includes(raw.h3_rollout_mode as AppConfig["h3_rollout_mode"])) {
    cfg.h3_rollout_mode = raw.h3_rollout_mode as AppConfig["h3_rollout_mode"];
  }
  if (Array.isArray(raw.h3_rollout_rider_ids)) {
    cfg.h3_rollout_rider_ids = raw.h3_rollout_rider_ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof raw.h3_rollout_percent === "number" && Number.isFinite(raw.h3_rollout_percent)) {
    cfg.h3_rollout_percent = Math.max(0, Math.min(100, raw.h3_rollout_percent));
  }
  return cfg;
}

/** Read the whole config blob, falling back to defaults on any failure. */
export async function getConfig(force = false): Promise<AppConfig> {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  try {
    const row = await queryOne<{ value: any }>(
      "SELECT value FROM app_config WHERE key = 'matching'"
    );
    cached = coerce(row?.value);
  } catch {
    // Table missing or unreadable (e.g. before the migration runs): defaults are
    // safe and must never take dispatch down.
    cached = coerce(null);
  }
  cachedAt = Date.now();
  return cached;
}

/** Is H3 matching on? Called on the matching hot path. */
export async function h3MatchingEnabled(): Promise<boolean> {
  return (await getConfig()).h3_matching_enabled;
}

/** Test seam: drop the cache so the next read hits the database. */
export function invalidateConfigCache(): void {
  cached = null;
  cachedAt = 0;
  destCached = null;
  destCachedAt = 0;
}

/**
 * Seed app_config with defaults. Idempotent: ON CONFLICT DO NOTHING so a
 * re-run never overwrites values an admin has already tuned.
 */
export async function seedConfig(): Promise<void> {
  const keys: Record<string, unknown> = {
    matching: DEFAULT_CONFIG,
  };
  for (const [key, value] of Object.entries(keys)) {
    await query(
      `INSERT INTO app_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
}

/** Read every config key, for the dispatch inspector. */
export async function allConfig(): Promise<Record<string, unknown>> {
  const rows = await query<{ key: string; value: any }>(
    "SELECT key, value FROM app_config ORDER BY key"
  );
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ── Module 2: destination mode config (key `destination`, seeded by 002) ─────

export interface DestinationConfig {
  /** Master switch for the feature (seeded FALSE — Q12). */
  destination_matching_enabled: boolean;
  /** Driver-keyed rollout: only these user ids get the predicate applied. */
  destination_rollout_driver_ids: string[];
  /** Q1: max activations per driver per SAST day. */
  destination_max_activations_per_day: number;
  /** Q1: reject activation inside this radius ("You're already close"). */
  destination_reject_radius_km: number;
  /** §8.1: auto-end when the driver is within this radius of the destination. */
  destination_arrival_radius_km: number;
  /**
   * L7c (revised): the session ends ONLY on an explicit offline action
   * (driver:online=false / the 15-min safety timeout sets is_online=false) or
   * after this long with NO heartbeat or location ping. A short socket drop —
   * which only demotes status to 'offline' while is_online stays true — must
   * never end the session or burn a daily use.
   */
  destination_offline_grace_seconds: number;
  /** §8.1: auto-end after this long without a COMPLETED trip (the timer
   *  resets on every completed trip — noteDestinationTripCompleted). */
  destination_max_minutes_without_trip: number;
  /** §8.2 (c1): pure disk around the drop-off→destination. */
  destination_match_dropoff_radius_km: number;
  /** §8.2 (c2): max cross-track offset from the driver→destination line. */
  destination_match_cross_track_km: number;
  /** §8.2 (c2): along-track tolerance past the driver / past the destination. */
  destination_match_along_tolerance_km: number;
}

export const DEFAULT_DESTINATION_CONFIG: DestinationConfig = {
  destination_matching_enabled: false,
  destination_rollout_driver_ids: [],
  destination_max_activations_per_day: 2,
  destination_reject_radius_km: 1,
  destination_arrival_radius_km: 0.5,
  destination_offline_grace_seconds: 300,
  destination_max_minutes_without_trip: 180,
  destination_match_dropoff_radius_km: 3,
  destination_match_cross_track_km: 5,
  destination_match_along_tolerance_km: 0.5,
};

function coerceDestination(raw: any): DestinationConfig {
  const cfg: DestinationConfig = { ...DEFAULT_DESTINATION_CONFIG };
  if (!raw || typeof raw !== "object") return cfg;
  if (typeof raw.destination_matching_enabled === "boolean") {
    cfg.destination_matching_enabled = raw.destination_matching_enabled;
  }
  if (Array.isArray(raw.destination_rollout_driver_ids)) {
    const ids: unknown[] = raw.destination_rollout_driver_ids;
    cfg.destination_rollout_driver_ids = ids
      .filter((id): id is string => typeof id === "string")
      .map((id: string) => id.trim().toLowerCase())
      .filter(Boolean);
  }
  type NumKey = Exclude<
    keyof DestinationConfig,
    "destination_matching_enabled" | "destination_rollout_driver_ids"
  >;
  const nums: NumKey[] = [
    "destination_max_activations_per_day",
    "destination_reject_radius_km",
    "destination_arrival_radius_km",
    "destination_offline_grace_seconds",
    "destination_max_minutes_without_trip",
    "destination_match_dropoff_radius_km",
    "destination_match_cross_track_km",
    "destination_match_along_tolerance_km",
  ];
  for (const k of nums) {
    const v: unknown = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      cfg[k] = v;
    }
  }
  return cfg;
}

let destCached: DestinationConfig | null = null;
let destCachedAt = 0;

/**
 * Destination-mode config (key `destination`), same 10s cache and
 * fail-to-defaults behaviour as getConfig: a missing row (before 002 runs)
 * means the feature is simply OFF, never an exception.
 */
export async function getDestinationConfig(force = false): Promise<DestinationConfig> {
  if (!force && destCached && Date.now() - destCachedAt < CACHE_MS) return destCached;
  try {
    const row = await queryOne<{ value: any }>(
      "SELECT value FROM app_config WHERE key = 'destination'"
    );
    destCached = coerceDestination(row?.value);
  } catch {
    destCached = { ...DEFAULT_DESTINATION_CONFIG };
  }
  destCachedAt = Date.now();
  return destCached;
}