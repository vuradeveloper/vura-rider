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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const paystackPayment_1 = require("../services/paystackPayment");
const payouts_1 = require("./payouts");
const router = (0, express_1.Router)();
// ── Card-testing / carding limits ───────────────────────────────────────────
// A stolen account must not be able to hammer Paystack with new cards. These
// are per signed-in user (the route always runs after requireAuth), so a shared
// office IP is not punished for one abuser.
const byUser = (req) => String(req.userId || "anonymous");
const cardAttemptLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: byUser,
    message: {
        error: "Too many card attempts. Try again in an hour or use your bank app.",
        code: "card_attempts_limited",
    },
});
const chargeAttemptLimiter = (0, express_rate_limit_1.default)({
    windowMs: 10 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: byUser,
    message: {
        error: "Too many payment attempts. Please wait a few minutes.",
        code: "payment_attempts_limited",
    },
});
const verifyLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: byUser,
    message: { error: "Slow down.", code: "verify_rate_limited" },
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Keep at most five saved cards per account; drop the oldest non-default first.
async function pruneSavedCards(userId) {
    await (0, database_1.execute)(`DELETE FROM saved_cards
      WHERE id IN (
        SELECT id FROM saved_cards
         WHERE user_id = $1
         ORDER BY is_default ASC, created_at ASC
         OFFSET 4
      )`, [userId]).catch(() => { });
}
// Ensure the payments table exists (one-time, per server)
async function ensurePaymentsTable() {
    try {
        await (0, database_1.execute)(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID REFERENCES users(id),
        ride_id UUID REFERENCES rides(id),
        reference VARCHAR(100),
        amount NUMERIC(10,2),
        currency VARCHAR(3) DEFAULT 'ZAR',
        status VARCHAR(20),
        provider VARCHAR(20),
        raw_response JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await (0, database_1.execute)(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS authorization_url VARCHAR(500)`);
    }
    catch {
        /* already exists */
    }
}
// Ensure saved_cards exists with the columns we need. The Paystack
// authorization_code is stored in transaction_index so no schema change is
// needed for the tokenisation flow.
async function ensureSavedCardsTable() {
    try {
        await (0, database_1.execute)(`
      CREATE TABLE IF NOT EXISTS saved_cards (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id),
        card_type VARCHAR(20),
        last4 VARCHAR(4),
        bank VARCHAR(100),
        exp_month INTEGER,
        exp_year INTEGER,
        card_number_masked VARCHAR(30),
        transaction_index VARCHAR(100),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await (0, database_1.execute)(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS card_number_masked VARCHAR(30)`);
        await (0, database_1.execute)(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS transaction_index VARCHAR(100)`);
    }
    catch {
        /* already exists */
    }
}
async function getOrCreateUser(firebaseUid, name, email) {
    let user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) {
        user = await (0, database_1.queryOne)(`INSERT INTO users (firebase_uid, full_name, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
       RETURNING id`, [firebaseUid, name || "Rider", email || null, "passenger"]);
    }
    return user || null;
}
// GET /api/payments/methods — List saved payment methods
router.get("/methods", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.userId);
        if (!user) {
            res.json([]);
            return;
        }
        const cards = await (0, database_1.query)(`SELECT id, card_type, last4, bank, is_default FROM saved_cards WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`, [user.id]);
        res.json(cards);
    }
    catch (err) {
        if (err.code === "42P01") {
            res.json([]);
            return;
        }
        console.error("List cards error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/methods — Add a new card manually (fallback; the normal
// path is the hosted Paystack card-register flow which tokenises the card).
router.post("/methods", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.userId, req.user?.name, req.user?.email);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        await ensureSavedCardsTable();
        await pruneSavedCards(user.id);
        const { card_type, last4, bank, exp_month, exp_year } = req.body;
        const existingCards = await (0, database_1.query)("SELECT id FROM saved_cards WHERE user_id = $1 LIMIT 1", [user.id]).catch(() => []);
        const isDefault = existingCards.length === 0;
        const card = await (0, database_1.queryOne)(`INSERT INTO saved_cards (user_id, card_type, last4, bank, exp_month, exp_year, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, card_type, last4, bank, is_default`, [
            user.id,
            card_type || "card",
            last4 || "0000",
            bank || null,
            exp_month ? parseInt(exp_month, 10) : null,
            exp_year ? parseInt(exp_year, 10) : null,
            isDefault
        ]);
        res.status(201).json(card);
    }
    catch (err) {
        console.error("Add card error:", err);
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/payments/methods/:id — Remove a saved card
router.delete("/methods/:id", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.userId);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        await (0, database_1.execute)("DELETE FROM saved_cards WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Remove card error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/card-register - hosted fallback ONLY.
//
// The primary card flow is Paystack Inline (POST /card-intent) with a R1
// verification that is refunded automatically. This route is only used when
// the Inline script cannot load inside the WebView. It uses the same R1
// verification charge, NOT the old R5 preauthorization hold, so the rider is
// never asked for R5 while adding a card.
router.post("/card-register", auth_1.requireAuth, cardAttemptLimiter, async (req, res) => {
    try {
        const user = await (0, database_1.queryOne)("SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        const amount = 1.0;
        const reference = `VURACARD${Date.now().toString(36).toUpperCase()}` +
            `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        try {
            await ensurePaymentsTable();
            await (0, database_1.execute)(`INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, NULL, $2, $3, 'ZAR', 'initiated', 'paystack')`, [user.id, reference, amount]);
        }
        catch (e) { /* logging/table issues shouldn't block the payment */ }
        const result = await (0, paystackPayment_1.initializeTransaction)({
            amountRands: amount,
            reference,
            email: user.email,
        });
        try {
            await (0, database_1.execute)(`UPDATE payments SET authorization_url = $1, updated_at = NOW() WHERE reference = $2`, [result.authorizationUrl, reference]);
        }
        catch (e) { /* best-effort */ }
        res.json({
            reference: result.reference,
            authorizationUrl: result.authorizationUrl,
            amountRands: amount,
            hold: false,
        });
    }
    catch (err) {
        console.error("Card register error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/card-intent - reference + public key for Paystack Inline.
//
// This is the IN-APP card form: the rider never leaves Vura; Paystack's own
// modal collects the card. The R1 verification charge is refunded by /verify or
// the charge.success webhook (whichever arrives first).
router.post("/card-intent", auth_1.requireAuth, cardAttemptLimiter, async (req, res) => {
    try {
        const user = await (0, database_1.queryOne)("SELECT id, email FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        const reference = `VURAADD${Date.now().toString(36).toUpperCase()}` +
            `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const amount = 1.0;
        try {
            await ensurePaymentsTable();
            await (0, database_1.execute)(`INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, NULL, $2, $3, 'ZAR', 'initiated', 'paystack')`, [user.id, reference, amount]);
        }
        catch (e) { /* logging/table issues shouldn't block the payment */ }
        const mode = (0, paystackPayment_1.paymentsMode)();
        const publicKey = mode === "live"
            ? process.env.PAYSTACK_PUBLIC_LIVE || process.env.PAYSTACK_PUBLIC_KEY || ""
            : process.env.PAYSTACK_PUBLIC_TEST || process.env.PAYSTACK_PUBLIC_KEY || "";
        res.json({
            reference,
            publicKey,
            email: user.email,
            amountRands: amount,
            mode,
        });
    }
    catch (err) {
        console.error("Card intent error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/initiate — Charge a saved card (card-on-file) via Paystack,
// OR return a hosted-checkout URL when the rider has no saved card yet.
// The saved card's Paystack authorization_code (stored as transaction_index)
// lets us charge without re-entering card details.
router.post("/initiate", auth_1.requireAuth, chargeAttemptLimiter, async (req, res) => {
    try {
        const { amountRands, rideId } = req.body;
        let amount = Number(amountRands);
        if (!amount || amount < 0.2 || amount > 5000) {
            res.status(400).json({ error: "Amount must be between R0.20 and R5 000" });
            return;
        }
        if (rideId != null && !UUID_RE.test(String(rideId))) {
            res.status(400).json({ error: "Invalid ride reference." });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        await ensurePaymentsTable();
        // Repeated card declines are a card-testing signal. Five failed RIDE charges
        // in an hour pauses new charges; a successful card registration is a
        // separate flow and does not trip this.
        const failures = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS n FROM payments
        WHERE user_id = $1 AND ride_id IS NOT NULL AND status = 'failed'
          AND created_at > NOW() - INTERVAL '1 hour'`, [user.id]).catch(() => null);
        if ((failures?.n ?? 0) >= 5) {
            res.status(429).json({
                error: "Too many failed card payments. Try again later, or add a different card.",
                code: "charge_attempts_limited",
            });
            return;
        }
        // The amount is SERVER-AUTHORITATIVE for a ride. Before this guard the app
        // could send any amount (or another rider's ride id) and charge its own
        // saved card up to R5 000. The ride's fare now wins; the client number is
        // only a hint and a mismatch is corrected, not trusted.
        let amountCorrected = false;
        if (rideId) {
            const ride = await (0, database_1.queryOne)(`SELECT passenger_id, estimated_fare, actual_fare, status, payment_status
           FROM rides WHERE id = $1`, [String(rideId)]).catch(() => null);
            if (!ride) {
                res.status(404).json({ error: "Ride not found", code: "ride_not_found" });
                return;
            }
            if (String(ride.passenger_id) !== String(user.id)) {
                res.status(403).json({ error: "That trip is not on your account.", code: "not_ride_owner" });
                return;
            }
            const rideStatus = String(ride.status || "").toLowerCase();
            if (["cancelled", "expired", "no_drivers"].includes(rideStatus)) {
                res.status(409).json({
                    error: "This trip is no longer chargeable.",
                    code: "ride_not_chargeable",
                });
                return;
            }
            const fare = Number(ride.actual_fare ?? ride.estimated_fare);
            if (!Number.isFinite(fare) || fare <= 0) {
                res.status(400).json({ error: "This trip has no chargeable fare yet.", code: "no_fare" });
                return;
            }
            if (Math.abs(fare - amount) > 0.01) {
                console.warn(`[payments] amount corrected user=${user.id} ride=${rideId} sent=${amount} fare=${fare}`);
                amount = Math.round(fare * 100) / 100;
                amountCorrected = true;
            }
        }
        // Card preauthorization: when this ride already carries a real hold (or the
        // capture/paid states), DO NOT charge on top of it — the hold is captured
        // once, for the final fare, when the ride completes. Without this guard a
        // card ride could be charged at booking AND at arrival AND captured again.
        if (rideId) {
            const held = await (0, database_1.queryOne)(`SELECT payment_status FROM rides WHERE id = $1`, [rideId]).catch(() => null);
            const ps = String(held?.payment_status || "").toUpperCase();
            if (ps === "HOLD_ACTIVE" || ps === "CAPTURE_PENDING" || ps === "PAID" || ps === "paid") {
                res.json({
                    reference: null,
                    skipped: "preauth_hold",
                    paymentStatus: ps.toLowerCase(),
                    status: ps === "PAID" || ps === "paid" ? "success" : "pending",
                    message: "This ride is already covered by a card hold — no separate charge was made.",
                });
                return;
            }
        }
        // Default saved card (authorization_code token).
        const savedCard = await (0, database_1.queryOne)(`SELECT transaction_index, last4 FROM saved_cards
       WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`, [user.id]).catch(() => null);
        const reference = `VURA${Date.now().toString(36).toUpperCase()}` +
            `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        try {
            await ensurePaymentsTable();
            await (0, database_1.execute)(`INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, $2, $3, $4, 'ZAR', 'initiated', 'paystack')`, [user.id, rideId || null, reference, amount]);
        }
        catch (e) { /* logging/table issues shouldn't block the payment */ }
        // Mock mode: simulate an approved charge so the flow works end-to-end.
        if ((0, paystackPayment_1.paymentsMode)() === "mock") {
            await (0, database_1.execute)(`UPDATE payments SET status = 'completed', updated_at = NOW() WHERE reference = $1`, [reference]).catch(() => { });
            res.json({
                reference,
                live: false,
                mock: true,
                status: "success",
                amount,
                amount_corrected: amountCorrected,
            });
            return;
        }
        // Have a tokenised card → charge it directly, no WebView needed.
        if (savedCard?.transaction_index) {
            const charge = await (0, paystackPayment_1.chargeAuthorization)({
                amountRands: amount,
                reference,
                email: user.email || "rider@vura.com",
                authorizationCode: savedCard.transaction_index,
            });
            await (0, database_1.execute)(`UPDATE payments SET status = $1, raw_response = $2, updated_at = NOW()
         WHERE reference = $3`, [charge.success ? "completed" : "failed", JSON.stringify(charge), reference]).catch(() => { });
            // Record the charged fare on the ride so drivers see the correct earnings,
            // and stamp WHICH card paid it (Pay Later same-card eligibility provenance).
            if (charge.success && rideId) {
                // Never overwrite the quoted/actual fare with the charge amount: the
                // fare is the source of truth for the driver wallet and the receipt.
                await (0, database_1.execute)(`UPDATE rides SET payment_status = 'paid', payment_method = 'card',
           card_auth_code = $3, updated_at = NOW() WHERE id = $2`, [amount, rideId, savedCard.transaction_index]).catch(() => { });
            }
            res.json({
                reference,
                live: (0, paystackPayment_1.paymentsMode)() === "live",
                status: charge.success ? "success" : "failed",
                message: charge.message,
                usesSavedCard: true,
                amount,
                amount_corrected: amountCorrected,
            });
            return;
        }
        // No saved card → return a Paystack hosted checkout URL.
        const init = await (0, paystackPayment_1.initializeTransaction)({
            amountRands: amount,
            reference,
            email: user.email,
        });
        // Persist the resumable checkout URL (used to reopen 3-D Secure challenges).
        try {
            await (0, database_1.execute)(`UPDATE payments SET authorization_url = $1, updated_at = NOW() WHERE reference = $2`, [init.authorizationUrl, reference]);
        }
        catch (e) { /* best-effort */ }
        res.json({
            ...init,
            reference,
            status: "pending",
            authorizationUrl: init.authorizationUrl,
            amount,
            amount_corrected: amountCorrected,
        });
    }
    catch (err) {
        console.error("Payment initiate error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/payments/return — Paystack redirects the customer's browser here
// after a hosted checkout. The WebView intercepts this URL; we verify the
// transaction and record the result.
router.get("/return", async (req, res) => {
    try {
        const q = req.query;
        const reference = String(q.reference || q.trxref || q.merchant_reference || "");
        if (!reference) {
            res.json({ result: "failed", error: "Missing reference" });
            return;
        }
        const verified = await (0, paystackPayment_1.verifyTransaction)(reference);
        const payStatus = String(verified?.status || "").toLowerCase();
        // 3-D Secure still pending is NOT a failure — keep the payment row pending
        // so the app's poll can finish the tokenisation once Paystack reports success.
        if (verified &&
            payStatus !== "success" &&
            (payStatus === "" || payStatus === "ongoing" || payStatus === "pending" || payStatus === "awaiting_3ds_response" || payStatus === "awaiting_3ds")) {
            let resumeUrl = null;
            try {
                const pm = await (0, database_1.queryOne)("SELECT authorization_url FROM payments WHERE reference = $1 LIMIT 1", [reference]);
                resumeUrl = pm?.authorization_url || null;
            }
            catch (e) { /* best-effort */ }
            res.json({ reference, result: "pending", success: false, pending: true, authorizationUrl: resumeUrl });
            return;
        }
        const success = Boolean(verified && payStatus === "success");
        if (verified) {
            await (0, database_1.execute)(`UPDATE payments SET status = $1, raw_response = $2, updated_at = NOW()
         WHERE reference = $3`, [success ? "completed" : "failed", JSON.stringify(verified), reference]).catch(() => { });
            // Tokenise the card on a successful checkout so future rides charge it
            // directly. Only do this for card registrations (ride_id is NULL).
            if (success && verified.authorization?.reusable) {
                const payment = await (0, database_1.queryOne)("SELECT user_id, ride_id, amount FROM payments WHERE reference = $1", [reference]);
                if (payment) {
                    await storeAuthorizationCard(payment.user_id, verified);
                    // Card registration used a R1.00 auth — refund it immediately so
                    // the rider is never actually charged for adding a card.
                    if (!payment.ride_id) {
                        try {
                            await (0, paystackPayment_1.refundTransaction)(reference, Number(payment.amount));
                            await (0, database_1.execute)(`UPDATE payments SET status = 'refunded', updated_at = NOW()
                 WHERE reference = $1`, [reference]).catch(() => { });
                        }
                        catch (e) {
                            console.warn("Card-register refund failed (manual refund may be needed):", e);
                        }
                    }
                }
            }
        }
        res.json({ reference, result: success ? "success" : "failed", success });
    }
    catch (err) {
        console.error("Payment return error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/payments/verify — Poll payment status by reference. The app's
// WebView polls this; for hosted checkouts we call Paystack's verify endpoint
// to get the authoritative result and tokenise the card on success.
router.get("/verify", auth_1.requireAuth, verifyLimiter, async (req, res) => {
    try {
        const { reference } = req.query;
        if (!reference || typeof reference !== "string") {
            res.status(400).json({ status: "error", error: "Missing reference" });
            return;
        }
        const user = await getOrCreateUser(req.userId);
        if (!user) {
            res.status(401).json({ status: "error", error: "User not found" });
            return;
        }
        const payment = await (0, database_1.queryOne)("SELECT user_id, status, authorization_url, ride_id FROM payments WHERE reference = $1 LIMIT 1", [reference]);
        if (!payment) {
            res.json({ status: "pending", reference });
            return;
        }
        // Reference values are not guessable, but ownership is still checked so a
        // leaked reference cannot tell another account what happened on this trip.
        if (String(payment.user_id) !== String(user.id)) {
            res.status(404).json({ status: "error", error: "Payment not found" });
            return;
        }
        // The webhook (or an earlier /verify) may already have tokenised the card.
        // Return the final state without calling Paystack again; the native card
        // sheet polls this endpoint so it can close even when Paystack's 3DS event
        // stream never delivers a completion.
        if (["card_saved", "refunded", "released", "completed"].includes(String(payment.status))) {
            res.json({ status: "completed", success: true, reference, cardSaved: true });
            return;
        }
        let verified = null;
        try {
            verified = await (0, paystackPayment_1.verifyTransaction)(reference);
        }
        catch (e) {
            console.warn("Verify against Paystack failed:", e);
        }
        // Paystack statuses: "success" = paid, "ongoing"/"awaiting_3ds_response" =
        // still waiting for 3-D Secure, "failed"/"abandoned"/"reversed" = terminal.
        const payStatus = String(verified?.status || "").toLowerCase();
        if (payStatus === "success") {
            const rec = await (0, database_1.queryOne)("SELECT user_id, ride_id, amount, status FROM payments WHERE reference = $1", [reference]).catch(() => null);
            if (rec) {
                const alreadyFinal = ["refunded", "card_saved", "released"].includes(String(rec.status));
                if (!alreadyFinal) {
                    await (0, database_1.execute)("UPDATE payments SET status = 'completed', raw_response = $1, updated_at = NOW() WHERE reference = $2", [JSON.stringify(verified), reference]).catch(() => { });
                }
                if (verified?.authorization?.reusable) {
                    try {
                        await storeAuthorizationCard(rec.user_id, verified);
                    }
                    catch (e) {
                        console.warn("Store card failed on verify:", e);
                    }
                    // The webhook may already have saved the card and requested the refund.
                    // Do not issue a second refund in that case.
                    if (!rec.ride_id && !alreadyFinal) {
                        try {
                            await (0, paystackPayment_1.refundTransaction)(reference, Number(rec.amount));
                            await (0, database_1.execute)("UPDATE payments SET status = 'refunded', raw_response = $1, updated_at = NOW() WHERE reference = $2", [JSON.stringify(verified), reference]).catch(() => { });
                        }
                        catch (e) {
                            console.warn("Card-register refund failed (manual refund may be needed):", e);
                        }
                    }
                }
            }
            res.json({ status: "completed", success: true, reference, paystackStatus: payStatus });
            return;
        }
        // Still waiting on 3-D Secure (or provider hiccup) — NOT a failure. Keep the
        // payment pending so the client can keep polling and the card still gets
        // tokenised the moment Paystack reports success.
        if (payStatus === "" || payStatus === "ongoing" || payStatus === "pending" || payStatus === "awaiting_3ds_response" || payStatus === "awaiting_3ds") {
            res.json({
                status: "pending",
                pending: true,
                reference,
                paystackStatus: payStatus,
                authorizationUrl: payment.authorization_url || null,
            });
            return;
        }
        // Genuine terminal failures.
        await (0, database_1.execute)("UPDATE payments SET status = 'failed', raw_response = $1, updated_at = NOW() WHERE reference = $2", [JSON.stringify(verified || null), reference]).catch(() => { });
        res.json({
            status: (payStatus === "abandoned" || payStatus === "reversed" ? "abandoned" : "failed"),
            success: false,
            reference,
            paystackStatus: payStatus,
        });
    }
    catch (err) {
        console.error("Verify payment error:", err);
        res.status(500).json({ status: "error", error: err.message });
    }
});
// Store a Paystack authorization_code as the user's saved (default) card.
async function storeAuthorizationCard(userId, verified) {
    const auth = verified.authorization;
    if (!auth)
        return;
    try {
        await ensureSavedCardsTable();
        const token = String(auth.authorization_code || "").trim();
        const last4 = String(auth.last4 || "").replace(/\D/g, "").slice(-4) || null;
        if (!token)
            return;
        const byToken = await (0, database_1.queryOne)(`SELECT id FROM saved_cards WHERE user_id = $1 AND transaction_index = $2 LIMIT 1`, [userId, token]);
        const byLast4 = !byToken && last4
            ? await (0, database_1.queryOne)(`SELECT id, is_default FROM saved_cards
           WHERE user_id = $1 AND last4 = $2 ORDER BY is_default DESC LIMIT 1`, [userId, last4]).catch(() => null)
            : null;
        if (byToken) {
            await (0, database_1.execute)(`UPDATE saved_cards
         SET card_type = COALESCE($1, card_type), bank = COALESCE($2, bank),
             exp_month = COALESCE($3, exp_month), exp_year = COALESCE($4, exp_year)
         WHERE id = $5`, [auth.card_type || null, auth.bank || null, auth.exp_month || null, auth.exp_year || null, byToken.id]).catch(() => { });
        }
        else if (byLast4) {
            await (0, database_1.execute)(`UPDATE saved_cards
         SET transaction_index = $1, card_type = COALESCE($2, card_type),
             bank = COALESCE($3, bank), exp_month = COALESCE($4, exp_month),
             exp_year = COALESCE($5, exp_year), is_default = true
         WHERE id = $6`, [token, auth.card_type || null, auth.bank || null, auth.exp_month || null, auth.exp_year || null, byLast4.id]).catch(() => { });
        }
        else {
            await pruneSavedCards(userId);
            await (0, database_1.execute)(`INSERT INTO saved_cards (user_id, card_type, last4, transaction_index, exp_month, exp_year, bank, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`, [userId, auth.card_type || "card", last4 || "0000", token, auth.exp_month || null, auth.exp_year || null, auth.bank || null]).catch(() => { });
        }
    }
    catch (e) {
        console.warn("Could not store authorization card:", e);
    }
}
// POST /api/payments/initialize — Initialize ride payment (cash vs card marker)
router.post("/initialize", auth_1.requireAuth, async (req, res) => {
    try {
        const { rideId, paymentMethod } = req.body;
        if (paymentMethod === "cash") {
            res.json({ status: "success", paymentMethod: "cash" });
        }
        else {
            res.json({ status: "success", paymentMethod: "saved_card", authorizationUrl: null });
        }
    }
    catch (err) {
        console.error("Payment init error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/refund — DISABLED for app users.
//
// This route used to refund any completed payment owned by the caller. That let
// a rider pay for a real trip, immediately refund it, and keep the service while
// the driver's wallet was already credited. Refunds are now a support decision:
// the rider opens Report an Issue, an admin reviews the trip and records the
// Paystack refund reference in the Reports queue. Money movement stays in
// Paystack; this endpoint no longer moves any.
router.post("/refund", auth_1.requireAuth, async (_req, res) => {
    res.status(403).json({
        error: "Refunds are reviewed by Vura support. Open Report an Issue with the trip reference and we will help.",
        code: "refund_requires_support",
    });
});
// GET /api/payments/banks — List supported banks
router.get("/banks", auth_1.requireAuth, async (_req, res) => {
    res.json([
        { name: "ABSA Bank", code: "632005" },
        { name: "African Bank", code: "430000" },
        { name: "Bidvest Bank", code: "462005" },
        { name: "Capitec Bank", code: "470010" },
        { name: "Discovery Bank", code: "679000" },
        { name: "FNB (First National Bank)", code: "250655" },
        { name: "Investec Bank", code: "580105" },
        { name: "Nedbank", code: "198765" },
        { name: "Standard Bank", code: "051001" },
        { name: "TymeBank", code: "678910" },
    ]);
});
// POST /api/payments/banks/verify — Verify bank account
router.post("/banks/verify", auth_1.requireAuth, async (req, res) => {
    const { accountNumber } = req.body;
    const names = ["John Doe", "Jane Smith", "Sipho Mokoena", "Thandi Ndlovu"];
    const accountName = names[(accountNumber?.length || 0) % names.length];
    res.json({ accountName, verified: true });
});
// POST /api/payments/driver/banking — Save banking details
router.post("/driver/banking", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.userId);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const { accountNumber, bankCode, bankName } = req.body;
        try {
            await (0, database_1.execute)(`
        CREATE TABLE IF NOT EXISTS driver_banking (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          driver_id UUID NOT NULL UNIQUE REFERENCES users(id),
          bank_account_number VARCHAR(50),
          bank_code VARCHAR(20),
          bank_name VARCHAR(100),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
        }
        catch { /* already exists */ }
        await (0, database_1.execute)(`INSERT INTO driver_banking (driver_id, bank_account_number, bank_code, bank_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (driver_id) DO UPDATE SET
         bank_account_number = EXCLUDED.bank_account_number,
         bank_code = EXCLUDED.bank_code,
         bank_name = EXCLUDED.bank_name,
         updated_at = NOW()`, [user.id, accountNumber, bankCode, bankName]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Save banking error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/payments/driver/earnings/pending — Get pending earnings
router.get("/driver/earnings/pending", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.userId);
        if (!user) {
            res.json({ total_rides: 0, total_earnings: 0 });
            return;
        }
        // Real available earnings for the driver: the fares riders actually PAID BY CARD on
        // completed rides, minus what has already been paid out. Cash is excluded because the
        // driver already received that money by hand at the end of the trip - counting it here
        // would let the same fare be withdrawn twice (once in cash, once as a payout).
        //
        // COALESCE(actual_fare, estimated_fare, 0) is what stops this reading R0.00: a ride
        // that completed without actual_fare ever being written still shows the fare the rider
        // was charged. The same expression is used by POST /api/payouts/request, so the wallet
        // figure and the withdrawal limit can never drift apart again.
        //
        // Ensure the payouts table exists - if it's missing the subquery below would 500
        // ("relation payouts does not exist") and the app falls back to R0.00.
        await (0, payouts_1.ensurePayoutsTable)();
        const earnings = await (0, database_1.queryOne)(`SELECT
         (SELECT COALESCE(SUM(COALESCE(actual_fare, estimated_fare, 0)), 0)::float FROM rides
           WHERE driver_id = $1 AND status = 'completed'
             AND LOWER(COALESCE(payment_method, '')) IN ('card', 'pay_later')) AS card_earnings,
         (SELECT COALESCE(SUM(amount), 0)::float FROM payouts
           WHERE driver_id = $1 AND status = 'success') AS paid_out,
         (SELECT COALESCE(SUM(amount), 0)::float FROM payouts
           WHERE driver_id = $1 AND status = 'pending') AS pending_out,
         (SELECT COUNT(*)::int FROM rides
           WHERE driver_id = $1 AND status = 'completed'
             AND LOWER(COALESCE(payment_method, '')) IN ('card', 'pay_later')) AS total_rides`, [user.id]);
        const cardEarnings = Number(earnings?.card_earnings || 0);
        const paidOut = Number(earnings?.paid_out || 0);
        const pendingOut = Number(earnings?.pending_out || 0);
        // ── LEDGER IS THE SOURCE OF TRUTH (commission spec): the wallet balance
        // is the sum of POSTED wallet_ledger entries — card credits land only
        // after the Paystack capture webhook, cash commissions debit at
        // completion, cash-outs subtract. total_earnings stays the WITHDRAWABLE
        // figure (clamped ≥ 0): a negative balance is money owed, shown on
        // /driver/wallet, and can never be cashed out. The legacy rides-derived
        // expression survives only as a fallback if the ledger is unreachable.
        let balanceCents = null;
        let balance = Math.max(0, cardEarnings - paidOut - pendingOut);
        try {
            const { getBalanceCents, walletLedgerReady } = await Promise.resolve().then(() => __importStar(require("../services/walletService")));
            if (await walletLedgerReady()) {
                balanceCents = await getBalanceCents(user.id);
                balance = Math.max(0, Math.round(balanceCents) / 100 - pendingOut);
            }
        }
        catch {
            balanceCents = null;
        }
        res.json({
            ...(earnings || {}),
            card_earnings: cardEarnings,
            paid_out: paidOut,
            pending_out: pendingOut,
            total_earnings: balance,
            balance,
            balance_cents: balanceCents,
            owed_rand: balanceCents != null && balanceCents < 0 ? Math.abs(balanceCents) / 100 : 0,
            total_rides: Number(earnings?.total_rides || 0),
        });
    }
    catch (err) {
        console.error("Pending earnings error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/payments/driver/wallet — §5 wallet page: the ledger balance plus
// the per-ride history (date, payment type, fare, commission, net, running
// balance). A negative balance is reported plainly as money owed, with the
// recovery rule spelled out so the screen can explain it.
router.get("/driver/wallet", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await getOrCreateUser(req.userId);
        if (!user) {
            res.json({ balance_cents: 0, balance_rand: 0, entries: [] });
            return;
        }
        const { getWalletView, getWalletConfig } = await Promise.resolve().then(() => __importStar(require("../services/walletService")));
        const [view, cfg] = await Promise.all([getWalletView(user.id), getWalletConfig()]);
        res.json({
            balance_cents: view.balance_cents,
            balance_rand: Math.round(view.balance_cents) / 100,
            negative: view.balance_cents < 0,
            owed_rand: view.balance_cents < 0 ? Math.abs(view.balance_cents) / 100 : 0,
            commission_pct: view.commission_pct,
            negative_limit_rand: cfg.negative_limit_rand,
            entries: view.entries.map((e) => ({
                id: e.id,
                ride_id: e.ride_id,
                type: e.type,
                status: e.status,
                date: e.created_at,
                payment_method: e.payment_method || null,
                fare_rand: e.fare_rands != null ? Number(e.fare_rands) : null,
                commission_rand: Math.round(Number(e.commission_cents || 0)) / 100,
                // The 10% split, per ride: each part comes OUT of the commission.
                paystack_fee_rand: Math.round(Number(e.paystack_fee_cents || 0)) / 100,
                vat_rand: Math.round(Number(e.vat_cents || 0)) / 100,
                margin_rand: Math.round(Number(e.margin_cents || 0)) / 100,
                amount_rand: Math.round(Number(e.amount_cents)) / 100,
                balance_after_rand: Math.round(Number(e.balance_after_cents)) / 100,
            })),
        });
    }
    catch (err) {
        console.error("Wallet view error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=payments.js.map