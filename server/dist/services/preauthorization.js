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
exports.PreauthError = exports.RIDE_PAYMENT_STATUSES = void 0;
exports.normalizePaymentStatus = normalizePaymentStatus;
exports.holdAmountCents = holdAmountCents;
exports.captureAmountCents = captureAmountCents;
exports.newPreauthReference = newPreauthReference;
exports.preauthExpireDays = preauthExpireDays;
exports.stuckSearchMinutes = stuckSearchMinutes;
exports.ensurePreauthSchema = ensurePreauthSchema;
exports.paystackWebhookSecret = paystackWebhookSecret;
exports.verifyPaystackSignature = verifyPaystackSignature;
exports.initializePreauthorization = initializePreauthorization;
exports.reservePreauthorization = reservePreauthorization;
exports.capturePreauthorization = capturePreauthorization;
exports.releasePreauthorization = releasePreauthorization;
exports.createRideHold = createRideHold;
exports.captureRideHold = captureRideHold;
exports.releaseRideHold = releaseRideHold;
exports.releaseStuckHolds = releaseStuckHolds;
exports.startPreauthReaper = startPreauthReaper;
exports.stopPreauthReaper = stopPreauthReaper;
exports.saveReusableAuthorization = saveReusableAuthorization;
exports.recordWebhookEventOnce = recordWebhookEventOnce;
exports.handlePreauthorizationEvent = handlePreauthorizationEvent;
// ─────────────────────────────────────────────────────────────────────────────
// CARD PREAUTHORIZATION — real holds on the rider's card (SERVER-SIDE ONLY).
//
// Source of truth (every parameter below is copied from it, nothing guessed):
//   https://paystack.com/docs/payments/card-preauthorization/
//
//   POST /preauthorization/initialize             first-time riders → checkout URL
//   POST /preauthorization/reserve_authorization  returning riders → saved card
//   POST /preauthorization/capture                final fare when the ride completes
//   POST /preauthorization/release                cancel / no-driver / stuck search
//
// Doc facts this file encodes:
//   • amount is in the CENTS of the currency; ZAR minimum on initialize is 100.
//   • currency must be "ZAR" (registered-SA-business feature).
//   • expire_after_days: 1..7, default 5; expire_action: "capture" | "release",
//     default "release" — we always ask for "release" so an abandoned hold frees
//     the rider's money by itself.
//   • reference: unique, case-sensitive, only -, ., = and alphanumeric.
//   • capture takes reference + amount + currency (≤ held; a lower capture
//     auto-releases the balance); release takes ONLY the reference.
//   • Webhooks are REQUIRED (the flow is async): x-paystack-signature is the
//     HMAC SHA512 of the raw request body signed with the secret key.
//   • reserve_authorization takes the initialize parameters PLUS
//     authorization_code — and authorization_code + email MUST be the ones from
//     the customer's first transaction.
//
// Ride payment_status enum (the rides.payment_status column already existed for
// the affiliate/pay-later flows with legacy value 'paid', which we honour):
//
//   NONE           no hold on this ride (cash, pay-later, pre-feature ride)
//   HOLD_PENDING   initialized — rider has not finished the secure page yet
//   HOLD_ACTIVE    funds held (reserve.success / reserve_authorization)
//   CAPTURE_PENDING capture sent — waiting for preauthorization.capture.success
//   PAID           capture confirmed by webhook (never set by the API call)
//   PAYMENT_FAILED capture failed (webhook) or could not be attempted
//   RELEASED       hold released (cancel / no driver / stuck search / expiry)
//   HOLD_EXPIRED   the hold window lapsed without capture or release
// ─────────────────────────────────────────────────────────────────────────────
const crypto_1 = require("crypto");
const paystackPayment_1 = require("./paystackPayment");
const database_1 = require("../config/database");
exports.RIDE_PAYMENT_STATUSES = [
    "NONE",
    "HOLD_PENDING",
    "HOLD_ACTIVE",
    "CAPTURE_PENDING",
    "PAID",
    "PAYMENT_FAILED",
    "RELEASED",
    "HOLD_EXPIRED",
];
const HOLD_STATES = new Set([
    "HOLD_PENDING",
    "HOLD_ACTIVE",
    "CAPTURE_PENDING",
    "PAID",
    "PAYMENT_FAILED",
]);
/** Normalises whatever the column holds (NULL, '', legacy 'paid') to the enum. */
function normalizePaymentStatus(raw) {
    const v = String(raw ?? "").trim();
    if (!v)
        return "NONE";
    const up = v.toUpperCase();
    if (up === "PAID")
        return "PAID"; // legacy affiliate/pay-later value 'paid'
    return exports.RIDE_PAYMENT_STATUSES.includes(up)
        ? up
        : "NONE";
}
/** Typed failure so routes map onto honest HTTP statuses in one catch. */
class PreauthError extends Error {
    code;
    httpStatus;
    constructor(code, message, httpStatus) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }
}
exports.PreauthError = PreauthError;
// ── Amounts & references (docs-exact) ────────────────────────────────────────
/**
 * Amount to HOLD, in cents. Paystack's documented floor for
 * /preauthorization/initialize is 100 (cents), so sub-R1 demo fares (the app
 * books R0.20 test rides) are held at R1.00 — a later capture of the real,
 * lower fare auto-releases the balance ("If the amount is lower than the
 * initial preauthorized amount, the balance is automatically released").
 */
function holdAmountCents(fareRands) {
    const cents = Math.round(Number(fareRands) * 100);
    return Number.isFinite(cents) && cents > 0 ? Math.max(100, cents) : 100;
}
/** Amount to CAPTURE, in cents — the final fare, exact (never rounded up). */
function captureAmountCents(fareRands) {
    return Math.round(Number(fareRands) * 100);
}
/** Docs: unique, case-sensitive, only -, ., = and alphanumeric. */
function newPreauthReference(prefix = "VURA") {
    return (prefix +
        Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).slice(2, 10).toUpperCase());
}
/** Days until expire_action runs. Docs: min 1, default 5 — we default to 1. */
function preauthExpireDays() {
    const n = parseInt(process.env.PREAUTH_EXPIRE_DAYS || "1", 10);
    return Math.min(7, Math.max(1, Number.isFinite(n) ? n : 1));
}
/** Minutes a ride may sit in searching/no_drivers before its hold is released. */
function stuckSearchMinutes() {
    const n = parseInt(process.env.PREAUTH_STUCK_SEARCH_MINUTES || "15", 10);
    return Number.isFinite(n) && n > 0 ? n : 15;
}
// ── Schema (additive + idempotent; mirrors the money-table lazy-ensure style) ─
let schemaReady = false;
async function ensurePreauthSchema() {
    if (schemaReady)
        return;
    try {
        // payment_status already exists on installs that ran the affiliate/pay-later
        // flows — IF NOT EXISTS keeps those VARCHAR(20) columns untouched.
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'NONE'`);
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS preauth_reference TEXT`);
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_checkout_url TEXT`);
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ`);
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_amount_cents INTEGER`);
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS captured_amount NUMERIC(10,2)`);
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
        await (0, database_1.execute)(`CREATE UNIQUE INDEX IF NOT EXISTS rides_preauth_reference_key
         ON rides (preauth_reference) WHERE preauth_reference IS NOT NULL`);
        // One row per webhook event instance → replayed deliveries are dropped here
        // BEFORE any state transition, which is what makes the handlers idempotent.
        await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS paystack_webhook_events (
         event_key  TEXT PRIMARY KEY,
         event      TEXT NOT NULL,
         data       JSONB,
         received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`);
        // The saved-card table the webhook writes reusable authorization codes into
        // (same shape routes/payments.ts creates — IF NOT EXISTS is a no-op there).
        // `signature` is Paystack's per-card fingerprint (SIG_…) used by Pay Later
        // eligibility to identify "the same card"; card_auth_code provenance lives
        // on rides (015).
        await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS card_auth_code VARCHAR(100)`);
        await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS saved_cards (
         id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
         user_id UUID NOT NULL REFERENCES users(id),
         card_type VARCHAR(20),
         last4 VARCHAR(4),
         bank VARCHAR(100),
         exp_month INTEGER,
         exp_year INTEGER,
         card_number_masked VARCHAR(30),
         transaction_index VARCHAR(100),
         signature VARCHAR(64),
         is_default BOOLEAN DEFAULT false,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`);
        await (0, database_1.execute)(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS signature VARCHAR(64)`);
        schemaReady = true;
    }
    catch (err) {
        // Never throw: a boot-time hiccup retries on the next call instead of
        // crashing a request. Callers all handle their own missing-table paths.
        console.warn("[preauth] schema ensure failed:", err?.message || err);
    }
}
// ── Webhook signature (docs: HMAC SHA512 of the raw body with the secret) ────
/** The secret the x-paystack-signature header must be signed with. */
function paystackWebhookSecret() {
    return (0, paystackPayment_1.paystackConfig)().secretKey;
}
function verifyPaystackSignature(rawBody, header, secret) {
    if (!secret || !rawBody || rawBody.length === 0)
        return false;
    if (!header || typeof header !== "string" || header.length === 0)
        return false;
    const expected = (0, crypto_1.createHmac)("sha512", secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(header, "utf8");
    // Constant-time compare — a plain === on attacker-controlled bytes leaks.
    return a.length === b.length && (0, crypto_1.timingSafeEqual)(a, b);
}
// ── The four documented endpoints ─────────────────────────────────────────────
async function initializePreauthorization(input) {
    if ((0, paystackPayment_1.paymentsMode)() === "mock") {
        const reference = input.reference || newPreauthReference();
        return {
            reference,
            authorizationUrl: `https://checkout.paystack.com/mock-preauth-${reference}`,
        };
    }
    if (!(0, paystackPayment_1.isPaystackConfigured)()) {
        throw new PreauthError("not_configured", "Paystack is not configured on the server (PAYSTACK secret key missing).", 503);
    }
    const reference = input.reference || newPreauthReference();
    const data = await (0, paystackPayment_1.paystackFetch)("/preauthorization/initialize", {
        method: "POST",
        body: JSON.stringify({
            email: input.email,
            // Docs cURL sends amount as a string of cents; minimum 100 for ZAR.
            amount: String(holdAmountCents(input.amountRands)),
            currency: "ZAR",
            reference,
            expire_after_days: input.expireAfterDays ?? preauthExpireDays(),
            expire_action: input.expireAction ?? "release",
            ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        }),
    });
    const url = String(data?.data?.authorization_url || "");
    if (!url) {
        throw new PreauthError("hold_failed", "Paystack did not return an authorization_url.", 502);
    }
    return {
        reference: String(data?.data?.reference || reference),
        authorizationUrl: url,
    };
}
async function reservePreauthorization(input) {
    if ((0, paystackPayment_1.paymentsMode)() === "mock") {
        return {
            reference: input.reference || newPreauthReference(),
            status: "authorized",
            expiryDate: new Date(Date.now() + 86_400_000).toISOString(),
        };
    }
    if (!(0, paystackPayment_1.isPaystackConfigured)()) {
        throw new PreauthError("not_configured", "Paystack is not configured on the server (PAYSTACK secret key missing).", 503);
    }
    // Docs: "the same parameters as the Initialize endpoint except that it
    // requires the authorization_code" — the example sends amount as a NUMBER.
    const data = await (0, paystackPayment_1.paystackFetch)("/preauthorization/reserve_authorization", {
        method: "POST",
        body: JSON.stringify({
            email: input.email,
            currency: "ZAR",
            amount: Math.max(100, Math.round(input.amountRands * 100)),
            authorization_code: input.authorizationCode,
            ...(input.reference ? { reference: input.reference } : {}),
            expire_after_days: input.expireAfterDays ?? preauthExpireDays(),
            expire_action: input.expireAction ?? "release",
        }),
    });
    return {
        reference: String(data?.data?.reference || input.reference || ""),
        status: String(data?.data?.status || "authorized"),
        expiryDate: data?.data?.expiry_date ? String(data.data.expiry_date) : null,
    };
}
async function capturePreauthorization(input) {
    if ((0, paystackPayment_1.paymentsMode)() === "mock")
        return { accepted: true };
    if (!(0, paystackPayment_1.isPaystackConfigured)()) {
        throw new PreauthError("not_configured", "Paystack is not configured on the server (PAYSTACK secret key missing).", 503);
    }
    // Docs cURL: { reference, currency, amount } — amount a string of cents.
    await (0, paystackPayment_1.paystackFetch)("/preauthorization/capture", {
        method: "POST",
        body: JSON.stringify({
            reference: input.reference,
            currency: "ZAR",
            amount: String(Math.round(input.amountCents)),
        }),
    });
    // Capture is async on Paystack's side: this means "accepted"; the money is
    // only ours after the preauthorization.capture.success webhook.
    return { accepted: true };
}
async function releasePreauthorization(input) {
    if ((0, paystackPayment_1.paymentsMode)() === "mock")
        return { accepted: true };
    if (!(0, paystackPayment_1.isPaystackConfigured)()) {
        throw new PreauthError("not_configured", "Paystack is not configured on the server (PAYSTACK secret key missing).", 503);
    }
    // Docs: "This endpoint only requires the reference passed in the request body."
    await (0, paystackPayment_1.paystackFetch)("/preauthorization/release", {
        method: "POST",
        body: JSON.stringify({ reference: input.reference }),
    });
    return { accepted: true };
}
const HOLD_CLAIMABLE = `COALESCE(NULLIF(payment_status, ''), 'NONE')
        NOT IN ('HOLD_PENDING', 'HOLD_ACTIVE', 'CAPTURE_PENDING', 'PAID', 'PAYMENT_FAILED')`;
async function loadRide(rideId) {
    await ensurePreauthSchema();
    return await (0, database_1.queryOne)(`SELECT id, passenger_id, payment_method, status,
            estimated_fare, actual_fare, payment_status,
            preauth_reference, hold_checkout_url, hold_expires_at,
            hold_amount_cents, captured_amount
       FROM rides WHERE id = $1`, [rideId]).catch(() => null);
}
/**
 * Places (or re-reports) the hold for a ride — POST /api/rides/book.
 *
 * Claim-first: the ride row is atomically flipped to HOLD_PENDING with the new
 * reference BEFORE Paystack is called, so two concurrent taps can never create
 * two live holds on the same card. A Paystack failure rolls the claim back to
 * NONE. If the ride already has a hold, the SAME hold is returned (idempotent)
 * — including the checkout URL so the app can reopen the secure page.
 *
 * Saved card → /preauthorization/reserve_authorization → HOLD_ACTIVE with no
 *              redirect (the docs' "Reserve by Authorization Code" flow).
 * No card     → /preauthorization/initialize → HOLD_PENDING + authorization_url.
 */
async function createRideHold(input) {
    const ride = await loadRide(input.rideId);
    if (!ride)
        throw new PreauthError("ride_not_found", "Ride not found.", 404);
    if (ride.passenger_id && ride.passenger_id !== input.userId) {
        throw new PreauthError("not_owner", "This ride does not belong to you.", 403);
    }
    const current = normalizePaymentStatus(ride.payment_status);
    if (HOLD_STATES.has(current)) {
        // Idempotent: the hold already exists — hand back what we have.
        return {
            rideId: ride.id,
            reference: ride.preauth_reference,
            paymentStatus: current,
            authorizationUrl: ride.hold_checkout_url,
            holdExpiresAt: ride.hold_expires_at,
            alreadyHeld: true,
        };
    }
    const fareRands = Number.isFinite(Number(input.amountRands)) && Number(input.amountRands) > 0
        ? Number(input.amountRands)
        : Number(ride.estimated_fare || 0);
    if (!Number.isFinite(fareRands) || fareRands <= 0) {
        throw new PreauthError("no_fare", "This ride has no estimated fare to hold against.", 400);
    }
    const reference = newPreauthReference();
    const expiresAt = new Date(Date.now() + preauthExpireDays() * 86_400_000).toISOString();
    // ATOMIC CLAIM — only one writer can move a ride out of its non-hold state.
    const claim = await (0, database_1.execute)(`UPDATE rides
        SET payment_status = 'HOLD_PENDING',
            preauth_reference = $2,
            hold_expires_at = $3::timestamptz,
            hold_amount_cents = $4,
            hold_checkout_url = NULL,
            updated_at = NOW()
      WHERE id = $1 AND ${HOLD_CLAIMABLE}`, [ride.id, reference, expiresAt, holdAmountCents(fareRands)]);
    if (!claim || claim.rowCount === 0) {
        const again = await loadRide(ride.id);
        const st = normalizePaymentStatus(again?.payment_status);
        return {
            rideId: ride.id,
            reference: again?.preauth_reference ?? null,
            paymentStatus: st,
            authorizationUrl: again?.hold_checkout_url,
            holdExpiresAt: again?.hold_expires_at,
            alreadyHeld: true,
        };
    }
    const rollbackClaim = async () => {
        await (0, database_1.execute)(`UPDATE rides
          SET payment_status = 'NONE', preauth_reference = NULL,
              hold_expires_at = NULL, hold_amount_cents = NULL, updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_PENDING' AND preauth_reference = $2`, [ride.id, reference]).catch(() => { });
    };
    try {
        // Returning rider with a reusable card → Reserve by Authorization Code.
        const card = await (0, database_1.queryOne)(`SELECT transaction_index FROM saved_cards
        WHERE user_id = $1 AND transaction_index IS NOT NULL
        ORDER BY is_default DESC, created_at DESC LIMIT 1`, [input.userId]).catch(() => null);
        if (card?.transaction_index) {
            const reserved = await reservePreauthorization({
                email: input.email,
                amountRands: fareRands,
                authorizationCode: card.transaction_index,
                reference,
            });
            await (0, database_1.execute)(`UPDATE rides
            SET payment_status = 'HOLD_ACTIVE',
                preauth_reference = $3,
                hold_expires_at = COALESCE($4::timestamptz, hold_expires_at),
                updated_at = NOW()
          WHERE id = $1 AND payment_status = 'HOLD_PENDING' AND preauth_reference = $2`, [ride.id, reference, reserved.reference || reference, reserved.expiryDate]);
            return {
                rideId: ride.id,
                reference: reserved.reference || reference,
                paymentStatus: "HOLD_ACTIVE",
                authorizationUrl: null,
                holdExpiresAt: reserved.expiryDate,
                alreadyHeld: false,
            };
        }
        // First-time rider → hosted checkout; funds stay in their account until
        // capture, and expire_action "release" frees the hold if they never finish.
        const init = await initializePreauthorization({
            email: input.email,
            amountRands: fareRands,
            reference,
        });
        await (0, database_1.execute)(`UPDATE rides
          SET preauth_reference = $3, hold_checkout_url = $4, updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_PENDING' AND preauth_reference = $2`, [ride.id, reference, init.reference, init.authorizationUrl]);
        return {
            rideId: ride.id,
            reference: init.reference,
            paymentStatus: "HOLD_PENDING",
            authorizationUrl: init.authorizationUrl,
            holdExpiresAt: expiresAt,
            alreadyHeld: false,
        };
    }
    catch (err) {
        await rollbackClaim();
        if (err instanceof PreauthError)
            throw err;
        throw new PreauthError("hold_failed", `Could not hold funds on your card: ${err?.message || "Paystack error"}`, 502);
    }
}
/**
 * Captures the final fare for a completed ride — POST /api/rides/:id/complete
 * and the server-side completion hooks. NEVER marks PAID: that belongs to
 * preauthorization.capture.success (webhook), so an optimistic API response can
 * never lie about money that later fails to settle.
 */
async function captureRideHold(rideId, opts = {}) {
    const ride = await loadRide(rideId);
    if (!ride)
        throw new PreauthError("ride_not_found", "Ride not found.", 404);
    const current = normalizePaymentStatus(ride.payment_status);
    if (current === "CAPTURE_PENDING" || current === "PAID") {
        return {
            paymentStatus: current,
            captured: false,
            alreadyProcessed: true,
            capturedAmount: Number(ride.captured_amount ?? 0) || undefined,
        };
    }
    if (!ride.preauth_reference || current === "NONE") {
        throw new PreauthError("no_hold", "There is no preauthorized hold on this ride to capture.", 400);
    }
    if (current === "HOLD_PENDING") {
        throw new PreauthError("hold_incomplete", "The rider has not finished the secure payment page yet — the funds are not held.", 409);
    }
    if (current === "RELEASED" || current === "HOLD_EXPIRED") {
        throw new PreauthError("hold_released", "This ride's hold was already released — no funds are held to capture.", 409);
    }
    const fareRands = Number(opts.amountRands) > 0
        ? Number(opts.amountRands)
        : Number(ride.actual_fare) > 0
            ? Number(ride.actual_fare)
            : Number(ride.estimated_fare || 0);
    const cents = captureAmountCents(fareRands);
    if (!Number.isFinite(cents) || cents <= 0) {
        throw new PreauthError("no_fare", "This ride has no final fare to capture.", 400);
    }
    const held = Number(ride.hold_amount_cents || 0);
    if (held > 0 && cents > held) {
        // Docs: capture must be ≤ the initial amount. Fail honestly instead of
        // asking Paystack to do something it will reject — ops sees PAYMENT_FAILED.
        await (0, database_1.execute)(`UPDATE rides SET payment_status = 'PAYMENT_FAILED', updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_ACTIVE'`, [ride.id]).catch(() => { });
        console.error(`[preauth] capture EXCEEDS hold ride=${rideId} final=${cents}c > held=${held}c`);
        throw new PreauthError("capture_exceeds_hold", `Final fare (R${(cents / 100).toFixed(2)}) exceeds the held amount (R${(held / 100).toFixed(2)}).`, 409);
    }
    try {
        await capturePreauthorization({
            reference: ride.preauth_reference,
            amountCents: cents,
        });
    }
    catch (err) {
        await (0, database_1.execute)(`UPDATE rides SET payment_status = 'PAYMENT_FAILED', updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_ACTIVE'`, [ride.id]).catch(() => { });
        if (err instanceof PreauthError)
            throw err;
        throw new PreauthError("capture_failed", `Could not capture the fare: ${err?.message || "Paystack error"}`, 502);
    }
    await (0, database_1.execute)(`UPDATE rides SET payment_status = 'CAPTURE_PENDING', updated_at = NOW()
      WHERE id = $1 AND payment_status = 'HOLD_ACTIVE'`, [ride.id]);
    return {
        paymentStatus: "CAPTURE_PENDING",
        captured: true,
        capturedAmount: cents / 100,
    };
}
/**
 * Releases the hold — POST /api/rides/:id/cancel, every cancel path, and the
 * stuck-search reaper. Idempotent: PAID/RELEASED/NONE are no-ops, and
 * CAPTURE_PENDING is deliberately left alone (a capture is already racing).
 */
async function releaseRideHold(rideId, reason = "cancelled") {
    const ride = await loadRide(rideId);
    if (!ride)
        throw new PreauthError("ride_not_found", "Ride not found.", 404);
    const current = normalizePaymentStatus(ride.payment_status);
    if (current === "RELEASED") {
        return { paymentStatus: "RELEASED", released: false, alreadyReleased: true };
    }
    if (current === "PAID" || current === "CAPTURE_PENDING") {
        // Money is (or will be) taken — releasing now would race the capture.
        return { paymentStatus: current, released: false };
    }
    if (!ride.preauth_reference || current === "NONE") {
        return { paymentStatus: "NONE", released: false };
    }
    try {
        await releasePreauthorization({ reference: ride.preauth_reference });
    }
    catch (err) {
        if (current === "HOLD_PENDING") {
            // The checkout never completed, so there is nothing for Paystack to
            // release — an error here means funds were NEVER held. Mark it released
            // locally so the rider's UI and the reaper stop caring about it.
            console.warn(`[preauth] release of an un-completed hold ${ride.preauth_reference} failed (${err?.message || err}) — funds were never held; marking RELEASED`);
        }
        else {
            // HOLD_ACTIVE and Paystack said no: the money is still held. Keep the
            // status honest — expiry (expire_action=release) or a retry will free it.
            throw new PreauthError("release_failed", `Could not release the hold: ${err?.message || "Paystack error"}`, 502);
        }
    }
    await (0, database_1.execute)(`UPDATE rides
        SET payment_status = 'RELEASED', hold_checkout_url = NULL, updated_at = NOW()
      WHERE id = $1 AND payment_status IN ('HOLD_PENDING', 'HOLD_ACTIVE', 'HOLD_EXPIRED')`, [ride.id]).catch(() => { });
    const after = await loadRide(ride.id);
    const st = normalizePaymentStatus(after?.payment_status);
    if (st === "RELEASED") {
        console.log(`[preauth] hold released ride=${rideId} reason=${reason}`);
    }
    return { paymentStatus: st, released: st === "RELEASED", alreadyReleased: false };
}
/**
 * Requirement: reaper for rides stuck in "searching for a driver" past the
 * window — their holds are released so nobody's money sits held forever.
 */
async function releaseStuckHolds(minutes = stuckSearchMinutes()) {
    await ensurePreauthSchema();
    const rows = await (0, database_1.query)(`SELECT id FROM rides
      WHERE COALESCE(NULLIF(payment_status, ''), 'NONE') IN ('HOLD_PENDING', 'HOLD_ACTIVE')
        AND status IN ('searching', 'no_drivers')
        AND created_at < NOW() - make_interval(mins => $1::int)
      ORDER BY created_at
      LIMIT 25`, [String(minutes)]).catch(() => []);
    let released = 0;
    for (const row of rows) {
        try {
            const r = await releaseRideHold(row.id, `stuck_searching_${minutes}m`);
            if (r.released)
                released++;
        }
        catch (err) {
            console.warn(`[preauth] stuck-hold release failed ride=${row.id}:`, err?.message || err);
        }
    }
    if (released > 0) {
        console.log(`[preauth] released ${released} hold(s) stuck searching > ${minutes}m`);
    }
    return released;
}
function startPreauthReaper() {
    const timer = setInterval(() => {
        void releaseStuckHolds().catch((err) => console.warn("[preauth] reaper tick failed:", err?.message || err));
    }, 60_000);
    // Never keep the process alive just for the reaper.
    timer.unref?.();
    return timer;
}
function stopPreauthReaper(timer) {
    clearInterval(timer);
}
// ── Webhook event handling (docs event names, idempotent by construction) ────
/**
 * Stores the reusable authorization_code from a successful hold so the NEXT
 * booking can use Reserve by Authorization Code without re-entering card
 * details (docs: reusable=true authorizations only, email must match).
 */
async function saveReusableAuthorization(userId, auth) {
    const code = String(auth.authorization_code || "");
    if (!code || auth.reusable === false)
        return false;
    await ensurePreauthSchema();
    try {
        const existing = await (0, database_1.queryOne)(`SELECT id FROM saved_cards WHERE transaction_index = $1 LIMIT 1`, [code]);
        if (existing?.id)
            return false; // already on file — nothing to do
        const count = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS n FROM saved_cards WHERE user_id = $1`, [userId]);
        const isDefault = !Number(count?.n || 0);
        await (0, database_1.execute)(`INSERT INTO saved_cards
         (user_id, card_type, last4, bank, exp_month, exp_year, transaction_index, signature, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
            userId,
            String(auth.card_type || auth.brand || "card").slice(0, 20),
            String(auth.last4 || "").slice(0, 4) || "0000",
            auth.bank ? String(auth.bank).slice(0, 100) : null,
            auth.exp_month ? parseInt(String(auth.exp_month), 10) : null,
            auth.exp_year ? parseInt(String(auth.exp_year), 10) : null,
            code,
            auth.signature ? String(auth.signature).slice(0, 64) : null,
            isDefault,
        ]);
        return true;
    }
    catch (err) {
        // A card-file failure must never fail the webhook (Paystack would retry the
        // whole event) — the hold state is already correct without it.
        console.warn("[preauth] saveReusableAuthorization failed:", err?.message || err);
        return false;
    }
}
/**
 * Records a webhook event instance exactly once (paystack_webhook_events PK).
 * Exported so the Pay Later charge.* handlers share the same dedupe ledger —
 * returns false when the event was already seen (replay) and must be ignored.
 */
async function recordWebhookEventOnce(event, data, ref) {
    await ensurePreauthSchema();
    // Replays carry the same Paystack data.id (+reference) → same primary key →
    // ON CONFLICT DO NOTHING reports 0 rows and the caller skips the transition.
    const key = `${event}:${String(data?.id ?? "")}:${String(data?.transaction_id ?? "")}:${ref}`;
    const res = await (0, database_1.execute)(`INSERT INTO paystack_webhook_events (event_key, event, data)
     VALUES ($1, $2, $3) ON CONFLICT (event_key) DO NOTHING`, [key, event, JSON.stringify(data ?? {})]).catch((e) => {
        console.error("[preauth] webhook event log failed:", e?.message || e);
        return null;
    });
    // Table missing/log failure → treat as fresh (guarded UPDATEs still idempotent).
    return res ? res.rowCount !== 0 : true;
}
/**
 * Applies one verified Paystack preauthorization event to the ride it belongs
 * to. Called ONLY from /api/paystack/webhook after the signature check.
 *
 * Every transition is a guarded UPDATE (…WHERE payment_status = 'the state we
 * expect'), so a late, out-of-order or replayed event changes nothing — that,
 * plus the paystack_webhook_events primary key, is the idempotency contract.
 */
async function handlePreauthorizationEvent(event, payload) {
    await ensurePreauthSchema();
    const data = payload?.data ?? {};
    const ref = String(data.reference || "");
    const done = (duplicate, handled, detail) => ({ received: true, event, duplicate, handled, detail });
    if (!ref)
        return done(false, false, "no reference in payload");
    const fresh = await recordWebhookEventOnce(event, data, ref);
    if (!fresh)
        return done(true, false, "duplicate delivery ignored");
    const ride = await (0, database_1.queryOne)(`SELECT id, passenger_id, driver_id, payment_status FROM rides WHERE preauth_reference = $1`, [ref]).catch(() => null);
    if (!ride) {
        // A valid event for something we don't track: still 200 so Paystack stops
        // retrying — just nothing to update.
        return done(false, false, "no ride holds this reference");
    }
    switch (event) {
        case "preauthorization.reserve.success": {
            const st = normalizePaymentStatus(ride.payment_status);
            if (st === "RELEASED") {
                // The rider finished checkout AFTER the ride was cancelled. The hold
                // just became real — release it again so no money stays held.
                console.warn(`[preauth] reserve.success after RELEASE ride=${ride.id} — releasing late hold ${ref}`);
                releasePreauthorization({ reference: ref }).catch((e) => console.error("[preauth] late-hold release failed (expire_action=release is the backstop):", e?.message || e));
                return done(false, true, "late reserve after release — releasing again");
            }
            const upd = await (0, database_1.execute)(`UPDATE rides
            SET payment_status = 'HOLD_ACTIVE',
                hold_expires_at = COALESCE($2::timestamptz, hold_expires_at),
                hold_checkout_url = NULL,
                updated_at = NOW()
          WHERE id = $1 AND payment_status = 'HOLD_PENDING'`, [ride.id, data.expiry_date ? String(data.expiry_date) : null]);
            // Save the reusable token for next time (docs' Reserve-by-Code input) —
            // including the card signature for Pay Later same-card eligibility.
            if (ride.passenger_id && data.authorization) {
                await saveReusableAuthorization(ride.passenger_id, data.authorization);
            }
            return done(false, (upd?.rowCount ?? 0) > 0, (upd?.rowCount ?? 0) > 0 ? "hold active" : `was ${st}, not HOLD_PENDING`);
        }
        case "preauthorization.capture.success": {
            const capturedRands = Number(data.captured_amount ?? data.amount ?? 0) / 100;
            const upd = await (0, database_1.execute)(`UPDATE rides
            SET payment_status = 'PAID',
                paid_at = NOW(),
                captured_amount = $2,
                updated_at = NOW()
          WHERE id = $1 AND payment_status = 'CAPTURE_PENDING'`, [ride.id, capturedRands]);
            if ((upd?.rowCount ?? 0) > 0) {
                // Provenance for Pay Later eligibility: WHICH card paid this ride.
                // countUnlockRides matches rides.card_auth_code against the rider's
                // saved card token (saved_cards.transaction_index); legacy rides
                // without provenance grandfather as card rides.
                if (data.authorization?.authorization_code) {
                    await (0, database_1.execute)(`UPDATE rides
                SET card_auth_code = $2
              WHERE id = $1 AND card_auth_code IS DISTINCT FROM $2`, [ride.id, String(data.authorization.authorization_code)]).catch(() => { });
                }
                // Ledger row so the money has a transaction trail (same table the
                // card-charging flows write to).
                try {
                    await (0, database_1.execute)(`INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider, raw_response)
             VALUES ($1, $2, $3, $4, 'ZAR', 'completed', 'paystack', $5)`, [ride.passenger_id, ride.id, ref, capturedRands, JSON.stringify(data)]);
                }
                catch (e) {
                    console.warn("[preauth] payments ledger insert failed:", e?.message || e);
                }
                console.log(`[preauth] CAPTURED R${capturedRands.toFixed(2)} ride=${ride.id} ref=${ref}`);
                // ── Commission spec: the capture webhook is what RELEASES the driver's
                // wallet credit (pending → posted). Idempotent — a duplicate delivery
                // promotes nothing. The webhook's real Paystack fee refines the split.
                try {
                    const feeCents = data.fee != null && Number.isFinite(Number(data.fee))
                        ? Math.round(Number(data.fee))
                        : null;
                    const { confirmCardRideCredit } = await Promise.resolve().then(() => __importStar(require("../services/walletService")));
                    await confirmCardRideCredit(ride.driver_id ?? "", ride.id, feeCents);
                }
                catch (e) {
                    console.warn(`[wallet] webhook confirm ride=${ride.id}:`, e?.message || e);
                }
                return done(false, true, "paid");
            }
            const after = await (0, database_1.queryOne)(`SELECT payment_status FROM rides WHERE id = $1`, [ride.id]);
            return done(false, false, `capture.success for ride in state ${normalizePaymentStatus(after?.payment_status)} — ignored`);
        }
        case "preauthorization.capture.failed": {
            const upd = await (0, database_1.execute)(`UPDATE rides SET payment_status = 'PAYMENT_FAILED', updated_at = NOW()
          WHERE id = $1 AND payment_status = 'CAPTURE_PENDING'`, [ride.id]);
            console.error(`[preauth] CAPTURE FAILED ride=${ride.id} ref=${ref} message=${data.message || "n/a"}`);
            // Wallet: the capture never happened — the pending driver credit must
            // not survive (voided; never posted, so the balance never moved anyway).
            try {
                const { closeRideWalletEntries } = await Promise.resolve().then(() => __importStar(require("../services/walletService")));
                await closeRideWalletEntries(ride.id, "capture_failed");
            }
            catch (e) {
                console.warn(`[wallet] capture.failed close ride=${ride.id}:`, e?.message || e);
            }
            return done(false, (upd?.rowCount ?? 0) > 0, "payment failed");
        }
        case "preauthorization.release.success": {
            const upd = await (0, database_1.execute)(`UPDATE rides
            SET payment_status = 'RELEASED', hold_checkout_url = NULL, updated_at = NOW()
          WHERE id = $1 AND payment_status IN ('HOLD_PENDING', 'HOLD_ACTIVE', 'HOLD_EXPIRED')`, [ride.id]);
            return done(false, (upd?.rowCount ?? 0) > 0, (upd?.rowCount ?? 0) > 0 ? "released" : "already terminal — ignored");
        }
        case "preauthorization.release.failed": {
            // Docs: "please send an email to techsupport@paystack.com" — surface it.
            console.error(`[preauth] RELEASE FAILED ride=${ride.id} ref=${ref} — hold may still be active; ` +
                `Paystack support: techsupport@paystack.com`);
            return done(false, true, "release failed (status unchanged, still held)");
        }
        default:
            // Unknown/unsupported event: acknowledge with 200 (no retries), no state change.
            return done(false, false, `unhandled event ${event}`);
    }
}
//# sourceMappingURL=preauthorization.js.map