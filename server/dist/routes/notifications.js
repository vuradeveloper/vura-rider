"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// POST /api/notifications/register — Register push token
router.post("/register", auth_1.requireAuth, async (req, res) => {
    try {
        const { token, platform } = req.body;
        if (!token) {
            res.status(400).json({ error: "Push token is required" });
            return;
        }
        await (0, database_1.execute)(`INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, updated_at = NOW()`, [req.userId, token, platform || "unknown"]);
        res.json({ success: true });
    }
    catch (err) {
        // Create table if needed
        if (err.code === "42P01") {
            try {
                await (0, database_1.execute)(`
          CREATE TABLE IF NOT EXISTS push_tokens (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            token VARCHAR(500) NOT NULL,
            platform VARCHAR(20),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, token)
          )
        `);
                const { token, platform } = req.body;
                await (0, database_1.execute)(`INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform`, [req.userId, token, platform || "unknown"]);
                res.json({ success: true });
            }
            catch (err2) {
                console.error("Push token error:", err2);
                res.status(500).json({ error: err2.message });
            }
        }
        else {
            console.error("Push token error:", err);
            res.status(500).json({ error: err.message });
        }
    }
});
exports.default = router;
//# sourceMappingURL=notifications.js.map