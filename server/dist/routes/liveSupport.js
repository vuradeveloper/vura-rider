"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const liveSupport_1 = require("../services/liveSupport");
const router = (0, express_1.Router)();
// GET /api/support/live-chat — the rider's latest conversation (any status).
router.get("/live-chat", auth_1.requireAuth, async (req, res) => {
    try {
        const chat = await (0, liveSupport_1.getRiderChat)(req.userId);
        res.json({ chat });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Could not load live support" });
    }
});
// POST /api/support/live-chat — send a message; opens a chat if none is open.
router.post("/live-chat", auth_1.requireAuth, async (req, res) => {
    try {
        const message = String(req.body?.message || "").trim();
        if (!message) {
            res.status(400).json({ error: "Type a message first" });
            return;
        }
        if (message.length > 4000) {
            res.status(400).json({ error: "Message is too long" });
            return;
        }
        const chat = await (0, liveSupport_1.sendRiderMessage)({
            firebaseUid: req.userId,
            message,
            rideId: req.body?.rideId ? String(req.body.rideId) : null,
        });
        res.status(201).json({ chat });
    }
    catch (err) {
        res.status(400).json({ error: err?.message || "Could not send your message" });
    }
});
exports.default = router;
//# sourceMappingURL=liveSupport.js.map