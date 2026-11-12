export interface CompensationConfig {
    /** Seconds the driver waits for free after arriving. */
    waitFreeSeconds: number;
    /** Rand per full minute of chargeable waiting. */
    waitPerMinuteRands: number;
    /** Hard cap on one trip's waiting charge. */
    waitCapRands: number;
    /** Rand per stop after the first. */
    stopFeeRands: number;
    /** Rider-facing late-cancellation fee. */
    cancelFeeRands: number;
    /** No fee when the rider cancels within this many minutes of the accept. */
    cancelGraceMinutes: number;
    /** Part of the cancellation fee paid to the driver. */
    driverCancelCompRands: number;
}
export declare function compensationConfig(): CompensationConfig;
/**
 * Chargeable waiting. Billed per started 30 seconds after the free window, so
 * a driver is never under-paid for a 31-second wait, and capped.
 */
export declare function waitingFeeRands(waitSeconds: number, cfg?: CompensationConfig): number;
/** Extra stops after the first are charged a flat fee each. */
export declare function stopFeeRands(stopCount: number, cfg?: CompensationConfig): number;
/** Rider-facing late-cancellation decision. */
export declare function cancellationDecision(status: string, acceptedAtMs: number | null, nowMs?: number, cfg?: CompensationConfig): {
    feeRands: number;
    driverCompRands: number;
    reason: string | null;
};
export interface TripExtras {
    waitFeeRands: number;
    stopFeeRands: number;
    totalRands: number;
}
/**
 * Waiting + stops for one trip. `waitEndMs` is when the trip started (or when
 * it ended, if the driver never started it).
 */
export declare function tripExtras(arrivedAtMs: number | null, waitEndMs: number | null, stopCount: number, cfg?: CompensationConfig): TripExtras;
/**
 * Add waiting and stop compensation to a completed trip's fare and persist the
 * split. Idempotent: once wait_fee/stop_fee are set, a replayed completion
 * does not charge them twice.
 *
 * Returns the final fare the rider owes and the two fee components.
 */
export declare function applyTripExtras(rideId: string, baseFareRands: number, nowMs?: number): Promise<{
    fareRands: number;
    waitFeeRands: number;
    stopFeeRands: number;
}>;
/**
 * Pay the driver their share of a late-cancellation fee. The rider-facing fee
 * is already stored on the ride by the cancel paths; this books the driver's
 * part once (idempotent on ride + note) so a cancelled trip is not free work.
 */
export declare function creditCancellationComp(rideId: string, driverId: string | null, feeRands: number): Promise<number>;
//# sourceMappingURL=compensation.d.ts.map