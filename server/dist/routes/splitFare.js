"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// Ensure table exists
async function ensureTable() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS split_fares (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      inviter_id UUID NOT NULL REFERENCES users(id),
      invitee_id UUID REFERENCES users(id),
      invitee_email VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
// POST /api/split/invite — Invite to split
router.post("/invite", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTable();
        const firebaseUid = req.userId;
        const { rideId, inviteeEmail, amount } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id, full_name, email FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const split = await (0, database_1.queryOne)(`INSERT INTO split_fares (ride_id, inviter_id, invitee_email, amount) VALUES ($1, $2, $3, $4)
       RETURNING id, ride_id, inviter_id, invitee_email, amount, status, created_at`, [rideId, user.id, inviteeEmail, amount]);
        res.status(201).json(split);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/split/respond — Accept or decline
router.post("/respond", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const { splitId, accept } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id, email FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const status = accept ? "accepted" : "declined";
        await (0, database_1.execute)(`UPDATE split_fares SET status = $1, invitee_id = $2, updated_at = NOW() WHERE id = $3 AND invitee_email = $4`, [status, user.id, splitId, user.email]);
        res.json({ success: true, status });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/split/status — Get split status for a ride
router.get("/status", auth_1.requireAuth, async (req, res) => {
    try {
        const { rideId } = req.query;
        const splits = await (0, database_1.query)(`SELECT sf.*, u.full_name AS inviter_name, u.email AS inviter_email
       FROM split_fares sf LEFT JOIN users u ON u.id = sf.inviter_id
       WHERE sf.ride_id = $1 ORDER BY sf.created_at DESC`, [rideId]);
        res.json({ splits });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/split/pending — Get pending invites
router.get("/pending", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id, email FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ splits: [] });
            return;
        }
        const splits = await (0, database_1.query)(`SELECT sf.*, u.full_name AS inviter_name, u.email AS inviter_email
       FROM split_fares sf LEFT JOIN users u ON u.id = sf.inviter_id
       WHERE sf.invitee_email = $1 AND sf.status = 'pending' ORDER BY sf.created_at DESC`, [user.email]);
        res.json({ splits });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=splitFare.js.map