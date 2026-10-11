export type TierName = "bronze" | "silver" | "gold" | "platinum";
/** Ordering for "highest tier met" and the matching tie-break. */
export declare const TIER_RANK: Record<TierName, number>;
/** Canonical tier key -> the name the driver app displays. */
export declare function tierDisplayName(tier: string): string;
export interface TierThreshold {
    tier: TierName;
    display_name: string;
    rank: number;
    min_points: number;
    min_rating: number;
    min_accept_percent: number;
    max_cancel_percent: number;
    /** DISPLAY ONLY — never applied to a fare, payout or platform_fee. */
    commission_percent: number;
}
/** Migration 003's seed, as code — the fail-to-defaults when the table is absent. */
export declare const DEFAULT_THRESHOLDS: TierThreshold[];
/** Thresholds live in SQL (ops tunes with an UPDATE, no deploy); fall back to the seed. */
export declare function loadThresholds(): Promise<TierThreshold[]>;
/** The rolling-window snapshot the tier was decided on. */
export interface TierMetrics {
    points: number;
    rating_avg: number;
    accept_percent: number;
    cancel_percent: number;
    rides_completed: number;
    offers_received: number;
    offers_accepted: number;
    offers_timedout: number;
    driver_cancels: number;
}
/**
 * PURE ALL-criteria rule: the HIGHEST tier whose points/rating/accept/cancel
 * are ALL met, else bronze (the floor). Unit-tested at every boundary.
 */
export declare function evaluateTier(m: TierMetrics, thresholds?: TierThreshold[]): TierName;
/**
 * SAST calendar day as YYYY-MM-DD computed in JS. Africa/Johannesburg is
 * UTC+2 with NO DST since 1970, so the fixed offset is exact; SQL-side
 * equivalents use `now() AT TIME ZONE 'Africa/Johannesburg'` — same answer.
 */
export declare function sastTodayIso(nowMs?: number): string;
/** ISO date + N days (pure date arithmetic; 'YYYY-MM-DD' parses as UTC midnight). */
export declare function addDaysIso(isoDate: string, days: number): string;
/** Whole days from `todayIso` (SAST) until `isoDate`; negative = already past. */
export declare function daysUntilIso(isoDate: string, todayIso?: string): number | null;
/** Everything the driver app's Tier screen renders — REST and socket twins. */
export interface TierStatus {
    /** false = HIDE the screen (flag off OR this driver outside the rollout). */
    enabled: boolean;
    tier: string | null;
    display_name: string | null;
    points: number | null;
    rating_avg: number | null;
    accept_percent: number | null;
    cancel_percent: number | null;
    rides_completed: number | null;
    offers_received: number | null;
    offers_accepted: number | null;
    offers_timedout: number | null;
    driver_cancels: number | null;
    /** DISPLAY ONLY — informational; payments never read it. */
    commission_percent: number | null;
    at_risk: boolean;
    demote_after: string | null;
    days_left: number | null;
    window_start: string | null;
    window_end: string | null;
    next_tier: {
        tier: string;
        display_name: string;
        min_points: number;
        min_rating: number;
        min_accept_percent: number;
        max_cancel_percent: number;
    } | null;
    /** Human-readable criteria blocking `next_tier` ([] when none / no next). */
    missing: string[];
    updated_at: string | null;
}
/**
 * The read-only status the REST GET and the `driver:tier:status` socket event
 * both return. Two gates, one answer: `enabled:false` covers flag-off AND
 * outside-rollout — the app must not distinguish those reasons (same contract
 * as Module 2's destination banner, which reports paused for both causes).
 */
export declare function computeTierStatus(driverId: string): Promise<TierStatus>;
/** The subset of socket.io the recalc needs (harness-compatible). */
export interface TierEmitTarget {
    to(room: string): {
        emit(event: string, payload: unknown): void;
    };
}
export declare function setTierEmitTarget(io: TierEmitTarget | null): void;
export interface TierRecalcResult {
    ran: boolean;
    source: "nightly" | "manual";
    reason?: string;
    processed: number;
    promoted: number;
    demoted: number;
    at_risk: number;
}
/**
 * The nightly/manual recalculation. Inert while the flag is off; the nightly
 * path additionally refuses to run twice per SAST day (partial unique index
 * on performance_tier_runs). Per-driver failures are logged and skipped — one
 * bad row must never abort the fleet.
 */
export declare function recalculatePerformanceTiers(opts: {
    source: "nightly" | "manual";
}, io?: TierEmitTarget | null): Promise<TierRecalcResult>;
/**
 * Due check + run. Runs when the SAST hour has REACHED the configured hour —
 * that single condition gives both the 02:00 fire and the boot catch-up after
 * a 02:00 downtime; the performance_tier_runs row makes it once-per-day.
 */
export declare function runNightlyIfDue(): Promise<{
    ran: boolean;
    reason?: string;
}>;
/** Start the 60s tick (idempotent) and remember `io` for tier-change events. */
export declare function startPerformanceTierScheduler(io: TierEmitTarget): NodeJS.Timeout;
export declare function stopPerformanceTierScheduler(): void;
export interface TierEtaPair<T> {
    row: T;
    eta: number;
}
/**
 * Module 3's one matching change: among candidates with the SAME road ETA,
 * the HIGHER performance tier is offered first. Strictly additive:
 *   • flag off (the seed) → the input is returned untouched (existing tests
 *     and production behave byte-identically);
 *   • flag on but no strict ETA tie exists → untouched, and the driver_tiers
 *     query is never issued (ties are the only case this can change);
 *   • flag on, tie exists, driver_tiers missing/unreadable → fail OPEN to the
 *     input order with one warning (003 not applied is not an outage);
 *   • sort is stable, so equal-tier ties keep pool order, and candidates with
 *     DIFFERENT etas can never swap.
 * Only the H3 path calls this (findCandidatesHaversine never reaches it).
 */
export declare function breakTierTies<T extends {
    id: string;
}>(pairs: TierEtaPair<T>[], rideId: string): Promise<TierEtaPair<T>[]>;
//# sourceMappingURL=performanceTier.d.ts.map