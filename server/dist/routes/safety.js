"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// Ensure safety tables exist
async function ensureTables() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      relationship VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS safety_events (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      type VARCHAR(50) NOT NULL,
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
// GET /api/safety/contacts — List emergency contacts
router.get("/contacts", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ contacts: [] });
            return;
        }
        const contacts = await (0, database_1.query)("SELECT id, name, phone, relationship FROM emergency_contacts WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
        res.json({ contacts });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/safety/contacts — Add emergency contact
router.post("/contacts", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const firebaseUid = req.userId;
        const { name, phone, relationship } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const contact = await (0, database_1.queryOne)(`INSERT INTO emergency_contacts (user_id, name, phone, relationship) VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, relationship`, [user.id, name, phone, relationship || null]);
        res.status(201).json(contact);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/safety/contacts/:id — Delete emergency contact
router.delete("/contacts/:id", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        await (0, database_1.execute)("DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/safety/sos — Trigger SOS
router.post("/sos", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const { rideId } = req.body;
        await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'sos', $2)", [rideId, JSON.stringify({ triggered_by: req.userId, timestamp: new Date().toISOString() })]);
        console.log(`🚨 SOS from ${req.userId} on ride ${rideId}`);
        res.json({ success: true, message: "Emergency services have been notified" });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/safety/share — Generate share link
router.post("/share", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const { rideId } = req.body;
        const shareToken = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'share_started', $2)", [rideId, JSON.stringify({ shareToken, timestamp: new Date().toISOString() })]);
        res.json({ shareToken, shareUrl: `${req.protocol}://${req.get("host")}/share/${shareToken}` });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/safety/share/stop — Stop sharing
router.post("/share/stop", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const { rideId } = req.body;
        await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'share_ended', $2)", [rideId, JSON.stringify({ timestamp: new Date().toISOString() })]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/safety/events — Get safety events
router.get("/events", auth_1.requireAuth, async (req, res) => {
    try {
        const { rideId } = req.query;
        const events = await (0, database_1.query)("SELECT id, ride_id, type, data, created_at FROM safety_events WHERE ride_id = $1 ORDER BY created_at DESC", [rideId]);
        res.json({ events });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=safety.js.map