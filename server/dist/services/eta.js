"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// ROAD ETA — rank candidates by drive time, not straight-line distance.
//
// WHY: a driver 2.5km away across a highway interchange can be further in TIME
// than a driver 3km away on the same road. Matching ranks by road ETA so the
// rider waits less; haversine-over-avg-speed is the FALLBACK, not the plan.
//
// PROVIDER (production-safe by default):
//   * ROUTE_PROVIDER_URL set     -> OSRM-compatible `/table` matrix API
//                                   (self-hosted OSRM, or any proxy speaking
//                                   that shape), one HTTP call for the whole
//                                   candidate pool, 700ms timeout.
//   * ROUTE_PROVIDER_URL unset   -> "ETA provider not configured": NO request
//                                   is ever made — especially NOT to the public
//                                   router.project-osrm.org demo, which is
//                                   rate-limited, unmonitored and unsuitable
//                                   for production matching. Haversine only.
//   * provider fails 5x in a row -> 60s circuit breaker (haversine meanwhile,
//                                   one warning) so a dead provider cannot add
//                                   latency to every dispatch.
// Start-up reports the choice exactly once via logEtaProviderStatus().
//
// Tests drive setRoadEtaImpl() so NO network call ever happens under vitest.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRoadEtaImpl = setRoadEtaImpl;
exports.resetRoadEtaImpl = resetRoadEtaImpl;
exports.etaProviderUrl = etaProviderUrl;
exports.logEtaProviderStatus = logEtaProviderStatus;
exports.haversineEtaMinutes = haversineEtaMinutes;
exports.etaMinutesList = etaMinutesList;
const h3_1 = require("../lib/h3");
/** Dispatch ranks candidates; it must never wait on a routing provider. */
const TABLE_TIMEOUT_MS = 700;
const MAX_CONSECUTIVE_FAILURES = 5;
const COOLDOWN_MS = 60_000;
let impl = undefined;
/** Test seam: replace the provider (null = haversine-only, no network). */
function setRoadEtaImpl(fn) {
    impl = fn;
}
/** Test seam: back to the configured-provider default. */
function resetRoadEtaImpl() {
    impl = undefined;
}
/**
 * The OSRM-compatible base URL, read LAZILY (dotenv/import-order safe).
 * null = not configured = haversine only. No public-demo default, ever.
 */
function etaProviderUrl() {
    const url = (process.env.ROUTE_PROVIDER_URL || "").trim().replace(/\/+$/, "");
    return url || null;
}
let statusLogged = false;
let consecutiveFailures = 0;
let cooldownUntil = 0;
/**
 * Log the ETA provider decision ONCE, at startup (index.ts calls this).
 * Answers: "is ROUTE_PROVIDER_URL set, and what happens if it is not?"
 */
function logEtaProviderStatus() {
    if (statusLogged)
        return;
    statusLogged = true;
    const url = etaProviderUrl();
    if (url) {
        let host = url;
        try {
            host = new URL(url).host;
        }
        catch {
            /* keep raw */
        }
        console.log(`[eta] ETA provider: OSRM-compatible table API at ${host} (ROUTE_PROVIDER_URL set), ${TABLE_TIMEOUT_MS}ms timeout`);
    }
    else {
        console.log("[eta] ETA provider not configured (ROUTE_PROVIDER_URL unset); using haversine fallback");
    }
}
/** Straight-line minutes at the configured average city speed. */
function haversineEtaMinutes(pickup, target, avgSpeedKmh) {
    const speed = Number.isFinite(avgSpeedKmh) && avgSpeedKmh > 0 ? avgSpeedKmh : 40;
    return ((0, h3_1.haversineKm)(pickup.lat, pickup.lng, target.lat, target.lng) / speed) * 60;
}
/** OSRM table (distance-matrix) call: ONE request for the whole pool. */
async function osrmTableMinutes(pickup, targets) {
    const base = etaProviderUrl();
    if (!base)
        throw new Error("ETA provider not configured"); // belt and braces
    const g = globalThis;
    if (typeof g.fetch !== "function")
        throw new Error("fetch unavailable");
    const coords = [pickup, ...targets]
        .map((p) => `${Number(p.lng)},${Number(p.lat)}`)
        .join(";");
    const url = `${base}/table/v1/driving/${coords}?sources=0`;
    const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(TABLE_TIMEOUT_MS)
        : undefined;
    const res = await g.fetch(url, signal ? { signal } : {});
    if (!res.ok)
        throw new Error(`OSRM ${res.status}`);
    const body = await res.json();
    const row = body?.durations?.[0];
    if (!Array.isArray(row))
        throw new Error("OSRM: no durations");
    return targets.map((_, i) => typeof row[i + 1] === "number" && Number.isFinite(row[i + 1]) ? row[i + 1] : null);
}
/**
 * Minutes-to-pickup for every target, road ETA first, haversine fallback
 * per-entry (one slow target does not demote the rest).
 */
async function etaMinutesList(pickup, targets, avgSpeedKmh) {
    const fallback = targets.map((t) => haversineEtaMinutes(pickup, t, avgSpeedKmh));
    if (targets.length === 0)
        return [];
    const usingDefault = impl === undefined;
    const active = usingDefault ? osrmTableMinutes : impl;
    if (!active)
        return fallback; // explicitly haversine-only (tests)
    if (usingDefault) {
        if (!etaProviderUrl())
            return fallback; // not configured -> never dial out
        if (Date.now() < cooldownUntil)
            return fallback; // circuit breaker open
        logEtaProviderStatus(); // safety net if the startup hook was skipped
    }
    try {
        const got = await active(pickup, targets);
        if (usingDefault)
            consecutiveFailures = 0;
        return got.map((v, i) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback[i]);
    }
    catch {
        if (usingDefault) {
            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                consecutiveFailures = 0;
                cooldownUntil = Date.now() + COOLDOWN_MS;
                console.warn(`[eta] ETA provider failing (${MAX_CONSECUTIVE_FAILURES}x in a row); circuit breaker open for ${COOLDOWN_MS / 1000}s, haversine ranking meanwhile`);
            }
        }
        return fallback;
    }
}
//# sourceMappingURL=eta.js.map