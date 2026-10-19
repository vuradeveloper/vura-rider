import { type SafetySettings } from "./safetyConfig";
export type AnomalyType = "deviation" | "long_stop" | "overrun" | "gps_silence";
export interface TripPoint {
    lat: number;
    lng: number;
    recorded_at: Date | string;
}
export interface TripGeometry {
    pickup: {
        lat: number;
        lng: number;
    };
    dropoff: {
        lat: number;
        lng: number;
    };
}
/** Great-circle distance in metres. */
export declare function haversineM(a: {
    lat: number;
    lng: number;
}, b: {
    lat: number;
    lng: number;
}): number;
/** Shortest distance from point p to the segment a→b (cross-track, metres). */
export declare function distToSegmentM(p: {
    lat: number;
    lng: number;
}, a: {
    lat: number;
    lng: number;
}, b: {
    lat: number;
    lng: number;
}): number;
/** (a) Route deviation: any point farther than cfg.deviation_m from the
 *  pickup→drop-off corridor. data = { max_m } for the console. */
export declare function evaluateDeviation(points: TripPoint[], geo: TripGeometry, cfg: Pick<SafetySettings, "deviation_m">): {
    detected: boolean;
    data?: Record<string, unknown>;
};
/** (b) Unnecessary stop: a stationary run (points within 15 m of the run's
 *  first fix) lasting cfg.stop_seconds, whose location is farther than
 *  cfg.stop_exclusion_m from BOTH endpoints. */
export declare function evaluateStop(points: TripPoint[], geo: TripGeometry, cfg: Pick<SafetySettings, "stop_seconds" | "stop_exclusion_m">): {
    detected: boolean;
    data?: Record<string, unknown>;
};
/** (c) Trip far longer than estimated: expected time = direct distance at an
 *  assumed 25 km/h + 10 min buffer; flag only past pct-over AND floor seconds. */
export declare function evaluateOverrun(startedAt: Date | string | null, geo: TripGeometry, now: Date, cfg: Pick<SafetySettings, "overrun_pct" | "overrun_min_s">): {
    detected: boolean;
    data?: Record<string, unknown>;
};
/** (d) GPS silent: no ping for cfg.gps_silence_s while the trip runs. */
export declare function evaluateSilence(lastPointAt: Date | string | null, tripStartedAt: Date | string | null, now: Date, cfg: Pick<SafetySettings, "gps_silence_s">): {
    detected: boolean;
    data?: Record<string, unknown>;
};
export interface ActiveSafetyRide {
    id: string;
    driver_id: string | null;
    pickup_lat: number | null;
    pickup_lng: number | null;
    destination_lat: number | null;
    destination_lng: number | null;
    trip_started_at: Date | null;
}
/** In-progress rides with both endpoints known (the only ones we judge). */
export declare function loadActiveSafetyRides(): Promise<ActiveSafetyRide[]>;
/** Record an anomaly unless one of the same type is still open on the ride. */
export declare function recordAnomaly(ride: ActiveSafetyRide, type: AnomalyType, data: Record<string, unknown>): Promise<boolean>;
/**
 * One sweep over every active trip: evaluate all four detectors and record
 * fresh anomalies. Returns the rides that produced something (the worker
 * turns those into rider check-ins). Safe to run concurrently — recordAnomaly
 * dedupes per (ride, type).
 */
export declare function sweepAnomalies(): Promise<Array<{
    rideId: string;
    type: AnomalyType;
    data: Record<string, unknown>;
}>>;
//# sourceMappingURL=anomalyDetection.d.ts.map