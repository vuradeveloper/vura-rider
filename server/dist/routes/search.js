"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// Ensure table exists
async function ensureTable() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS recent_searches (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      name VARCHAR(255) NOT NULL,
      address TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
// GET /api/searches — Get recent searches
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTable();
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ searches: [] });
            return;
        }
        const searches = await (0, database_1.query)("SELECT id, name, address AS addr, lat, lng, created_at FROM recent_searches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20", [user.id]);
        res.json({ searches });
    }
    catch (err) {
        console.error("Get searches error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/searches — Save a search
router.post("/", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTable();
        const firebaseUid = req.userId;
        const { name, address, lat, lng } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        await (0, database_1.execute)(`INSERT INTO recent_searches (user_id, name, address, lat, lng) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, name) DO UPDATE SET address = EXCLUDED.address, lat = EXCLUDED.lat, lng = EXCLUDED.lng, created_at = NOW()`, [user.id, name, address, lat, lng]);
        res.status(201).json({ success: true });
    }
    catch (err) {
        if (err.code === "42P01") {
            res.status(201).json({ success: true });
            return;
        }
        console.error("Save search error:", err);
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/searches — Clear searches
router.delete("/", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ success: true });
            return;
        }
        await (0, database_1.execute)("DELETE FROM recent_searches WHERE user_id = $1", [user.id]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Clear searches error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=search.js.map