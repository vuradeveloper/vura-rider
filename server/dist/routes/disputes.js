"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// Ensure tables exist
async function ensureTables() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS disputes (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      user_id UUID NOT NULL REFERENCES users(id),
      type VARCHAR(50) NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'open',
      resolution TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS lost_item_reports (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      user_id UUID NOT NULL REFERENCES users(id),
      item_name VARCHAR(255) NOT NULL,
      item_description TEXT,
      driver_contacted BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'reported',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
// POST /api/disputes — Submit dispute
router.post("/", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const firebaseUid = req.userId;
        const { rideId, type, reason, description } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const dispute = await (0, database_1.queryOne)(`INSERT INTO disputes (ride_id, user_id, type, reason, description) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, ride_id, type, reason, description, status, created_at, updated_at`, [rideId, user.id, type, reason, description]);
        res.status(201).json({ dispute });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/disputes — List disputes
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ disputes: [] });
            return;
        }
        const disputes = await (0, database_1.query)("SELECT * FROM disputes WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
        res.json({ disputes });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/disputes/lost-item — Report lost item
router.post("/lost-item", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const firebaseUid = req.userId;
        const { rideId, itemName, itemDescription } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const report = await (0, database_1.queryOne)(`INSERT INTO lost_item_reports (ride_id, user_id, item_name, item_description) VALUES ($1, $2, $3, $4)
       RETURNING id, ride_id, item_name, item_description, driver_contacted, status, created_at`, [rideId, user.id, itemName, itemDescription]);
        res.status(201).json({ report });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/disputes/lost-items — List lost item reports
router.get("/lost-items", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ reports: [] });
            return;
        }
        const reports = await (0, database_1.query)("SELECT * FROM lost_item_reports WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
        res.json({ reports });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=disputes.js.map