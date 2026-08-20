"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const iVerveService_1 = require("../services/iVerveService");
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
        const { accountHolder, bankCode, accountNumber, cardToken, identityFingerprint } = req.body;
        if (!accountHolder || !bankCode || !accountNumber) {
            res
                .status(400)
                .json({ error: "accountHolder, bankCode and accountNumber are required" });
            return;
        }
        const result = await (0, PayLaterService_1.enrollPayLater)(req.dbUserId, {
            accountHolder,
            bankCode,
            accountNumber,
            cardToken,
            identityFingerprint,
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
    if ((0, iVerveService_1.paymentsMode)() === "live") {
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
    if ((0, iVerveService_1.paymentsMode)() === "live") {
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
exports.default = router;
//# sourceMappingURL=payLater.js.map