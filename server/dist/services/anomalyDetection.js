"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.haversineM = haversineM;
exports.distToSegmentM = distToSegmentM;
exports.evaluateDeviation = evaluateDeviation;
exports.evaluateStop = evaluateStop;
exports.evaluateOverrun = evaluateOverrun;
exports.evaluateSilence = evaluateSilence;
exports.loadActiveSafetyRides = loadActiveSafetyRides;
exports.recordAnomaly = recordAnomaly;
exports.sweepAnomalies = sweepAnomalies;
// ─────────────────────────────────────────────────────────────────────────────
// ANOMALY DETECTION — compares the trip's live path against the expected
// route (§1). PURE evaluation functions (unit-tested) + the DB orchestration
// that records findings; the check-in/escalation flow lives in checkinService.
//
// Thresholds all come from safety_config so false alarms (traffic, road
// closures, rider-agreed detours) are tunable from the admin console.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const safetyConfig_1 = require("./safetyConfig");
const R = 6371000; // earth radius (m)
function rad(d) { return (d * Math.PI) / 180; }
/** Great-circle distance in metres. */
function haversineM(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
/** Shortest distance from point p to the segment a→b (cross-track, metres). */
function distToSegmentM(p, a, b) {
    const d13 = haversineM(a, p) / R;
    const theta13 = Math.atan2(Math.sin(rad(p.lng - a.lng)) * Math.cos(rad(p.lat)), Math.cos(rad(a.lat)) * Math.sin(rad(p.lat)) -
        Math.sin(rad(a.lat)) * Math.cos(rad(p.lat)) * Math.cos(rad(p.lng - a.lng)));
    const theta12 = Math.atan2(Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat)), Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
        Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng)));
    const dxt = Math.asin(Math.sin(d13) * Math.sin(theta13 - theta12)) * R;
    return Math.abs(dxt);
}
function tMs(p) {
    return new Date(p.recorded_at).getTime();
}
/** (a) Route deviation: any point farther than cfg.deviation_m from the
 *  pickup→drop-off corridor. data = { max_m } for the console. */
function evaluateDeviation(points, geo, cfg) {
    let max = 0;
    for (const p of points) {
        const d = distToSegmentM(p, geo.pickup, geo.dropoff);
        if (d > max)
            max = d;
    }
    if (points.length >= 3 && max > cfg.deviation_m) {
        return { detected: true, data: { max_m: Math.round(max), limit_m: cfg.deviation_m } };
    }
    return { detected: false };
}
/** (b) Unnecessary stop: a stationary run (points within 15 m of the run's
 *  first fix) lasting cfg.stop_seconds, whose location is farther than
 *  cfg.stop_exclusion_m from BOTH endpoints. */
function evaluateStop(points, geo, cfg) {
    // Longest stationary run: consecutive fixes within 15 m of the run's first
    // fix. (No closure here on purpose — a helper-closure assignment defeats
    // TypeScript's narrowing of the worst-run locals.)
    let worstMs = 0;
    let worstAnchor = null;
    let runStart = 0;
    let runAnchor = null;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (runAnchor && haversineM(p, runAnchor) <= 15)
            continue; // still stopped
        if (runAnchor) {
            const ms = tMs(points[i - 1]) - tMs(points[runStart]);
            if (ms > worstMs) {
                worstMs = ms;
                worstAnchor = runAnchor;
            }
        }
        runStart = i;
        runAnchor = p;
    }
    if (runAnchor) {
        const ms = tMs(points[points.length - 1]) - tMs(points[runStart]);
        if (ms > worstMs) {
            worstMs = ms;
            worstAnchor = runAnchor;
        }
    }
    if (!worstAnchor || worstMs < cfg.stop_seconds * 1000)
        return { detected: false };
    const anchor = worstAnchor;
    const nearPickup = haversineM(anchor, geo.pickup) <= cfg.stop_exclusion_m;
    const nearDrop = haversineM(anchor, geo.dropoff) <= cfg.stop_exclusion_m;
    if (nearPickup || nearDrop)
        return { detected: false }; // waiting is normal here
    return {
        detected: true,
        data: {
            seconds: Math.round(worstMs / 1000),
            at_lat: anchor.lat,
            at_lng: anchor.lng,
            limit_s: cfg.stop_seconds,
        },
    };
}
/** (c) Trip far longer than estimated: expected time = direct distance at an
 *  assumed 25 km/h + 10 min buffer; flag only past pct-over AND floor seconds. */
function evaluateOverrun(startedAt, geo, now, cfg) {
    if (!startedAt)
        return { detected: false };
    const elapsedS = Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000);
    if (elapsedS <= 0)
        return { detected: false };
    const directKm = haversineM(geo.pickup, geo.dropoff) / 1000;
    const expectedS = Math.round((directKm / 25) * 3600) + 600; // 25 km/h + 10 min
    const limitS = Math.round((expectedS * (100 + cfg.overrun_pct)) / 100);
    if (elapsedS > limitS && elapsedS - expectedS > cfg.overrun_min_s) {
        return {
            detected: true,
            data: { elapsed_s: elapsedS, expected_s: expectedS, limit_s: limitS },
        };
    }
    return { detected: false };
}
/** (d) GPS silent: no ping for cfg.gps_silence_s while the trip runs. */
function evaluateSilence(lastPointAt, tripStartedAt, now, cfg) {
    if (!tripStartedAt)
        return { detected: false };
    const baseline = lastPointAt
        ? Math.max(new Date(lastPointAt).getTime(), new Date(tripStartedAt).getTime())
        : new Date(tripStartedAt).getTime();
    const silentS = Math.floor((now.getTime() - baseline) / 1000);
    if (silentS > cfg.gps_silence_s) {
        return { detected: true, data: { silent_s: silentS, limit_s: cfg.gps_silence_s } };
    }
    return { detected: false };
}
/** In-progress rides with both endpoints known (the only ones we judge). */
async function loadActiveSafetyRides() {
    await (0, safetyConfig_1.ensureSafetyTables)();
    return (0, database_1.query)(`SELECT id, driver_id, pickup_lat, pickup_lng, destination_lat, destination_lng,
            trip_started_at
       FROM rides
      WHERE status = 'in_progress'
        AND trip_started_at IS NOT NULL
        AND pickup_lat IS NOT NULL AND destination_lat IS NOT NULL
      LIMIT 200`);
}
/** Record an anomaly unless one of the same type is still open on the ride. */
async function recordAnomaly(ride, type, data) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const open = await (0, database_1.queryOne)(`SELECT id FROM ride_anomalies
      WHERE ride_id = $1 AND type = $2 AND status IN ('new','checkin_sent','no_response','escalated')
      LIMIT 1`, [ride.id, type]).catch(() => null);
    if (open)
        return false;
    await (0, database_1.execute)(`INSERT INTO ride_anomalies (ride_id, driver_id, type, severity, data, status)
     VALUES ($1, $2, $3, 'warn', $4::jsonb, 'new')`, [ride.id, ride.driver_id, type, JSON.stringify(data)]);
    return true;
}
/**
 * One sweep over every active trip: evaluate all four detectors and record
 * fresh anomalies. Returns the rides that produced something (the worker
 * turns those into rider check-ins). Safe to run concurrently — recordAnomaly
 * dedupes per (ride, type).
 */
async function sweepAnomalies() {
    const cfg = await (0, safetyConfig_1.getSafetySettings)();
    const rides = await loadActiveSafetyRides();
    const found = [];
    const now = new Date();
    for (const ride of rides) {
        try {
            const geo = {
                pickup: { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) },
                dropoff: { lat: Number(ride.destination_lat), lng: Number(ride.destination_lng) },
            };
            const points = await (0, database_1.query)(`SELECT lat, lng, recorded_at FROM ride_location_points
          WHERE ride_id = $1 AND recorded_at >= COALESCE($2, NOW() - INTERVAL '12 hours')
          ORDER BY recorded_at ASC LIMIT 1500`, [ride.id, ride.trip_started_at]).catch(() => []);
            const checks = [
                ["deviation", evaluateDeviation(points, geo, cfg)],
                ["long_stop", evaluateStop(points, geo, cfg)],
                ["overrun", evaluateOverrun(ride.trip_started_at, geo, now, cfg)],
                [
                    "gps_silence",
                    evaluateSilence(points.length ? points[points.length - 1].recorded_at : null, ride.trip_started_at, now, cfg),
                ],
            ];
            for (const [type, verdict] of checks) {
                if (!verdict.detected || !verdict.data)
                    continue;
                if (await recordAnomaly(ride, type, verdict.data)) {
                    found.push({ rideId: ride.id, type, data: verdict.data });
                }
            }
        }
        catch (err) {
            console.warn(`[safety] sweep failed for ride ${ride.id}:`, err?.message || err);
        }
    }
    return found;
}
//# sourceMappingURL=anomalyDetection.js.map