export interface DriverPosition {
    userId: string;
    lat: number;
    lng: number;
    heading?: number | null;
    status: string;
    tier?: string | null;
}
export interface IndexedDriver extends DriverPosition {
    cell: string;
    lastSeenAt: string;
}
/**
 * The contract a Redis implementation would also satisfy.
 * Callers depend on this, never on the SQL behind it.
 */
export interface DriverIndex {
    upsert(p: DriverPosition): Promise<IndexedDriver | null>;
    getDriver(userId: string): Promise<IndexedDriver | null>;
    getDriversInCells(cells: string[], limit?: number): Promise<IndexedDriver[]>;
    remove(userId: string): Promise<boolean>;
    evictStale(olderThanSeconds?: number): Promise<number>;
    /** Refresh liveness WITHOUT a new position — used by driver:heartbeat. */
    touch(userId: string, status?: string | null): Promise<boolean>;
    countFresh(olderThanSeconds?: number): Promise<number>;
}
/**
 * THE single definition of "matchable" (Q8).
 *
 * The database stores 'available' and that value is NOT being renamed. Matching
 * used to inline `COALESCE(dp.status, ...) = 'available'` in several places,
 * which is how the semantics drift apart. Everything now resolves through here,
 * so there is exactly one place that decides who can be offered a ride.
 *
 * Module 2's destination mode deliberately does NOT add a status (restatement
 * Q3, CHANGED): the driver stays 'available' and gets destination ATTRIBUTES
 * instead — the destinationFit predicate in dispatch.ts restricts who they
 * match. Should a genuine new availability status ever arrive, it is added
 * HERE and nowhere else.
 */
export declare const MATCHABLE_STATUSES: readonly ["available"];
export declare function isMatchableStatus(status: string | null | undefined): boolean;
export declare const driverIndex: DriverIndex;
export declare function getDriverIndex(): DriverIndex;
export declare function setDriverIndex(impl: DriverIndex): void;
//# sourceMappingURL=driverIndex.d.ts.map