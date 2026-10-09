"use strict";
// ────────────────────────────────────────────���────────────────────────────────
// RIDE TRACING — where did the time go?
//
// WHY THIS EXISTS
//
// Dispatch used to log only stage NAMES into ride_events. "ride_requested" then
// "offer_sent" tells you the ride eventually reached a driver, but not HOW LONG
// any stage took — so a 4-second mystery looks identical to a 40ms success. The
// target is rider tap -> driver sees offer <= 2s, and that target cannot be
// improved (or defended) without measuring each hop.
//
// WHAT IT DOES
//
// One trace_id per ride, minted when the ride is requested. Every stage is
// written to the EXISTING ride_events table inside its JSONB `detail`, so this
// needs no migration and cannot break dispatch if tracing itself fails.
//
// The trace context is held in a Map keyed by rideId rather than threaded through
// every function signature. Dispatch is already per-ride (one ride -> one offer
// chain), so keying by rideId is unambiguous even while several rides dispatch
// concurrently -- each writes only to its own key.
//
// TWO HARD RULES
//   1. NEVER throw. Tracing must not be able to break a live ride, so every DB
//      write here is best-effort and swallowed with a console warning.
//   2. NEVER block. Writes are NOT awaited on the dispatch hot path; the promise
//      is fire-and-forget so a slow database cannot add latency to a booking.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRACE_STAGES = void 0;
exports.startTrace = startTrace;
exports.traceFor = traceFor;
exports.getActiveTrace = getActiveTrace;
exports.trace = trace;
exports.readTrace = readTrace;
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
/** The canonical stages, in the order a healthy ride walks through them. */
exports.TRACE_STAGES = [
    "request_received",
    "trip_saved",
    "dispatch_started",
    "drivers_found",
    "offer_sent",
    "offer_delivered_ack",
    "driver_response",
];
/** rideId -> its live trace context. */
const active = new Map();
/** Mint a trace for a ride. Re-using an existing one keeps the id stable. */
function startTrace(rideId) {
    const existing = active.get(rideId);
    if (existing)
        return existing;
    const ctx = {
        traceId: (0, crypto_1.randomUUID)(),
        t0: Date.now(),
        rideId,
        createdAt: Date.now(),
    };
    active.set(rideId, ctx);
    // Bound the map. Without this a long-lived process leaks one entry per ride
    // for the life of the server.
    if (active.size > 5000) {
        const oldest = active.keys().next().value;
        if (oldest)
            active.delete(oldest);
    }
    return ctx;
}
/** Read the active trace, or mint one if this ride never started a trace. */
function traceFor(rideId) {
    return active.get(rideId) ?? startTrace(rideId);
}
function getActiveTrace(rideId) {
    return active.get(rideId);
}
/**
 * Record one stage.
 *
 * Deliberately NOT awaited by callers on the dispatch path. `detail` carries the
 * trace_id, the stage, wall-clock ISO time, and milliseconds-since-start, so the
 * debug endpoint can rebuild the whole journey from the ride_events it already
 * stores -- including traces for rides whose process died mid-flow.
 */
function trace(rideId, stage, detail) {
    if (!rideId)
        return;
    const ctx = traceFor(rideId);
    const at = Date.now();
    const payload = {
        trace_id: ctx.traceId,
        stage,
        at: new Date(at).toISOString(),
        ms_from_start: at - ctx.t0,
        ...detail,
    };
    // Fire and forget on purpose. An unhandled rejection here would be an
    // unhandledRejection in the Node process, which is exactly the class of
    // swallowed failure this whole feature exists to expose.
    void (0, database_1.execute)(`INSERT INTO ride_events (ride_id, event, detail) VALUES ($1, $2, $3)`, [rideId, `trace:${stage}`, JSON.stringify(payload)]).catch((err) => console.warn(`[trace] ${stage} write failed:`, err?.message));
}
/**
 * Rebuild a ride's timeline from the persisted events.
 *
 * Reads ALL stages for the ride in insertion order and computes the gap to the
 * previous stage, so slow hops are visible at a glance rather than requiring
 * the reader to subtract timestamps by hand.
 */
async function readTrace(rideId) {
    const rows = await (0, database_1.query)(`SELECT id, event, detail, created_at
       FROM ride_events
      WHERE ride_id = $1
      ORDER BY id ASC`, [rideId]);
    const stages = [];
    let previousMs = null;
    let traceId = null;
    for (const row of rows) {
        const d = (row.detail ?? {});
        const ms = typeof d.ms_from_start === "number" ? d.ms_from_start : null;
        const stage = typeof d.stage === "string" ? d.stage : row.event;
        if (typeof d.trace_id === "string")
            traceId = d.trace_id;
        stages.push({
            stage,
            at: d.at ?? row.created_at,
            ms_from_start: ms ?? 0,
            ms_since_previous: ms != null && previousMs != null ? ms - previousMs : null,
            trace_id: d.trace_id ?? null,
            detail: d,
        });
        if (ms != null)
            previousMs = ms;
    }
    const last = stages.length ? stages[stages.length - 1] : null;
    return {
        ride_id: rideId,
        trace_id: traceId,
        stage_count: stages.length,
        total_ms: last ? last.ms_from_start : 0,
        stages,
    };
}
//# sourceMappingURL=trace.js.map