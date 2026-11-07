"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SplitError = exports.MAX_SPLIT_RIDERS = exports.MIN_SPLIT_RIDERS = void 0;
exports.ensureSplitFareTable = ensureSplitFareTable;
exports.splitShareRands = splitShareRands;
exports.primaryRemainderRands = primaryRemainderRands;
exports.isValidShareCount = isValidShareCount;
exports.createSplitInvite = createSplitInvite;
exports.listPendingInvites = listPendingInvites;
exports.listRideSplits = listRideSplits;
exports.paySplit = paySplit;
exports.declineSplit = declineSplit;
exports.paidSplitTotalRands = paidSplitTotalRands;
exports.waitForPayingSplits = waitForPayingSplits;
exports.refundRideSplits = refundRideSplits;
// ─────────────────────────────────────────────────────────────────────────────
// Split fare — riders who share a trip pay their share BEFORE the trip ends.
//
// Money flow (deliberately simple and safe):
//   • The booking rider keeps the existing card hold for the FULL fare. That
//     flow is untouched when nobody splits.
//   • Each invited rider pays their equal share up front from their own saved
//     card. A share only counts once Paystack says "success".
//   • At completion `captureRideHold` subtracts the PAID shares from the final
//     fare and captures only the booking rider's remainder from the hold. The
//     hold is for the full fare, so the remainder can never exceed it.
//   • If a co-rider never pays, the booking rider simply pays that share —
//     exactly Uber's rule. Nothing is charged twice.
//   • If the ride is cancelled, paid shares are refunded in `releaseRideHold`.
//
// One-person rides never touch this file's tables, so their behaviour is
// unchanged.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const paystackPayment_1 = require("./paystackPayment");
exports.MIN_SPLIT_RIDERS = 2;
exports.MAX_SPLIT_RIDERS = 4;
/** Rides where a co-rider can still pay a share (driver assigned, not ended). */
const PAYABLE_RIDE_STATUSES = ["accepted", "driver_arrived", "in_progress"];
class SplitError extends Error {
    code;
    httpStatus;
    constructor(code, message, httpStatus = 400) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.name = "SplitError";
    }
}
exports.SplitError = SplitError;
let schemaReady = null;
/** Idempotent schema: the original table existed, the payment columns did not. */
async function ensureSplitFareTable() {
    if (!schemaReady) {
        schemaReady = (async () => {
            await (0, database_1.execute)(`
        CREATE TABLE IF NOT EXISTS split_fares (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          ride_id UUID REFERENCES rides(id),
          inviter_id UUID NOT NULL REFERENCES users(id),
          invitee_id UUID REFERENCES users(id),
          invitee_email VARCHAR(255) NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
            await (0, database_1.execute)(`ALTER TABLE split_fares ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 2`);
            await (0, database_1.execute)(`ALTER TABLE split_fares ADD COLUMN IF NOT EXISTS reference VARCHAR(100)`);
            await (0, database_1.execute)(`ALTER TABLE split_fares ADD COLUMN IF NOT EXISTS last_error TEXT`);
            await (0, database_1.execute)(`ALTER TABLE split_fares ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
            await (0, database_1.execute)(`ALTER TABLE split_fares ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`);
            await (0, database_1.execute)(`ALTER TABLE split_fares ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
        })().catch((err) => {
            schemaReady = null;
            throw err;
        });
    }
    return schemaReady;
}
function roundRands(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}
/** Equal share, rounded to cents. Exported so the arithmetic is unit-tested. */
function splitShareRands(fareRands, shareCount) {
    const fare = Number(fareRands);
    const count = Math.round(Number(shareCount));
    if (!Number.isFinite(fare) || fare <= 0)
        return 0;
    if (!Number.isFinite(count) || count < 1)
        return 0;
    return roundRands(fare / count);
}
/** What the booking rider still owes after co-riders' paid shares. */
function primaryRemainderRands(fareRands, paidSharesRands) {
    return Math.max(0, roundRands(Number(fareRands) - Number(paidSharesRands)));
}
function isValidShareCount(value) {
    const raw = Number(value);
    const count = Math.round(raw);
    return (Number.isFinite(raw) &&
        raw === count &&
        count >= exports.MIN_SPLIT_RIDERS &&
        count <= exports.MAX_SPLIT_RIDERS);
}
function normaliseEmail(value) {
    return String(value || "").trim().toLowerCase();
}
async function loadRide(rideId) {
    return await (0, database_1.queryOne)(`SELECT id, passenger_id, status, payment_method, estimated_fare, actual_fare,
            destination_address, pickup_address
       FROM rides WHERE id = $1`, [rideId]);
}
async function loadUserByFirebase(firebaseUid) {
    return await (0, database_1.queryOne)("SELECT id, full_name, email FROM users WHERE firebase_uid = $1", [firebaseUid]);
}
/**
 * Create one invite. `shareCount` is the TOTAL number of riders including the
 * booking rider (2–4). The share is fixed here as fare ÷ shareCount so every
 * co-rider sees the same amount, even if the estimate later moves.
 */
async function createSplitInvite(input) {
    await ensureSplitFareTable();
    const user = await loadUserByFirebase(input.firebaseUid);
    if (!user)
        throw new SplitError("user_not_found", "User not found.", 401);
    if (!isValidShareCount(input.shareCount)) {
        throw new SplitError("bad_share_count", `Split fare is for ${exports.MIN_SPLIT_RIDERS} to ${exports.MAX_SPLIT_RIDERS} riders.`);
    }
    const shareCount = Number(input.shareCount);
    const ride = await loadRide(String(input.rideId || ""));
    if (!ride)
        throw new SplitError("ride_not_found", "Ride not found.", 404);
    if (ride.passenger_id !== user.id) {
        throw new SplitError("not_your_ride", "Only the rider who booked this trip can split it.", 403);
    }
    if (!PAYABLE_RIDE_STATUSES.includes(String(ride.status))) {
        throw new SplitError("ride_not_active", "You can split the fare once a driver has accepted and before the trip ends.", 409);
    }
    if (String(ride.payment_method || "").toLowerCase() !== "card") {
        throw new SplitError("not_card_ride", "Split fare is only available when the ride is paid by card.", 400);
    }
    const fare = Number(ride.actual_fare) > 0 ? Number(ride.actual_fare) : Number(ride.estimated_fare);
    if (!Number.isFinite(fare) || fare <= 0) {
        throw new SplitError("no_fare", "This ride has no fare to split yet.", 409);
    }
    const inviteeEmail = normaliseEmail(input.inviteeEmail);
    if (!inviteeEmail || !inviteeEmail.includes("@")) {
        throw new SplitError("bad_email", "Enter the email your co-rider uses in Vura.");
    }
    if (inviteeEmail === normaliseEmail(user.email)) {
        throw new SplitError("self_invite", "You cannot split with yourself.");
    }
    const invitee = await (0, database_1.queryOne)("SELECT id, full_name, email FROM users WHERE LOWER(email) = $1 LIMIT 1", [inviteeEmail]);
    if (!invitee) {
        throw new SplitError("invitee_not_on_vura", "That person needs a Vura rider account before they can share this ride.", 404);
    }
    // A split is configured for ONE headcount. Changing it later would silently
    // change everyone's share, so refuse instead.
    const existing = await (0, database_1.queryOne)("SELECT share_count FROM split_fares WHERE ride_id = $1 ORDER BY created_at ASC LIMIT 1", [ride.id]);
    if (existing && Number(existing.share_count || 0) !== shareCount) {
        throw new SplitError("share_count_locked", `This split is already set for ${Number(existing.share_count)} riders.`, 409);
    }
    const duplicate = await (0, database_1.queryOne)(`SELECT id, status FROM split_fares
      WHERE ride_id = $1 AND LOWER(invitee_email) = $2
        AND status IN ('pending', 'paying', 'paid')
      LIMIT 1`, [ride.id, inviteeEmail]);
    if (duplicate) {
        throw new SplitError("already_invited", duplicate.status === "paid"
            ? "That rider has already paid their share."
            : "That rider already has a pending split request.", 409);
    }
    const active = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS count FROM split_fares
      WHERE ride_id = $1 AND status IN ('pending', 'paying', 'paid')`, [ride.id]);
    if (Number(active?.count || 0) >= shareCount - 1) {
        throw new SplitError("split_full", "This split already has all its riders. Increase the rider count to add more.", 409);
    }
    const amount = splitShareRands(fare, shareCount);
    if (amount < 1) {
        throw new SplitError("share_too_small", "This fare is too small to split.", 400);
    }
    const row = await (0, database_1.queryOne)(`INSERT INTO split_fares
       (ride_id, inviter_id, invitee_email, amount, status, share_count)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id, ride_id, inviter_id, invitee_id, invitee_email, amount, status,
               share_count, reference, last_error, paid_at, refunded_at, created_at`, [ride.id, user.id, inviteeEmail, amount, shareCount]);
    if (!row)
        throw new SplitError("insert_failed", "Could not create the split request.", 500);
    // Best-effort push so a co-rider who is not in the app still hears about it.
    try {
        const { sendPushToUser } = await Promise.resolve().then(() => __importStar(require("./notify")));
        void sendPushToUser(invitee.id, {
            type: "split_invite",
            title: `${user.full_name || "A Vura rider"} invited you to split a ride`,
            body: `Pay R${amount.toFixed(2)} to share the trip. Open Vura to pay your share.`,
            data: { split_id: row.id, ride_id: ride.id },
        }).catch(() => undefined);
    }
    catch {
        /* push is never allowed to block the invite */
    }
    return {
        id: row.id,
        rideId: row.ride_id,
        inviteeEmail: row.invitee_email,
        amount: Number(row.amount),
        shareCount,
        status: row.status,
    };
}
/** Pending split invites for the signed-in rider (Home banner). */
async function listPendingInvites(firebaseUid) {
    await ensureSplitFareTable();
    const user = await loadUserByFirebase(firebaseUid);
    const email = normaliseEmail(user?.email);
    if (!user || !email)
        return [];
    const rows = await (0, database_1.query)(`SELECT sf.id, sf.ride_id, sf.amount, sf.status, sf.share_count, sf.created_at,
            COALESCE(u.full_name, u.email) AS inviter_name,
            r.destination_address, r.pickup_address, r.status AS ride_status,
            r.payment_method, r.estimated_fare, r.actual_fare
       FROM split_fares sf
       JOIN users u ON u.id = sf.inviter_id
       JOIN rides r ON r.id = sf.ride_id
      WHERE LOWER(sf.invitee_email) = $1
        AND sf.status = 'pending'
        AND r.status IN ('accepted', 'driver_arrived', 'in_progress')
      ORDER BY sf.created_at DESC
      LIMIT 10`, [email]).catch(() => []);
    return rows || [];
}
/** Every split on a ride, for the booking rider's ride screen. */
async function listRideSplits(firebaseUid, rideId) {
    await ensureSplitFareTable();
    const user = await loadUserByFirebase(firebaseUid);
    if (!user)
        return [];
    const ride = await (0, database_1.queryOne)("SELECT passenger_id FROM rides WHERE id = $1", [rideId]);
    if (!ride || ride.passenger_id !== user.id) {
        throw new SplitError("not_your_ride", "Only the rider who booked this trip can see its split.", 403);
    }
    const rows = await (0, database_1.query)(`SELECT id, invitee_email, amount, status, share_count, paid_at, created_at, last_error
       FROM split_fares
      WHERE ride_id = $1
      ORDER BY created_at ASC`, [rideId]).catch(() => []);
    return rows || [];
}
/**
 * Pay a share. The invitee must be signed in with the same email that was
 * invited. Status is claimed ('paying') before Paystack is called so two taps
 * cannot create two charges.
 */
async function paySplit(input) {
    await ensureSplitFareTable();
    const user = await loadUserByFirebase(input.firebaseUid);
    if (!user)
        throw new SplitError("user_not_found", "User not found.", 401);
    const split = await (0, database_1.queryOne)(`SELECT id, ride_id, inviter_id, invitee_id, invitee_email, amount, status,
            share_count, reference, last_error, paid_at, refunded_at, created_at
       FROM split_fares WHERE id = $1`, [input.splitId]);
    if (!split)
        throw new SplitError("split_not_found", "Split request not found.", 404);
    if (normaliseEmail(split.invitee_email) !== normaliseEmail(user.email)) {
        throw new SplitError("not_your_invite", "This split request is for another rider.", 403);
    }
    if (split.status === "paid") {
        return { success: true, status: "paid", amount: Number(split.amount), duplicate: true };
    }
    if (split.status !== "pending") {
        throw new SplitError("split_not_payable", split.status === "refunded"
            ? "This split was already refunded."
            : "This split request is no longer open.", 409);
    }
    const ride = await loadRide(split.ride_id);
    if (!ride)
        throw new SplitError("ride_not_found", "Ride not found.", 404);
    if (!PAYABLE_RIDE_STATUSES.includes(String(ride.status))) {
        throw new SplitError("ride_ended", "This trip has already ended — the booking rider pays the fare.", 409);
    }
    if (String(ride.payment_method || "").toLowerCase() !== "card") {
        throw new SplitError("not_card_ride", "This ride is not paid by card.", 400);
    }
    const card = await (0, paystackPayment_1.getDefaultCardToken)(user.id);
    if (!card) {
        throw new SplitError("no_card", "Add a card in Vura first, then pay your share.", 400);
    }
    const claimed = await (0, database_1.queryOne)(`UPDATE split_fares sf SET status = 'paying', updated_at = NOW()
      WHERE sf.id = $1 AND sf.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM rides r
           WHERE r.id = sf.ride_id
             AND r.status IN ('accepted', 'driver_arrived', 'in_progress')
             AND COALESCE(r.payment_status, 'NONE')
                 NOT IN ('CAPTURE_PENDING', 'PAID', 'RELEASED', 'PAYMENT_FAILED')
        )
      RETURNING sf.id`, [split.id]);
    if (!claimed) {
        const now = await (0, database_1.queryOne)("SELECT status FROM split_fares WHERE id = $1", [split.id]);
        if (now?.status === "paid") {
            return { success: true, status: "paid", amount: Number(split.amount), duplicate: true };
        }
        throw new SplitError("already_processing", "This split is already being paid.", 409);
    }
    const amount = roundRands(Number(split.amount));
    const reference = `VURASPLIT${Date.now().toString(36).toUpperCase()}` +
        `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    let charge;
    try {
        charge = await (0, paystackPayment_1.chargeAuthorization)({
            amountRands: amount,
            reference,
            email: String(user.email || split.invitee_email),
            authorizationCode: card.transaction_index,
        });
    }
    catch (err) {
        await (0, database_1.execute)(`UPDATE split_fares SET status = 'pending', last_error = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'paying'`, [split.id, String(err?.message || "Could not reach the payment provider.")]).catch(() => { });
        throw new SplitError("charge_error", err?.message || "Could not reach the payment provider. Please try again.", 502);
    }
    if (!charge.success) {
        const message = charge.message || "Your card was declined. Try another card.";
        await (0, database_1.execute)(`UPDATE split_fares SET status = 'pending', last_error = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'paying'`, [split.id, message]).catch(() => { });
        throw new SplitError("charge_failed", message, 402);
    }
    const paid = await (0, database_1.execute)(`UPDATE split_fares
        SET status = 'paid', invitee_id = $2, reference = $3, paid_at = NOW(),
            last_error = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'paying'`, [split.id, user.id, reference]);
    if (!paid || (paid.rowCount ?? 0) === 0) {
        // Extremely unlikely (claim owned this row), but the charge succeeded, so
        // surface it honestly instead of pretending the split is unpaid.
        throw new SplitError("state_changed", `Your card was charged R${amount.toFixed(2)} but the split could not be saved. `
            + `Contact support with reference ${reference}.`, 500);
    }
    // Ledger trail for the admin Money screen. The capture webhook writes the
    // booking rider's own row; together they add up to the full fare.
    try {
        const exists = await (0, database_1.queryOne)("SELECT id FROM payments WHERE reference = $1 LIMIT 1", [reference]);
        if (!exists) {
            await (0, database_1.execute)(`INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider, raw_response)
         VALUES ($1, $2, $3, $4, 'ZAR', 'completed', 'paystack', $5)`, [
                user.id,
                split.ride_id,
                reference,
                amount,
                JSON.stringify({ split_id: split.id, share_count: split.share_count, amount }),
            ]);
        }
    }
    catch (e) {
        console.warn("[split] payments ledger insert failed:", e?.message || e);
    }
    console.log(`[split] PAID R${amount.toFixed(2)} ride=${split.ride_id} split=${split.id} ref=${reference}`);
    return { success: true, status: "paid", amount };
}
async function declineSplit(input) {
    await ensureSplitFareTable();
    const user = await loadUserByFirebase(input.firebaseUid);
    if (!user)
        throw new SplitError("user_not_found", "User not found.", 401);
    const split = await (0, database_1.queryOne)("SELECT id, invitee_email, status FROM split_fares WHERE id = $1", [input.splitId]);
    if (!split)
        throw new SplitError("split_not_found", "Split request not found.", 404);
    if (normaliseEmail(split.invitee_email) !== normaliseEmail(user.email)) {
        throw new SplitError("not_your_invite", "This split request is for another rider.", 403);
    }
    if (split.status !== "pending") {
        throw new SplitError("split_not_open", "This split request is no longer open.", 409);
    }
    await (0, database_1.execute)(`UPDATE split_fares SET status = 'declined', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`, [split.id]);
    return { success: true, status: "declined" };
}
/** Sum of co-rider shares already collected for this ride, in rands. */
async function paidSplitTotalRands(rideId) {
    await ensureSplitFareTable();
    const row = await (0, database_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::float AS total
       FROM split_fares
      WHERE ride_id = $1 AND status = 'paid'`, [rideId]).catch(() => null);
    return Math.max(0, Number(row?.total || 0));
}
/**
 * A share that is mid-charge is neither payable nor refundable yet. Before the
 * booking rider's hold is captured, wait for those charges to resolve so a
 * share can never be collected twice (once from the co-rider, once from the
 * hold). Returns the number still 'paying' after the timeout.
 */
async function waitForPayingSplits(rideId, timeoutMs = 30000) {
    await ensureSplitFareTable();
    const startedAt = Date.now();
    for (;;) {
        const row = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS count FROM split_fares
        WHERE ride_id = $1 AND status = 'paying'`, [rideId]).catch(() => null);
        const pending = Number(row?.count || 0);
        if (pending === 0)
            return 0;
        if (Date.now() - startedAt >= timeoutMs)
            return pending;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}
/**
 * Refund every paid share when a ride dies before completion. Idempotent:
 * rows are marked 'refunded' only after Paystack accepts the refund, and
 * already-refunded rows are skipped.
 */
async function refundRideSplits(rideId) {
    await ensureSplitFareTable();
    const rows = await (0, database_1.query)(`SELECT id, reference, amount FROM split_fares
      WHERE ride_id = $1 AND status = 'paid' AND reference IS NOT NULL`, [rideId]).catch(() => []);
    let refunded = 0;
    for (const row of rows || []) {
        try {
            await (0, paystackPayment_1.refundTransaction)(String(row.reference), Number(row.amount));
            await (0, database_1.execute)(`UPDATE split_fares SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'paid'`, [row.id]);
            refunded++;
            console.log(`[split] refunded R${Number(row.amount).toFixed(2)} split=${row.id} ride=${rideId}`);
        }
        catch (err) {
            console.warn(`[split] refund FAILED split=${row.id} ride=${rideId}:`, err?.message || err);
        }
    }
    return refunded;
}
//# sourceMappingURL=splitFareService.js.map