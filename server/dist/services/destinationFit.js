"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// DESTINATION FIT — the approved Module 2 Q5 predicate (§8.2 of
// _MODULE2_RESTATEMENT.md), as a PURE function: no DB, no config reads, no
// time/queue dependence. Thresholds are injectable (they live in app_config
// under the `destination` key and are passed in by the caller).
//
//   (a) pickup within the normal matching radius → the eligibility SQL, never here
//   (b) hav(X,T) < hav(P,T)                       strictly closer than the pickup
//   (c) hav(X,T) ≤ 3 km  OR  (|xt| ≤ 5 km AND −0.5 ≤ along ≤ dAB + 0.5)
//
// Coordinates are WGS84 degrees, distances in km, R = 6371 km — the SAME
// constant as the matching SQL's `6371 * acos(...)`.
//
// Verdicts: "accept" (offer to the destination-mode driver),
// "reject" (skip this driver for this ride), "skip" (no usable geometry —
// e.g. the ride has no drop-off: destination-mode driver is skipped,
// plain drivers unaffected).
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.EARTH_R_KM = exports.DEFAULT_FIT_THRESHOLDS = void 0;
exports.havKm = havKm;
exports.bearingDeg = bearingDeg;
exports.destinationFit = destinationFit;
/** Seed values — mirror app_config key `destination` (002 migration). */
exports.DEFAULT_FIT_THRESHOLDS = {
    dropoffRadiusKm: 3,
    crossTrackKm: 5,
    alongTolKm: 0.5,
};
/** Mean Earth radius — identical to the matching SQL. */
exports.EARTH_R_KM = 6371;
const DEG = Math.PI / 180;
const clamp = (v) => Math.min(1, Math.max(-1, v));
const finite = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
/** Great-circle distance (haversine), km. */
function havKm(a, b) {
    const dLat = (b.lat - a.lat) * DEG;
    const dLng = (b.lng - a.lng) * DEG;
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
    return 2 * exports.EARTH_R_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, s))));
}
/** Initial bearing A→B in degrees [0, 360). */
function bearingDeg(a, b) {
    const p1 = a.lat * DEG;
    const p2 = b.lat * DEG;
    const dLng = (b.lng - a.lng) * DEG;
    const y = Math.sin(dLng) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
    return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}
/**
 * The approved rule. D = driver, T = driver destination, P = ride pickup,
 * X = ride drop-off (null/undefined ⇒ "skip").
 *
 * Pure and deterministic: fixture 9 runs it repeatedly and demands identical
 * verdicts. Missing or non-finite geometry fails closed as "skip".
 */
function destinationFit(D, T, P, X, th = exports.DEFAULT_FIT_THRESHOLDS) {
    if (!D || !T || !P || !X)
        return "skip";
    if (!finite(D) || !finite(T) || !finite(P) || !finite(X))
        return "skip";
    const dAP = havKm(D, X); // driver → drop-off
    const dAB = havKm(D, T); // driver → destination (line length)
    const dtX = havKm(X, T); // drop-off → destination
    const dtP = havKm(P, T); // pickup → destination
    // (b) strictly closer — inclusive equality REJECTS (fixture 6c).
    if (!(dtX < dtP))
        return "reject";
    // (c1) pure 3 km disk around T — no along-track limit (approved wording:
    // a drop-off ≤ 3 km from the destination is accepted from anywhere).
    if (dtX <= th.dropoffRadiusKm)
        return "accept";
    // (c2) cross-track corridor + along-track segment between D and T ± tol.
    let xt;
    let along;
    if (dAB < 1e-9) {
        // Driver already AT the destination: only the disk reading survives
        // (fixture 8) — the along-check is skipped entirely.
        xt = dAP;
        along = null;
    }
    else {
        const theta = bearingDeg(D, T);
        const thetaAP = bearingDeg(D, X);
        const delta = thetaAP - theta;
        xt = exports.EARTH_R_KM * Math.asin(clamp(Math.sin(dAP / exports.EARTH_R_KM) * Math.sin(delta * DEG)));
        const at = exports.EARTH_R_KM * Math.acos(clamp(Math.cos(dAP / exports.EARTH_R_KM) / Math.cos(xt / exports.EARTH_R_KM)));
        // Sign: toward the destination (cos Δ > 0) or behind the driver.
        along = (Math.cos(delta * DEG) >= 0 ? 1 : -1) * at;
    }
    if (Math.abs(xt) > th.crossTrackKm)
        return "reject";
    if (along !== null && (along < -th.alongTolKm || along > dAB + th.alongTolKm))
        return "reject";
    return "accept";
}
//# sourceMappingURL=destinationFit.js.map