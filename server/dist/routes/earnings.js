"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// GET /api/earnings — Earnings summary
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const period = req.query.period || "week";
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        let dateFilter;
        switch (period) {
            case "today":
                dateFilter = "CURRENT_DATE";
                break;
            case "week":
                dateFilter = "DATE_TRUNC('week', CURRENT_DATE)";
                break;
            case "month":
                dateFilter = "DATE_TRUNC('month', CURRENT_DATE)";
                break;
            case "year":
                dateFilter = "DATE_TRUNC('year', CURRENT_DATE)";
                break;
            default: dateFilter = "DATE_TRUNC('week', CURRENT_DATE)";
        }
        const totals = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS rides,
              COALESCE(SUM(actual_fare), 0)::float AS gross,
              COALESCE(SUM(platform_fee), 0)::float AS fee,
              COALESCE(SUM(actual_fare - COALESCE(platform_fee, 0)), 0)::float AS net
       FROM rides WHERE driver_id = $1 AND status = 'completed' AND created_at >= ${dateFilter}`, [user.id]);
        const breakdown = await (0, database_1.query)(`SELECT DATE(created_at) AS date,
              COUNT(*)::int AS rides,
              COALESCE(SUM(actual_fare), 0)::float AS gross,
              COALESCE(SUM(platform_fee), 0)::float AS fee,
              COALESCE(SUM(actual_fare - COALESCE(platform_fee, 0)), 0)::float AS net
       FROM rides WHERE driver_id = $1 AND status = 'completed' AND created_at >= ${dateFilter}
       GROUP BY DATE(created_at) ORDER BY date DESC`, [user.id]);
        res.json({
            totals: totals || { rides: 0, gross: 0, fee: 0, net: 0 },
            breakdown: breakdown || [],
        });
    }
    catch (err) {
        console.error("Earnings error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=earnings.js.map