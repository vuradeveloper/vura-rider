export type LatLon = {
    lat: number;
    lng: number;
};
/**
 * Road-ETA provider: returns minutes per target (null = unknown for that one).
 * Injectable so tests can pin ranking without a network.
 */
export type RoadEtaImpl = (pickup: LatLon, targets: LatLon[]) => Promise<(number | null)[]>;
/** Test seam: replace the provider (null = haversine-only, no network). */
export declare function setRoadEtaImpl(fn: RoadEtaImpl | null): void;
/** Test seam: back to the configured-provider default. */
export declare function resetRoadEtaImpl(): void;
/**
 * The OSRM-compatible base URL, read LAZILY (dotenv/import-order safe).
 * null = not configured = haversine only. No public-demo default, ever.
 */
export declare function etaProviderUrl(): string | null;
/**
 * Log the ETA provider decision ONCE, at startup (index.ts calls this).
 * Answers: "is ROUTE_PROVIDER_URL set, and what happens if it is not?"
 */
export declare function logEtaProviderStatus(): void;
/** Straight-line minutes at the configured average city speed. */
export declare function haversineEtaMinutes(pickup: LatLon, target: LatLon, avgSpeedKmh: number): number;
/**
 * Minutes-to-pickup for every target, road ETA first, haversine fallback
 * per-entry (one slow target does not demote the rest).
 */
export declare function etaMinutesList(pickup: LatLon, targets: LatLon[], avgSpeedKmh: number): Promise<number[]>;
//# sourceMappingURL=eta.d.ts.map