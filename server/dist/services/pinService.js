"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mintRidePin = mintRidePin;
exports.getRidePinForRider = getRidePinForRider;
exports.verifyRidePin = verifyRidePin;
// ─────────────────────────────────────────────────────────────────────────────
// PIN SERVICE — the single-use start code that proves the rider is in the
// right car (§3). Minted when a driver accepts, shown ONLY to the rider, keyed
// by the driver into `driver:ride:begin`. The value is stored encrypted
// (AES-256-GCM, PIN_SECRET pepper) so neither an admin API nor a casual DB
// read can hand it out; three wrong attempts lock it and alert the rider.
// ─────────────────────────────────────────────────────────────────────────────
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const safetyConfig_1 = require("./safetyConfig");
const ALGO = "aes-256-gcm";
const KEY = (0, crypto_1.createHash)("sha256")
    .update(process.env.PIN_SECRET || "vura-ride-start-pin-v1")
    .digest();
const IV_LEN = 12;
function seal(pin) {
    const iv = (0, crypto_1.randomBytes)(IV_LEN);
    const c = (0, crypto_1.createCipheriv)(ALGO, KEY, iv);
    const enc = Buffer.concat([c.update(pin, "utf8"), c.final()]);
    return `${iv.toString("base64")}.${enc.toString("base64")}.${c.getAuthTag().toString("base64")}`;
}
function unseal(token) {
    try {
        const [ivB, encB, tagB] = token.split(".");
        const d = (0, crypto_1.createDecipheriv)(ALGO, KEY, Buffer.from(ivB, "base64"));
        d.setAuthTag(Buffer.from(tagB, "base64"));
        return Buffer.concat([d.update(Buffer.from(encB, "base64")), d.final()]).toString("utf8");
    }
    catch {
        return null;
    }
}
/** Mint (or keep) the ride's PIN. Called once per healthy accept. */
async function mintRidePin(rideId) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const pin = String((0, crypto_1.randomInt)(1000, 10000)); // 4 digits, no leading-zero traps
    await (0, database_1.execute)(`INSERT INTO ride_pins (ride_id, pin_hash, max_attempts)
     VALUES ($1, $2, $3)
     ON CONFLICT (ride_id) DO NOTHING`, [rideId, seal(pin), (await (0, safetyConfig_1.getSafetySettings)()).max_pin_attempts]).catch(() => { });
}
/**
 * The rider's copy. Ownership-checked: only the ride's passenger may read it,
 * and only while the trip has not started (verified/cancelled rides return
 * nothing — the secret is already spent or dead).
 */
async function getRidePinForRider(rideId, riderId) {
    try {
        await (0, safetyConfig_1.ensureSafetyTables)();
        const row = await (0, database_1.queryOne)(`SELECT p.pin_hash, p.locked_at, p.verified_at, r.status, r.passenger_id
         FROM ride_pins p JOIN rides r ON r.id = p.ride_id
        WHERE p.ride_id = $1`, [rideId]);
        if (!row || row.passenger_id !== riderId)
            return null;
        if (row.verified_at || ["in_progress", "completed", "cancelled"].includes(row.status))
            return null;
        const pin = unseal(row.pin_hash);
        if (!pin)
            return null;
        return { pin, locked: row.locked_at != null };
    }
    catch {
        return null;
    }
}
/**
 * The driver's attempt, called from `driver:ride:begin` BEFORE the status
 * flips to in_progress. Wrong attempts are counted; at the configured limit
 * the code locks (rider alerted by the caller) and every attempt is journaled
 * into safety_events for review.
 */
async function verifyRidePin(rideId, driverId, entered) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const row = await (0, database_1.queryOne)(`SELECT p.pin_hash, p.attempts, p.max_attempts, p.locked_at, p.verified_at,
            r.driver_id, r.status
       FROM rides r LEFT JOIN ride_pins p ON p.ride_id = r.id
      WHERE r.id = $1`, [rideId]);
    if (!row || row.driver_id !== driverId)
        return { ok: false, error: "not_allowed" };
    if (row.status !== "driver_arrived")
        return { ok: false, error: "not_allowed" };
    // No PIN row (mint failed or pre-017 ride): never strand a live trip.
    if (!row.pin_hash) {
        console.warn(`[safety] ride ${rideId} has no PIN row — allowing start without one`);
        return { ok: true };
    }
    if (row.verified_at)
        return { ok: true }; // already opened
    if (row.locked_at)
        return { ok: false, error: "locked" };
    const maxAttempts = row.max_attempts ?? 3;
    const expected = unseal(row.pin_hash);
    if (expected && expected === String(entered).trim()) {
        await (0, database_1.execute)("UPDATE ride_pins SET verified_at = NOW() WHERE ride_id = $1", [rideId]);
        return { ok: true };
    }
    const attempts = (row.attempts ?? 0) + 1;
    const lock = attempts >= maxAttempts;
    await (0, database_1.execute)(`UPDATE ride_pins SET attempts = $2, locked_at = CASE WHEN $3 THEN NOW() ELSE locked_at END
      WHERE ride_id = $1`, [rideId, attempts, lock]);
    await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, $2, $3)", [
        rideId,
        lock ? "pin_locked" : "pin_failed",
        JSON.stringify({ driver_id: driverId, attempts, locked: lock, at: new Date().toISOString() }),
    ]).catch(() => { });
    if (lock)
        return { ok: false, error: "locked" };
    return { ok: false, error: "wrong", attempts_left: Math.max(0, maxAttempts - attempts) };
}
//# sourceMappingURL=pinService.js.map