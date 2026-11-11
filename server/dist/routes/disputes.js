"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// Driver/rider support and appeal categories. These become the ticket type in
// the admin support queue; unknown values are rejected so the queue stays
// filterable and the SLA rules can be applied consistently.
const DISPUTE_TYPES = {
    account_access: "Account access / deactivation",
    verification: "Verification / selfie",
    payout: "Payout / payment",
    app_problem: "App problem",
    safety: "Safety incident",
    trip: "Trip / fare",
    refund: "Refund request",
    cancellation_fee: "Cancellation fee",
    rating: "Rating issue",
    lost_item: "Lost item",
    other: "Other",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    // Admin queue fields (also created by adminReports.ts; idempotent here so a
    // driver's first report cannot fail on a fresh database).
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS admin_note TEXT`).catch(() => undefined);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_to TEXT`).catch(() => undefined);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`).catch(() => undefined);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolution TEXT`).catch(() => undefined);
}
// POST /api/disputes — Submit dispute
router.post("/", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTables();
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const rawType = String(req.body?.type || "other");
        const type = Object.prototype.hasOwnProperty.call(DISPUTE_TYPES, rawType) ? rawType : "other";
        const reason = String(req.body?.reason || "").trim().slice(0, 300) || DISPUTE_TYPES[type];
        const description = String(req.body?.description || "").trim().slice(0, 5000);
        if (description.length < 10) {
            res.status(400).json({ error: "Please describe the problem in at least 10 characters." });
            return;
        }
        const rawRideId = req.body?.rideId == null ? "" : String(req.body.rideId);
        let rideId = null;
        if (rawRideId) {
            if (!UUID_RE.test(rawRideId)) {
                res.status(400).json({ error: "Invalid ride reference." });
                return;
            }
            const ride = await (0, database_1.queryOne)(`SELECT id FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)`, [rawRideId, user.id]);
            if (!ride) {
                res.status(403).json({ error: "That trip is not on your account." });
                return;
            }
            rideId = rawRideId;
        }
        // Simple abuse guard: a real driver does not need 10 tickets an hour.
        const recent = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS n FROM disputes
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [user.id]);
        if ((recent?.n ?? 0) >= 10) {
            res.status(429).json({ error: "Too many reports. Please wait before submitting another." });
            return;
        }
        const dispute = await (0, database_1.queryOne)(`INSERT INTO disputes (ride_id, user_id, type, reason, description)
       VALUES ($1, $2, $3, $4, $5)
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
        await ensureTables();
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ disputes: [] });
            return;
        }
        const disputes = await (0, database_1.query)(`SELECT id, ride_id, type, reason, description, status, resolution,
              created_at, updated_at, resolved_at
         FROM disputes
        WHERE user_id = $1
        ORDER BY created_at DESC`, [user.id]);
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