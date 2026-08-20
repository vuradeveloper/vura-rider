"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const AffiliateService_1 = require("../services/AffiliateService");
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
function isAdmin(req) {
    const admins = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase());
    return admins.length > 0 && !!req.user?.email && admins.includes(req.user.email.toLowerCase());
}
// POST /api/affiliates/register — create your affiliate profile (first time)
router.post("/register", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        await (0, AffiliateService_1.ensureAffiliateTables)();
        const affiliate = await (0, AffiliateService_1.getOrCreateAffiliate)(req.dbUserId, req.user?.name);
        res.json({ affiliate });
    }
    catch (err) {
        console.error("Affiliate register error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/affiliates/claim — claim a referral code (after joining with a link)
router.post("/claim", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const { code } = req.body;
        const result = await (0, AffiliateService_1.claimReferral)(req.dbUserId, code || "");
        res.json(result);
    }
    catch (err) {
        console.error("Affiliate claim error:", err);
        res.status(400).json({ error: err.message });
    }
});
// GET /api/affiliates/me — dashboard summary
router.get("/me", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const affiliate = await (0, AffiliateService_1.getAffiliateStats)(req.dbUserId);
        res.json({ affiliate });
    }
    catch (err) {
        console.error("Affiliate me error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/affiliates/me/referrals — list of invited riders
router.get("/me/referrals", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const referrals = await (0, AffiliateService_1.listReferrals)(req.dbUserId);
        res.json({ referrals });
    }
    catch (err) {
        console.error("Affiliate referrals error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/affiliates/me/transactions — earnings ledger
router.get("/me/transactions", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const transactions = await (0, AffiliateService_1.listTransactions)(req.dbUserId);
        res.json({ transactions });
    }
    catch (err) {
        console.error("Affiliate transactions error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/affiliates/use — Spend affiliate credit on a completed ride
router.post("/use", auth_1.requireAuth, resolveDbUserId, async (req, res) => {
    try {
        const { rideId } = req.body;
        if (!rideId) {
            res.status(400).json({ error: "rideId is required" });
            return;
        }
        const result = await (0, AffiliateService_1.useBalanceForRide)(req.dbUserId, String(rideId));
        res.json(result);
    }
    catch (err) {
        console.error("Affiliate credit use error:", err);
        res.status(400).json({ error: err.message });
    }
});
// ── Admin ──
router.get("/admin/payouts", auth_1.requireAuth, async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403).json({ error: "Admin only" });
        return;
    }
    try {
        const payouts = await (0, AffiliateService_1.listPayouts)();
        res.json({ payouts });
    }
    catch (err) {
        console.error("Admin payouts error:", err);
        res.status(500).json({ error: err.message });
    }
});
router.post("/admin/payouts/:id/approve", auth_1.requireAuth, async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403).json({ error: "Admin only" });
        return;
    }
    try {
        const result = await (0, AffiliateService_1.approvePayout)(String(req.params.id), req.userId);
        res.json(result);
    }
    catch (err) {
        console.error("Admin approve payout error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=affiliates.js.map