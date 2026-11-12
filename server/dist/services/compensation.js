"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Driver compensation rules: waiting, extra stops and late cancellations.
//
// These were the three biggest complaints in the Facebook driver research
// (VURA-DRIVER-PAIN-POINTS.md): "the client can take as long as they want at
// those stops for free", no pay for a rider who keeps the driver waiting, and
// no compensation when a rider cancels after the driver has already set off.
//
// The rules live here as pure functions so the maths can be tested without a
// database, and so the app, the receipt and the admin screen all read the same
// numbers. All amounts are RANDS; the ride row stores them with 2 decimals.
//
// Defaults (owner-tunable through env, no deploy of app code needed):
//   Waiting        first 2 minutes free, then R1.50 per started 30 seconds,
//                  capped at R30 per trip.
//   Extra stops    R2.50 per stop (the first stop is included in the fare).
//   Cancellation   R15 when the rider cancels more than 2 minutes after a
//                  driver accepted; the driver is credited R10 of that.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.compensationConfig = compensationConfig;
exports.waitingFeeRands = waitingFeeRands;
exports.stopFeeRands = stopFeeRands;
exports.cancellationDecision = cancellationDecision;
exports.tripExtras = tripExtras;
exports.applyTripExtras = applyTripExtras;
exports.creditCancellationComp = creditCancellationComp;
const database_1 = require("../config/database");
function num(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
function compensationConfig() {
    return {
        waitFreeSeconds: num(process.env.WAIT_FREE_SECONDS, 120, 0, 1800),
        waitPerMinuteRands: num(process.env.WAIT_PER_MINUTE_RANDS, 1.5, 0, 20),
        waitCapRands: num(process.env.WAIT_CAP_RANDS, 30, 0, 200),
        stopFeeRands: num(process.env.STOP_FEE_RANDS, 2.5, 0, 50),
        cancelFeeRands: num(process.env.CANCEL_FEE_RANDS, 15, 0, 100),
        cancelGraceMinutes: num(process.env.CANCEL_GRACE_MINUTES, 2, 0, 30),
        driverCancelCompRands: num(process.env.DRIVER_CANCEL_COMP_RANDS, 10, 0, 100),
    };
}
const to2 = (n) => Math.round(n * 100) / 100;
/**
 * Chargeable waiting. Billed per started 30 seconds after the free window, so
 * a driver is never under-paid for a 31-second wait, and capped.
 */
function waitingFeeRands(waitSeconds, cfg = compensationConfig()) {
    const secs = Math.max(0, Number(waitSeconds) || 0);
    const chargeable = secs - cfg.waitFreeSeconds;
    if (chargeable <= 0)
        return 0;
    const halfMinutes = Math.ceil(chargeable / 30);
    const fee = (halfMinutes / 2) * cfg.waitPerMinuteRands;
    return to2(Math.min(fee, cfg.waitCapRands));
}
/** Extra stops after the first are charged a flat fee each. */
function stopFeeRands(stopCount, cfg = compensationConfig()) {
    const stops = Math.max(0, Math.floor(Number(stopCount) || 0));
    const extra = Math.max(0, stops - 1);
    return to2(extra * cfg.stopFeeRands);
}
/** Rider-facing late-cancellation decision. */
function cancellationDecision(status, acceptedAtMs, nowMs = Date.now(), cfg = compensationConfig()) {
    const matched = status === "accepted" || status === "driver_arrived";
    if (!matched)
        return { feeRands: 0, driverCompRands: 0, reason: null };
    const minutes = acceptedAtMs == null ? 0 : (nowMs - acceptedAtMs) / 60000;
    if (minutes <= cfg.cancelGraceMinutes) {
        return { feeRands: 0, driverCompRands: 0, reason: null };
    }
    return {
        feeRands: to2(cfg.cancelFeeRands),
        driverCompRands: to2(Math.min(cfg.cancelFeeRands, cfg.driverCancelCompRands)),
        reason: `Rider cancelled ${Math.round(minutes)} min after a driver accepted.`,
    };
}
/**
 * Waiting + stops for one trip. `waitEndMs` is when the trip started (or when
 * it ended, if the driver never started it).
 */
function tripExtras(arrivedAtMs, waitEndMs, stopCount, cfg = compensationConfig()) {
    const waitSeconds = arrivedAtMs != null && waitEndMs != null && waitEndMs > arrivedAtMs
        ? (waitEndMs - arrivedAtMs) / 1000
        : 0;
    const wait = waitingFeeRands(waitSeconds, cfg);
    const stops = stopFeeRands(stopCount, cfg);
    return { waitFeeRands: wait, stopFeeRands: stops, totalRands: to2(wait + stops) };
}
function parseMs(value) {
    if (!value)
        return null;
    const ms = new Date(String(value)).getTime();
    return Number.isFinite(ms) ? ms : null;
}
/**
 * Add waiting and stop compensation to a completed trip's fare and persist the
 * split. Idempotent: once wait_fee/stop_fee are set, a replayed completion
 * does not charge them twice.
 *
 * Returns the final fare the rider owes and the two fee components.
 */
async function applyTripExtras(rideId, baseFareRands, nowMs = Date.now()) {
    const ride = await (0, database_1.queryOne)(`SELECT arrived_at, trip_started_at, waypoints, wait_fee, stop_fee
       FROM rides WHERE id = $1`, [rideId]).catch(() => null);
    const base = to2(Math.max(0, Number(baseFareRands) || 0));
    if (!ride)
        return { fareRands: base, waitFeeRands: 0, stopFeeRands: 0 };
    const alreadyWait = Number(ride.wait_fee || 0);
    const alreadyStop = Number(ride.stop_fee || 0);
    if (alreadyWait > 0 || alreadyStop > 0) {
        return {
            fareRands: to2(base + alreadyWait + alreadyStop),
            waitFeeRands: alreadyWait,
            stopFeeRands: alreadyStop,
        };
    }
    // Older rows may not have the column yet (a database restored before this
    // migration): the catch above already degrades to the plain fare.
    const stops = Array.isArray(ride.waypoints) ? ride.waypoints.length : 0;
    const arrivedMs = parseMs(ride.arrived_at);
    const endedMs = parseMs(ride.trip_started_at) ?? nowMs;
    const extras = tripExtras(arrivedMs, endedMs, stops);
    if (extras.waitFeeRands > 0 || extras.stopFeeRands > 0) {
        await (0, database_1.execute)(`UPDATE rides
          SET wait_fee = $2, stop_fee = $3
        WHERE id = $1 AND COALESCE(wait_fee, 0) = 0 AND COALESCE(stop_fee, 0) = 0`, [rideId, extras.waitFeeRands, extras.stopFeeRands]).catch(() => undefined);
    }
    return {
        fareRands: to2(base + extras.totalRands),
        waitFeeRands: extras.waitFeeRands,
        stopFeeRands: extras.stopFeeRands,
    };
}
/**
 * Pay the driver their share of a late-cancellation fee. The rider-facing fee
 * is already stored on the ride by the cancel paths; this books the driver's
 * part once (idempotent on ride + note) so a cancelled trip is not free work.
 */
async function creditCancellationComp(rideId, driverId, feeRands) {
    const cfg = compensationConfig();
    if (!driverId || feeRands <= 0 || cfg.driverCancelCompRands <= 0)
        return 0;
    const comp = to2(Math.min(feeRands, cfg.driverCancelCompRands));
    const row = await (0, database_1.queryOne)(`SELECT id, balance_after_cents FROM wallet_ledger
      WHERE ride_id = $1 AND type = 'adjustment' AND note LIKE 'cancellation compensation%'
      LIMIT 1`, [rideId]).catch(() => null);
    if (row)
        return comp;
    const balance = await (0, database_1.queryOne)(`SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM wallet_ledger WHERE driver_id = $1 AND status = 'posted'`, [driverId]).catch(() => null);
    const after = Number(balance?.total || 0) + Math.round(comp * 100);
    await (0, database_1.execute)(`INSERT INTO wallet_ledger
       (driver_id, ride_id, type, amount_cents, balance_after_cents, status, note)
     VALUES ($1, $2, 'adjustment', $3, $4, 'posted', $5)
     ON CONFLICT (ride_id, type) DO NOTHING`, [driverId, rideId, Math.round(comp * 100), after, `cancellation compensation R${comp.toFixed(2)}`]).catch(() => undefined);
    await (0, database_1.execute)(`UPDATE rides SET cancel_driver_comp = $2 WHERE id = $1`, [rideId, comp]).catch(() => undefined);
    return comp;
}
//# sourceMappingURL=compensation.js.map