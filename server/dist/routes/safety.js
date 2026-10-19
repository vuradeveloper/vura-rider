"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const sosService_1 = require("../services/sosService");
const checkinService_1 = require("../services/checkinService");
const pinService_1 = require("../services/pinService");
const router = (0, express_1.Router)();
/** DB user id for the authed Firebase uid (the routes' shared resolution). */
async function dbUserId(req) {
    const u = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]).catch(() => null);
    return u?.id ?? null;
}
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
// POST /api/safety/sos — Trigger SOS (§4): enriches the alert with both
// people's names + phones, the car incl. plate, live GPS and the ride id/time,
// stores it in sos_alerts for the admin console, and answers with the truth —
// Vura's safety team is alerted; no emergency service is called automatically.
router.post("/sos", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const uid = await dbUserId(req);
        if (!uid) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const { rideId, location } = req.body || {};
        const role = String(req.body?.role) === "driver" ? "driver" : "rider";
        const result = await (0, sosService_1.triggerSos)({
            rideId: rideId || null,
            byUserId: uid,
            byRole: role,
            location: location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))
                ? { lat: Number(location.lat), lng: Number(location.lng) }
                : null,
        });
        res.json({ success: true, id: result.id, message: result.message, ride_id: result.ride_id });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/safety/checkin/respond — the rider's "I'm safe" (or SOS) answer
// to the anomaly check-in prompt. Stops the admin escalation clock.
router.post("/checkin/respond", auth_1.requireAuth, async (req, res) => {
    try {
        const uid = await dbUserId(req);
        if (!uid) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const { rideId, response } = req.body || {};
        if (!rideId || !["safe", "sos"].includes(String(response))) {
            res.status(400).json({ error: "rideId and response ('safe'|'sos') are required" });
            return;
        }
        const io = global.__vuraIo;
        const out = await (0, checkinService_1.respondCheckin)(io, String(rideId), uid, response);
        if (!out.ok) {
            res.status(400).json({ error: out.error });
            return;
        }
        res.json({ success: true, sos: out.sos ?? null });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/safety/pin?rideId= — the rider's start PIN (§3). Only the ride's
// passenger can read it; nothing after the trip starts (spent/dead secret).
router.get("/pin", auth_1.requireAuth, async (req, res) => {
    try {
        const uid = await dbUserId(req);
        if (!uid) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const rideId = String(req.query.rideId || "");
        if (!rideId) {
            res.status(400).json({ error: "rideId is required" });
            return;
        }
        const out = await (0, pinService_1.getRidePinForRider)(rideId, uid);
        if (!out) {
            res.status(404).json({ error: "No PIN for this ride" });
            return;
        }
        res.json({ ride_id: rideId, pin: out.pin, locked: out.locked });
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
        // ALWAYS share an HTTPS link. Behind the AWS ALB / nginx, `req.protocol`
        // resolves to "http" (the proxy talks HTTP to the app) unless `trust proxy`
        // is enabled — and the public site only answers on port 443. An "http" share
        // link would time out in the recipient's browser and never show the trip.
        const host = req.get("host") || "api.ridevura.com";
        const baseUrl = process.env.PUBLIC_BASE_URL || `https://${host}`;
        res.json({ shareToken, shareUrl: `${baseUrl}/share/${shareToken}` });
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