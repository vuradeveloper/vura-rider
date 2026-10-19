/** Mint (or keep) the ride's PIN. Called once per healthy accept. */
export declare function mintRidePin(rideId: string): Promise<void>;
/**
 * The rider's copy. Ownership-checked: only the ride's passenger may read it,
 * and only while the trip has not started (verified/cancelled rides return
 * nothing — the secret is already spent or dead).
 */
export declare function getRidePinForRider(rideId: string, riderId: string): Promise<{
    pin: string;
    locked: boolean;
} | null>;
export type PinVerify = {
    ok: true;
} | {
    ok: false;
    error: "wrong";
    attempts_left: number;
} | {
    ok: false;
    error: "locked" | "not_allowed";
};
/**
 * The driver's attempt, called from `driver:ride:begin` BEFORE the status
 * flips to in_progress. Wrong attempts are counted; at the configured limit
 * the code locks (rider alerted by the caller) and every attempt is journaled
 * into safety_events for review.
 */
export declare function verifyRidePin(rideId: string, driverId: string, entered: string): Promise<PinVerify>;
//# sourceMappingURL=pinService.d.ts.map