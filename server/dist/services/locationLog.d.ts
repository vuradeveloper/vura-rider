/**
 * Record one point of the active trip. Fire-and-forget at the call site —
 * a history failure must never break a GPS ping the rider's map relies on.
 */
export declare function logRidePoint(rideId: string, driverId: string, lat: number, lng: number): Promise<void>;
/** Recent path for one ride (admin map + anomaly review). */
export declare function ridePath(rideId: string, limit?: number): Promise<Array<{
    lat: number;
    lng: number;
    recorded_at: string;
}>>;
/**
 * Delete points past the retention window. Returns the number of rows
 * removed. Runs from the safety worker (daily) — one quiet query.
 */
export declare function purgeOldLocations(): Promise<number>;
/** Last known point for a ride (check-in/SOS payload enrichment). */
export declare function lastRidePoint(rideId: string): Promise<{
    lat: number;
    lng: number;
    recorded_at: string;
} | null>;
//# sourceMappingURL=locationLog.d.ts.map