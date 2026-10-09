import { DestinationConfig } from "./config";
export interface DestinationStatus {
    active: boolean;
    label: string | null;
    lat: number | null;
    lng: number | null;
    /** Sessions started today (SAST), including 'changed' ones — Q1/Q6. */
    uses_today: number;
    max_uses: number;
    /** "Going to [place] - 1 of 2 uses today" while active, else null. */
    banner: string | null;
    expires_at: string | null;
    /**
     * Flag off or driver dropped from the rollout WHILE a session is still open:
     * the next sweep ends it (`feature_disabled`), so the app must show the
     * destination UI as PAUSED (with `pause_reason`) until then. Always false
     * when no session is open — there is nothing to pause.
     */
    paused: boolean;
    pause_reason: string | null;
    sast_day: string;
}
export type ActivateErrorCode = "disabled" | "invalid_coordinates" | "not_found" | "not_online" | "on_trip" | "already_close" | "daily_limit" | "internal";
export type ActivateResult = {
    ok: true;
    status: DestinationStatus;
} | {
    ok: false;
    error: ActivateErrorCode;
    message: string;
};
/**
 * Service error → HTTP status (REST transport contract, §8.1/f). Lives HERE,
 * next to the code union, so routes/drivers.ts cannot drift: the unit test
 * asserts this record covers every ActivateErrorCode exactly once. State
 * conflicts are 409s, daily quota is 429, flag-off is 403.
 */
export declare const DESTINATION_ERROR_HTTP_STATUS: Record<ActivateErrorCode, number>;
export interface SetDestinationInput {
    lat: unknown;
    lng: unknown;
    label: unknown;
}
export declare function activateDestination(driverId: string, input: SetDestinationInput): Promise<ActivateResult>;
/** Turn the mode off (fixture L7b: the driver gets a push stating why). Idempotent. */
export declare function clearDestination(driverId: string): Promise<{
    ok: true;
    status: DestinationStatus;
}>;
/** Banner/status for the driver app (DB-persisted — survives reconnects). */
export declare function getDestinationStatus(driverId: string): Promise<DestinationStatus>;
/**
 * A COMPLETED trip (driver:ride:complete) does two things to the active
 * session, both row-guarded by `ended_at IS NULL`:
 *   1. trips_completed += 1  — the audit counter on the session row;
 *   2. the idle timer resets to NOW() + destination_max_minutes_without_trip
 *      on BOTH the session row (the sweep reads this one) and driver_profiles
 *      (the banner/status read this one).
 * Returns true only if an active session was touched. Fire-and-forget from the
 * socket handler: destination bookkeeping must never block or fail a ride.
 * A driver with no active session gets nothing — a completed trip does NOT
 * start a session or burn a daily use.
 */
export declare function noteDestinationTripCompleted(driverId: string, rideId: string): Promise<boolean>;
export type DestinationEndReason = "arrived" | "offline" | "timeout_3h" | "feature_disabled";
/** Structural slice of socket.io's `io.to(room).emit(...)` — tests pass makeIo(). */
export interface DestinationEmitTarget {
    to(room: string): {
        emit(event: string, payload: unknown): unknown;
    };
}
interface SweepRow {
    id: string;
    driver_id: string;
    lat: number;
    lng: number;
    label: string;
    expires_at: string | Date | null;
    current_lat: number | null;
    current_lng: number | null;
    last_location_at: string | Date | null;
    last_heartbeat_at: string | Date | null;
    is_online: boolean | null;
    status: string;
    firebase_uid: string | null;
}
/**
 * One active session → the reason it must end, or null to keep it running.
 * Exported for unit tests: the precedence order and the freshness guard on the
 * arrival check are the two subtle bits.
 *
 * L7a (arrived) is only trusted with a GPS fix younger than
 * `max_position_age_seconds` (Module 1's position-age config): a phone parked
 * at the drop-off an hour ago has not "arrived", and ending on a stale
 * coordinate is how a working mode dies while the app sits in a pocket.
 */
export declare function classifyDestinationEnd(row: SweepRow, destCfg: DestinationConfig, mainCfg: {
    max_position_age_seconds: number;
}): DestinationEndReason | null;
/**
 * Arrival check on EVERY driver GPS ping (§8.1 L7a) — the sweep stays as the
 * backup. The socket handler only calls this when the profile row it just
 * UPDATEd still carries a destination (destination_lat IS NOT NULL), so the
 * extra indexed query (idx_destination_sessions_active) hits only drivers with
 * an active session — never the whole fleet.
 *
 * The ping itself is a fresh GPS fix, so no position-age guard is needed here
 * (unlike the sweep, which reads stored coordinates).
 */
export declare function onDriverPingPosition(io: DestinationEmitTarget, driverId: string, lat: number, lng: number): Promise<boolean>;
/**
 * Close every session that has hit an end condition. Returns how many were
 * ended by THIS run (0 also when a run was skipped by the guard).
 */
export declare function sweepDestinationSessionsOnce(io: DestinationEmitTarget): Promise<number>;
export {};
//# sourceMappingURL=destinationSession.d.ts.map