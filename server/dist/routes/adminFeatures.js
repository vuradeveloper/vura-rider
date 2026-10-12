"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/features — admin-only flag & allowlist control (RC4 Item 1/1b).
//
//   GET    /api/admin/features         read all three flags + allowlists,
//                                       last 5 rides' matching paths, build
//   PUT    /api/admin/features         { key, changes } — validated keys only
//   POST   /api/admin/features/enable  one-call enable for test accounts by
//                                       id / email / phone — or FOR EVERYONE
//                                       when no account ids are given
//   POST   /api/admin/features/disable one-call kill-switch-off for all three
//
// Auth: Firebase bearer (requireAuth) + email in ADMIN_EMAILS — the same gate
// every other route in admin.ts uses. All logic lives in services/featureFlags
// so the integration tests exercise the exact code path without HTTP.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const featureFlags_1 = require("../services/featureFlags");
const router = (0, express_1.Router)();
function isAdmin(req) {
    const admins = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase());
    return admins.length > 0 && !!req.user?.email && admins.includes(req.user.email.toLowerCase());
}
function actorOf(req) {
    return req.user?.email || req.userId || "unknown";
}
function sendError(res, err) {
    if (err instanceof featureFlags_1.FeatureFlagError) {
        res.status(err.code === "no_row" ? 409 : 400).json({ error: err.message, code: err.code });
        return;
    }
    console.error("[admin/features] unexpected error:", err);
    res.status(500).json({ error: err?.message || "unexpected error" });
}
router.get("/features", auth_1.requireAuth, async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403).json({ error: "Admin only" });
        return;
    }
    try {
        res.json(await (0, featureFlags_1.readFeatures)());
    }
    catch (err) {
        sendError(res, err);
    }
});
router.put("/features", auth_1.requireAuth, async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403).json({ error: "Admin only" });
        return;
    }
    try {
        const { key, changes } = req.body || {};
        res.json(await (0, featureFlags_1.updateFeature)(key, changes, actorOf(req)));
    }
    catch (err) {
        sendError(res, err);
    }
});
router.post("/features/enable", auth_1.requireAuth, async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403).json({ error: "Admin only" });
        return;
    }
    try {
        const body = req.body || {};
        res.json(await (0, featureFlags_1.enableForAccounts)({
            driverIds: body.driverIds,
            riderIds: body.riderIds,
            driverEmails: body.driverEmails,
            driverPhones: body.driverPhones,
            riderEmails: body.riderEmails,
            riderPhones: body.riderPhones,
            features: body.features,
        }, actorOf(req)));
    }
    catch (err) {
        sendError(res, err);
    }
});
// The exact inverse of enable: one call, all three kill switches off, modes
// back to the seed posture. This is the OFF switch the deploy runbook uses.
router.post("/features/disable", auth_1.requireAuth, async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403).json({ error: "Admin only" });
        return;
    }
    try {
        res.json(await (0, featureFlags_1.disableAllFeatures)(actorOf(req)));
    }
    catch (err) {
        sendError(res, err);
    }
});
exports.default = router;
//# sourceMappingURL=adminFeatures.js.map