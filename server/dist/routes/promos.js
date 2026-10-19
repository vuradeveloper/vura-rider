"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// /api/promos — the APP-facing promo reads (admin CRUD lives in adminV2).
//   GET /api/promos/active?side=rider|driver — live promos for that side.
// The server filters by window + audience; the apps never see the other side.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const promos_1 = require("../services/promos");
const router = (0, express_1.Router)();
router.get("/active", auth_1.requireAuth, async (req, res) => {
    try {
        const side = String(req.query.side || "");
        if (side !== "rider" && side !== "driver") {
            res.status(400).json({ error: "side must be 'rider' or 'driver'" });
            return;
        }
        // Per-user view: targeting + the N-days/N-rides redemption budget ride
        // along as a `usable` flag so the app can grey out an exhausted/expired
        // promo instead of offering a discount the server would refuse.
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]).catch(() => null);
        // Missing table (server older than migration 012) answers [] so the apps
        // simply show no promo instead of an error.
        const promos = await (0, promos_1.activePromosForSide)(side, user?.id ?? null).catch(() => []);
        res.json({ promos });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Could not load promos" });
    }
});
exports.default = router;
//# sourceMappingURL=promos.js.map