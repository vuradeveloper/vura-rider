"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// WALLET / COMMISSION ADMIN API (/api/admin/v2/wallet/config): the tunable
// numbers behind the 10% split — commission %, VAT slice (inside our
// commission), Paystack fee fallback, and the cash-ride negative limit.
// Reads need settings.read; writes need settings.write and are audited.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const adminAuth_1 = require("../services/adminAuth");
const walletService_1 = require("../services/walletService");
const router = (0, express_1.Router)();
// GET /wallet/config — current commission settings.
router.get("/config", (0, adminAuth_1.requireAdmin)("settings.read"), async (_req, res) => {
    try {
        res.json({ settings: await (0, walletService_1.getWalletConfig)() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PUT /wallet/config — validated partial update, audited (who changed money).
router.put("/config", (0, adminAuth_1.requireAdmin)("settings.write"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const before = await (0, walletService_1.getWalletConfig)();
        const next = await (0, walletService_1.putWalletConfig)((req.body?.settings ?? req.body ?? {}));
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "wallet.config_updated",
            entityType: "wallet_config",
            entityId: "settings",
            oldValue: before,
            newValue: next,
        }).catch(() => { });
        res.json({ settings: next });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=walletAdmin.js.map