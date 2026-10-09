"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DESTINATION_CONFIG = exports.DEFAULT_CONFIG = void 0;
exports.getConfig = getConfig;
exports.h3MatchingEnabled = h3MatchingEnabled;
exports.invalidateConfigCache = invalidateConfigCache;
exports.seedConfig = seedConfig;
exports.allConfig = allConfig;
exports.getDestinationConfig = getDestinationConfig;
const database_1 = require("../config/database");
const h3_1 = require("../lib/h3");
exports.DEFAULT_CONFIG = {
    // Safe-by-default: H3 matching stays OFF unless app_config explicitly turns
    // it on (the 001 seed writes false; rollout enables it per the checklist).
    // A missing/unreadable app_config therefore behaves exactly like the
    // pre-Module-1 server.
    h3_matching_enabled: false,
    match_radius_km: [3, 5, 7],
    search_timeout_ms: 90_000,
    still_looking_msg_ms: 30_000,
    h3_match_res: h3_1.DEFAULT_MATCH_RES,
    h3_heatmap_res: h3_1.DEFAULT_HEATMAP_RES,
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
let cached = null;
let cachedAt = 0;
/** Config is cached briefly so a hot matching path does not query per offer. */
const CACHE_MS = 10_000;
function coerce(raw) {
    const cfg = { ...exports.DEFAULT_CONFIG };
    if (!raw)
        return cfg;
    if (typeof raw.h3_matching_enabled === "boolean")
        cfg.h3_matching_enabled = raw.h3_matching_enabled;
    if (Array.isArray(raw.match_radius_km) && raw.match_radius_km.length > 0) {
        cfg.match_radius_km = raw.match_radius_km.map(Number).filter((n) => n > 0);
    }
    if (typeof raw.search_timeout_ms === "number")
        cfg.search_timeout_ms = raw.search_timeout_ms;
    if (typeof raw.still_looking_msg_ms === "number")
        cfg.still_looking_msg_ms = raw.still_looking_msg_ms;
    if (typeof raw.h3_match_res === "number")
        cfg.h3_match_res = raw.h3_match_res;
    if (typeof raw.h3_heatmap_res === "number")
        cfg.h3_heatmap_res = raw.h3_heatmap_res;
    if (typeof raw.stale_seconds === "number")
        cfg.stale_seconds = raw.stale_seconds;
    if (typeof raw.max_position_age_seconds === "number" && raw.max_position_age_seconds > 0) {
        cfg.max_position_age_seconds = raw.max_position_age_seconds;
    }
    if (typeof raw.offer_ttl_seconds === "number")
        cfg.offer_ttl_seconds = raw.offer_ttl_seconds;
    if (typeof raw.avg_speed_kmh === "number")
        cfg.avg_speed_kmh = raw.avg_speed_kmh;
    if (typeof raw.min_driver_rating === "number")
        cfg.min_driver_rating = raw.min_driver_rating;
    if (typeof raw.required_vehicle_category === "string" && raw.required_vehicle_category.trim()) {
        cfg.required_vehicle_category = raw.required_vehicle_category.trim();
    }
    const modes = ["off", "allowlist", "percent", "all"];
    if (typeof raw.h3_rollout_mode === "string" && modes.includes(raw.h3_rollout_mode)) {
        cfg.h3_rollout_mode = raw.h3_rollout_mode;
    }
    if (Array.isArray(raw.h3_rollout_rider_ids)) {
        cfg.h3_rollout_rider_ids = raw.h3_rollout_rider_ids
            .filter((id) => typeof id === "string")
            .map((id) => id.trim().toLowerCase())
            .filter(Boolean);
    }
    if (typeof raw.h3_rollout_percent === "number" && Number.isFinite(raw.h3_rollout_percent)) {
        cfg.h3_rollout_percent = Math.max(0, Math.min(100, raw.h3_rollout_percent));
    }
    return cfg;
}
/** Read the whole config blob, falling back to defaults on any failure. */
async function getConfig(force = false) {
    if (!force && cached && Date.now() - cachedAt < CACHE_MS)
        return cached;
    try {
        const row = await (0, database_1.queryOne)("SELECT value FROM app_config WHERE key = 'matching'");
        cached = coerce(row?.value);
    }
    catch {
        // Table missing or unreadable (e.g. before the migration runs): defaults are
        // safe and must never take dispatch down.
        cached = coerce(null);
    }
    cachedAt = Date.now();
    return cached;
}
/** Is H3 matching on? Called on the matching hot path. */
async function h3MatchingEnabled() {
    return (await getConfig()).h3_matching_enabled;
}
/** Test seam: drop the cache so the next read hits the database. */
function invalidateConfigCache() {
    cached = null;
    cachedAt = 0;
    destCached = null;
    destCachedAt = 0;
}
/**
 * Seed app_config with defaults. Idempotent: ON CONFLICT DO NOTHING so a
 * re-run never overwrites values an admin has already tuned.
 */
async function seedConfig() {
    const keys = {
        matching: exports.DEFAULT_CONFIG,
    };
    for (const [key, value] of Object.entries(keys)) {
        await (0, database_1.query)(`INSERT INTO app_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`, [key, JSON.stringify(value)]);
    }
}
/** Read every config key, for the dispatch inspector. */
async function allConfig() {
    const rows = await (0, database_1.query)("SELECT key, value FROM app_config ORDER BY key");
    const out = {};
    for (const r of rows)
        out[r.key] = r.value;
    return out;
}
exports.DEFAULT_DESTINATION_CONFIG = {
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
function coerceDestination(raw) {
    const cfg = { ...exports.DEFAULT_DESTINATION_CONFIG };
    if (!raw || typeof raw !== "object")
        return cfg;
    if (typeof raw.destination_matching_enabled === "boolean") {
        cfg.destination_matching_enabled = raw.destination_matching_enabled;
    }
    if (Array.isArray(raw.destination_rollout_driver_ids)) {
        const ids = raw.destination_rollout_driver_ids;
        cfg.destination_rollout_driver_ids = ids
            .filter((id) => typeof id === "string")
            .map((id) => id.trim().toLowerCase())
            .filter(Boolean);
    }
    const nums = [
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
        const v = raw[k];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
            cfg[k] = v;
        }
    }
    return cfg;
}
let destCached = null;
let destCachedAt = 0;
/**
 * Destination-mode config (key `destination`), same 10s cache and
 * fail-to-defaults behaviour as getConfig: a missing row (before 002 runs)
 * means the feature is simply OFF, never an exception.
 */
async function getDestinationConfig(force = false) {
    if (!force && destCached && Date.now() - destCachedAt < CACHE_MS)
        return destCached;
    try {
        const row = await (0, database_1.queryOne)("SELECT value FROM app_config WHERE key = 'destination'");
        destCached = coerceDestination(row?.value);
    }
    catch {
        destCached = { ...exports.DEFAULT_DESTINATION_CONFIG };
    }
    destCachedAt = Date.now();
    return destCached;
}
//# sourceMappingURL=config.js.map