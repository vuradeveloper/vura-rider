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
export declare const DEFAULT_CONFIG: AppConfig;
/** Read the whole config blob, falling back to defaults on any failure. */
export declare function getConfig(force?: boolean): Promise<AppConfig>;
/** Is H3 matching on? Called on the matching hot path. */
export declare function h3MatchingEnabled(): Promise<boolean>;
/** Test seam: drop the cache so the next read hits the database. */
export declare function invalidateConfigCache(): void;
/**
 * Seed app_config with defaults. Idempotent: ON CONFLICT DO NOTHING so a
 * re-run never overwrites values an admin has already tuned.
 */
export declare function seedConfig(): Promise<void>;
/** Read every config key, for the dispatch inspector. */
export declare function allConfig(): Promise<Record<string, unknown>>;
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
export declare const DEFAULT_DESTINATION_CONFIG: DestinationConfig;
/**
 * Destination-mode config (key `destination`), same 10s cache and
 * fail-to-defaults behaviour as getConfig: a missing row (before 002 runs)
 * means the feature is simply OFF, never an exception.
 */
export declare function getDestinationConfig(force?: boolean): Promise<DestinationConfig>;
//# sourceMappingURL=config.d.ts.map