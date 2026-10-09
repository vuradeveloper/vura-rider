export interface GeoPoint {
    lat: number;
    lng: number;
}
export type DestinationVerdict = "accept" | "reject" | "skip";
export interface FitThresholds {
    /** (c1) pure disk around the destination. */
    dropoffRadiusKm: number;
    /** (c2) max cross-track (perpendicular) offset from the D→T line. */
    crossTrackKm: number;
    /** (c2) along-track tolerance past the driver / past the destination. */
    alongTolKm: number;
}
/** Seed values — mirror app_config key `destination` (002 migration). */
export declare const DEFAULT_FIT_THRESHOLDS: FitThresholds;
/** Mean Earth radius — identical to the matching SQL. */
export declare const EARTH_R_KM = 6371;
/** Great-circle distance (haversine), km. */
export declare function havKm(a: GeoPoint, b: GeoPoint): number;
/** Initial bearing A→B in degrees [0, 360). */
export declare function bearingDeg(a: GeoPoint, b: GeoPoint): number;
/**
 * The approved rule. D = driver, T = driver destination, P = ride pickup,
 * X = ride drop-off (null/undefined ⇒ "skip").
 *
 * Pure and deterministic: fixture 9 runs it repeatedly and demands identical
 * verdicts. Missing or non-finite geometry fails closed as "skip".
 */
export declare function destinationFit(D: GeoPoint | null | undefined, T: GeoPoint | null | undefined, P: GeoPoint | null | undefined, X: GeoPoint | null | undefined, th?: FitThresholds): DestinationVerdict;
//# sourceMappingURL=destinationFit.d.ts.map