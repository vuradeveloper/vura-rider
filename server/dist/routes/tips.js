"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// POST /api/tips — Submit a tip
router.post("/", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const { rideId, amount } = req.body;
        if (!rideId || !amount || amount <= 0) {
            res.status(400).json({ error: "Valid rideId and amount are required" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Add tip to actual_fare
        await (0, database_1.execute)("UPDATE rides SET actual_fare = COALESCE(actual_fare, estimated_fare, 0) + $1 WHERE id = $2 AND passenger_id = $3", [amount, rideId, user.id]);
        console.log(`💰 Tip of ${amount} on ride ${rideId} by ${firebaseUid}`);
        res.json({ success: true, amount });
    }
    catch (err) {
        console.error("Tip error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=tips.js.map