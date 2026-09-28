import type { Server as SocketIOServer } from "socket.io";
/** How long one driver has to answer before the ride moves on. */
export declare const OFFER_TTL_SECONDS = 15;
/** A driver is only a candidate if we heard from them this recently. */
export declare const LOCATION_FRESH_SECONDS = 30;
/** Stop offering after this many rounds so a ride can't churn forever. */
export declare const MAX_OFFER_ROUNDS = 12;
/** No location/heartbeat for this long while "available" => demote to offline. */
export declare const DRIVER_STALE_SECONDS = 45;
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
 * Closest drivers who are: available, recently heard from, not already offered
 * this ride, not on another trip, and not the rider themselves.
 */
export declare function findCandidates(rideId: string, pickupLat: number, pickupLng: number, limit?: number): Promise<Candidate[]>;
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
 * push always goes out too — that is the only thing that works when the app is
 * closed, which is what made rides "never arrive".
 */
export declare function offerToNextDriver(io: SocketIOServer, rideId: string, round?: number): Promise<OfferResult>;
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
 * Durable offer expiry — called by the worker every couple of seconds.
 *
 * This is deliberately DB-driven (like SchedulingService) instead of an in-memory
 * setTimeout: a deploy/restart mid-dispatch must not strand a rider waiting for a
 * driver who will never be asked again.
 */
export declare function expireOffers(io: SocketIOServer): Promise<number>;
/**
 * Heartbeat sweep: a driver who stopped reporting location/socket for too long
 * stops being a candidate. Without this, a force-quit driver kept absorbing
 * offers nobody could answer — one of the reasons riders waited forever.
 */
export declare function sweepStaleDrivers(io: SocketIOServer): Promise<number>;
/** Rider cancelled (or the ride died): kill pending offers + tell those drivers. */
export declare function cancelPendingOffers(io: SocketIOServer, rideId: string, reason?: string): Promise<number>;
/** Driver is free again (trip finished / driver cancelled). */
export declare function releaseDriver(driverId: string): Promise<void>;
export {};
//# sourceMappingURL=dispatch.d.ts.map