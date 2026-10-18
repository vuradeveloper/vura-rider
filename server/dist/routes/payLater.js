"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const paystackPayment_1 = require("../services/paystackPayment");
const PayLaterService_1 = require("../services/PayLaterService");
const router = (0, express_1.Router)();
async function resolveDbUserId(req, res, next) {
    try {
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(404).json({ error: "User not synced yet" });
            return;
        }
        req.dbUserId = user.id;
        next();
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
}
// GET /api/payments/pay-later/status — enrollment + account + open rides
router.get("/status", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const status = await (0, PayLaterService_1.getPayLaterStatus)(req.dbUserId);
        res.json(status);
    }
    catch (err) {
        console.error("Pay Later status error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/enroll — mandate + card validation + account
router.post("/enroll", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        // Card-first enrollment (v1 upgrade): ONE saved card is the repayment
        // rail — bank fields are now OPTIONAL (kept for the old screen's shape).
        // The service derives the card from the rider's saved_cards when absent.
        const { accountHolder, bankCode, accountNumber, cardToken, identityFingerprint, deviceId } = req.body;
        const result = await (0, PayLaterService_1.enrollPayLater)(req.dbUserId, {
            accountHolder,
            bankCode,
            accountNumber,
            cardToken,
            identityFingerprint,
            deviceId,
        });
        res.status(201).json(result);
    }
    catch (err) {
        console.error("Pay Later enroll error:", err);
        res.status(400).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/refresh — recompute limit from loyalty
router.post("/refresh", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const result = await (0, PayLaterService_1.refreshPayLaterLimit)(req.dbUserId);
        res.json(result);
    }
    catch (err) {
        console.error("Pay Later refresh error:", err);
        res.status(400).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/:rideId/pay — manual/early repayment
router.post("/:rideId/pay", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const result = await (0, PayLaterService_1.payRideWithPayLater)(req.dbUserId, String(req.params.rideId));
        res.json(result);
    }
    catch (err) {
        console.error("Pay Later manual pay error:", err);
        res.status(400).json({ error: err.message });
    }
});
// ── Dev/test helpers (never reachable in live payment mode) ──
// POST /api/payments/pay-later/collect — manually trigger the month-end job
router.post("/collect", auth_1.requireAuth, async (req, res) => {
    if ((0, paystackPayment_1.paymentsMode)() === "live") {
        res.status(403).json({ error: "Disabled in live mode" });
        return;
    }
    try {
        const summary = await (0, PayLaterService_1.runMonthlyCollection)();
        res.json({ success: true, summary });
    }
    catch (err) {
        console.error("Pay Later collect error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/dev/simulate — mark a completed ride as a
// pay-later ride (mock only) so the full loop can be exercised end-to-end.
router.post("/dev/simulate", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    if ((0, paystackPayment_1.paymentsMode)() === "live") {
        res.status(403).json({ error: "Disabled in live mode" });
        return;
    }
    try {
        const { rideId } = req.body;
        if (!rideId) {
            res.status(400).json({ error: "rideId is required" });
            return;
        }
        const result = await (0, PayLaterService_1.simulatePayLaterRide)(req.dbUserId, String(rideId));
        res.json({ success: true, ...result });
    }
    catch (err) {
        console.error("Pay Later simulate error:", err);
        res.status(400).json({ error: err.message });
    }
});
// ── Ride Now, Pay Later (v1 upgrade endpoints) ────────────────────────────────
// GET /api/payments/pay-later/eligibility — works for locked AND enrolled
// riders: unlock progress ("3 of 5"), balance/limit/available, due date,
// auto-debit state, ride-to-repay progress. Powers both progress bars.
router.get("/eligibility", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        res.json(await (0, PayLaterService_1.getPayLaterEligibility)(req.dbUserId));
    }
    catch (err) {
        console.error("Pay Later eligibility error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/accept-terms — records the rider's explicit
// acceptance (the booking guard refuses pay-later rides without it).
router.post("/accept-terms", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        res.json(await (0, PayLaterService_1.acceptPayLaterTerms)(req.dbUserId));
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/take — preflight before booking a pay-later
// ride: active → terms → not past due → fare fits available credit. The
// socket booking guard re-checks all of it server-side.
router.post("/take", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const fare = Number(req.body?.estimatedFare ?? req.body?.fare ?? 0);
        res.json(await (0, PayLaterService_1.takePayLaterRide)(req.dbUserId, fare));
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/repay — "Pay what I owe": charges the saved
// card (Paystack); the LEDGER only moves when the charge.success webhook
// confirms → response is either confirmed (mock) or pending (sandbox/live).
router.post("/repay", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const result = await (0, PayLaterService_1.repayWithCard)(req.dbUserId, {
            amountRands: req.body?.amountRands,
            rideId: req.body?.rideId || null,
        });
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// POST /api/payments/pay-later/auto-debit — opt-in consent + on/off switch
// (requires a saved card and accepted terms to enable).
router.post("/auto-debit", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const enabled = !!req.body?.enabled;
        res.json(await (0, PayLaterService_1.setPayLaterAutoDebit)(req.dbUserId, enabled));
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=payLater.js.map