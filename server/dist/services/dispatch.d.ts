import type { Server as SocketIOServer } from "socket.io";
import type { AppConfig } from "./config";
/** How long one driver has to answer before the ride moves on. */
export declare const OFFER_TTL_SECONDS = 15;
/** A driver is only a candidate if we heard from them this recently. */
export declare const LOCATION_FRESH_SECONDS = 20;
/** Stop offering after this many rounds so a ride can't churn forever. */
export declare const MAX_OFFER_ROUNDS = 12;
/**
 * Does the driver's personal room hold a connected socket RIGHT NOW?
 *
 * The truthful replacement for the old `Boolean(firebase_uid)` guess: a uid
 * says the driver once logged in, nothing about this instant. Reads the same
 * socket.io v4 structure production emits into (handlers.ts joins `user:<uid>`
 * on connect). No adapter or no room => nobody is listening. Never throws.
 */
export declare function hasLiveSocket(io: unknown, room: string): boolean;
/** No location/heartbeat for this long while "available" => demote to offline. */
export declare const DRIVER_STALE_SECONDS = 20;
type OfferResult = {
    offered: boolean;
    driverId?: string;
    reason?: string;
};
/** Append one line to the dispatch trail (never throws). */
export declare function logRideEvent(rideId: string | null, driverId: string | null, event: string, detail?: unknown): Promise<void>;
/** Emit to the ride room AND the user's personal room (survives reconnects). */
export declare function emitRide(io: SocketIOServer, rideId: string, event: string, payload: Record<string, unknown>, firebaseUid?: string | null): void;
export interface Candidate {
    id: string;
    firebase_uid: string | null;
    current_lat: number;
    current_lng: number;
    distance_km: number;
}
/**
 * How many 15s offer rounds fit inside search_timeout_ms (90s / 15s = 6).
 * Round maxRounds+1 returns zero candidates, offerToNextDriver parks the ride
 * and emits ride:no:drivers — so the rider-facing "no drivers" lands at ~90s,
 * not MAX_OFFER_ROUNDS * 15s = 180s. Capped by MAX_OFFER_ROUNDS so the flag-on
// path can never exceed the global churn guard either.
 */
export declare function h3MaxOfferRounds(cfg: {
    search_timeout_ms: number;
    offer_ttl_seconds: number;
}): number;
/**
 * Escalation ladder: rounds are spread evenly across match_radius_km, so with
 * [3,5,7] and a 6-round budget it is 3km -> rounds 1-2, 5km -> 3-4, 7km -> 5-6.
 * null past the budget = stop searching (caller reports no-drivers).
 */
export declare function radiusForRound(round: number, ladder: number[], maxRounds: number): number | null;
/**
 * Stable 0-99 bucket for a rider id (FNV-1a).
 *
 * Deterministic across processes and deploys — the same rider always lands in
 * the same bucket, so raising h3_rollout_percent widens the cohort but never
 * flips an individual rider's path back and forth between requests.
 */
export declare function riderBucket(riderId: string): number;
export type H3RolloutDecision = {
    useH3: boolean;
    reason: string;
};
type RolloutConfig = Pick<AppConfig, "h3_matching_enabled" | "h3_rollout_mode" | "h3_rollout_rider_ids" | "h3_rollout_percent">;
/**
 * Which path serves THIS ride. Master kill switch first: h3_matching_enabled
 * false => legacy for everyone, no matter what the rollout says.
 * Pure function — no cache, no I/O — so allowlist changes take effect on the
 * next request even inside the 10s config cache window... (the config values
 * themselves still refresh every 10s like everything else).
 */
export declare function decideH3Path(cfg: RolloutConfig, riderId: string | null): H3RolloutDecision;
/**
 * Matching entry point — rollout + kill-switch decision (one place).
 *
 * EVERY call records a `matching_path` trace stage {path: "h3"|"legacy",
 * reason}, so each ride shows exactly which path served it and why.
 *
 *   legacy  : the original haversine query above, byte-for-byte unchanged —
 *             used when the kill switch is off, the rollout excludes this
 *             rider, the mode is 'off', or config cannot be read.
 *   h3      : H3 cell lookup -> exact haversine <= radius -> eligibility
 *             filters (MATCHABLE_STATUSES from driverIndex, vehicle category,
 *             min rating, driver_blocks) -> rank by road ETA (haversine
 *             fallback) -> a ranked pool for the one-at-a-time offer loop.
 *
 * FAILURE POLICY: any throw anywhere in the H3 path (config, index, SQL, ETA)
 * is logged with an `h3_path_failed` trace stage and the request re-runs on the
 * haversine path. The rider is never left waiting and matching never fails
 * closed; a cold index (rollout guard) or empty area also falls back rather
 * than reporting a false "no drivers".
 */
export declare function findCandidates(rideId: string, pickupLat: number, pickupLng: number, limit?: number, ignorePreviousOffers?: boolean, round?: number, riderId?: string | null): Promise<Candidate[]>;
export interface DispatchRide {
    id: string;
    status: string;
    passenger_id: string;
    pickup_address: string | null;
    pickup_lat: number | null;
    pickup_lng: number | null;
    destination_address: string | null;
    destination_lat: number | null;
    destination_lng: number | null;
    estimated_fare: number | null;
    payment_method: string | null;
    waypoints: unknown;
    offer_round: number | null;
    version: number | null;
    passenger_fb: string | null;
}
export declare function loadRide(rideId: string): Promise<DispatchRide | null>;
/**
 * Offer the ride to the closest not-yet-tried driver.
 *
 * Emits BOTH events to that driver only: `ride:offer` (new, carries offerId and
 * the deadline so the offer screen can count down) and `ride:request` (the event
 * today's driver app already listens to, so nothing regresses). A high-priority
 * push always goes out too â€” that is the only thing that works when the app is
 * closed, which is what made rides "never arrive".
 */
export declare function offerToNextDriver(io: SocketIOServer, rideId: string, round?: number, opts?: {
    revive?: boolean;
}): Promise<OfferResult>;
/** No driver left (or too many rounds): park the ride and tell the rider. */
export declare function markNoDrivers(io: SocketIOServer, rideId: string): Promise<void>;
/** Entry point when a rider books (socket handler calls this after INSERT). */
export declare function startDispatch(io: SocketIOServer, rideId: string): Promise<OfferResult>;
export interface AcceptResult {
    ok: boolean;
    error?: string;
    rideId?: string;
    version?: number;
    duplicate?: boolean;
    /**
     * Drivers who still held a pending offer for this ride when it was won, and so
     * have to be told it is gone. Collected inside the accept transaction, acted on
     * after it commits.
     */
    losers?: string[];
}
/**
 * Atomically claim a ride for a driver.
 *
 * THE POINT: the old code read the ride, then ran an UPDATE with no status guard,
 * so two drivers accepting at once both "won" (last write wins) and a stale accept
 * could overwrite an accepted/cancelled ride. Here everything happens in ONE
 * transaction: the ride row is locked FOR UPDATE, the driver's pending offer (if
 * any) must still be inside its 15s window, and the UPDATE itself is guarded by
 * `AND status IN (...)`. Zero rows affected => "ride no longer available".
 *
 * Idempotent: calling it twice for the same driver returns ok + duplicate instead
 * of erroring, so a retry after a network blip is safe.
 */
export declare function acceptRide(io: SocketIOServer, params: {
    rideId: string;
    driverId: string;
}): Promise<AcceptResult>;
/** Single source of truth for the rider-facing "driver accepted" event. */
export declare function emitRideAccepted(io: SocketIOServer, rideId: string, driverId: string, version: number): Promise<void>;
/** Driver said no (or their app did it for them after the countdown). */
export declare function declineOffer(io: SocketIOServer, params: {
    rideId: string;
    driverId: string;
    reason?: string;
}): Promise<{
    ok: boolean;
    duplicate?: boolean;
    status?: string | null;
}>;
/**
 * Durable offer expiry â€” called by the worker every couple of seconds.
 *
 * This is deliberately DB-driven (like SchedulingService) instead of an in-memory
 * setTimeout: a deploy/restart mid-dispatch must not strand a rider waiting for a
 * driver who will never be asked again.
 */
export declare function expireOffers(io: SocketIOServer): Promise<number>;
/**
 * Heartbeat sweep: a driver who stopped reporting location/socket for too long
 * stops being a candidate. Without this, a force-quit driver kept absorbing
 * offers nobody could answer â€” one of the reasons riders waited forever.
 */
export declare function sweepStaleDrivers(io: SocketIOServer): Promise<number>;
/**
 * Tell drivers who lost the race that the ride is gone — over both channels.
 *
 * WHY NOT JUST THE DATABASE: acceptRide decides the winner in ONE transaction
 * (correct — the row is the authority) and expires the losers' offers there. But a
 * row going to 'expired' is invisible to a phone. Before this, the losing driver's
 * request screen stayed up with a live countdown and tapping Accept failed with
 * "Ride no longer available" and no explanation, which is indistinguishable from a
 * broken app.
 *
 * Emits `ride:offer:cancelled` (what the native driver app already handles) AND
 * `ride:taken` (the same fact in a flatter shape), so either client build can drop
 * the request without a coordinated release.
 */
export declare function notifyLosingDrivers(io: SocketIOServer, rideId: string, driverUserIds: string[], reason?: string): Promise<number>;
/** Rider cancelled (or the ride died): kill pending offers + tell those drivers. */
export declare function cancelPendingOffers(io: SocketIOServer, rideId: string, reason?: string): Promise<number>;
/**
 * Retry rides that are still waiting for a driver.
 *
 * WHY: a ride used to be dispatched exactly once. If nobody was eligible in that
 * instant the ride was parked as 'no_drivers' and NOTHING ever offered it again â€”
 * the rider waited forever and the next driver to come online never saw it (this
 * is what a live field report looked like: `candidates_found {"count":0}` then a
 * parked ride). The worker calls this every few seconds, so a driver who comes
 * online moments later gets the ride, and a parked ride is un-parked back to
 * 'searching' when it is offered again.
 *
 * Guards: only rides younger than 15 minutes, with no live offer, and not retried
 * in the last ~6 seconds (prevents churn/loops), newest first.
 */
export declare function reviveWaitingRides(io: SocketIOServer, limit?: number): Promise<number>;
/** Driver is free again (trip finished / driver cancelled). */
export declare function releaseDriver(driverId: string): Promise<void>;
export {};
//# sourceMappingURL=dispatch.d.ts.map