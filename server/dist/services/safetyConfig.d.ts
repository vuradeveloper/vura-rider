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
export declare const DEFAULT_SAFETY: SafetySettings;
export declare function ensureSafetyTables(): Promise<void>;
/** Stored settings merged over defaults — never throws, safe on any host. */
export declare function getSafetySettings(): Promise<SafetySettings>;
/** Validate + persist the settings document. Throws on bad input. */
export declare function putSafetySettings(patch: Partial<SafetySettings>, actorId?: string | null): Promise<SafetySettings>;
//# sourceMappingURL=safetyConfig.d.ts.map