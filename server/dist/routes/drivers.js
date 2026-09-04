"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// GET /api/drivers/stats — Get driver statistics
router.get("/stats", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1 AND role = 'driver'", [firebaseUid]);
        if (!user) {
            res.status(403).json({ error: "Driver profile not found" });
            return;
        }
        const today = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed' AND DATE(created_at) = CURRENT_DATE`, [user.id]);
        const thisMonth = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed'
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`, [user.id]);
        const allTime = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed'`, [user.id]);
        const rating = await (0, database_1.queryOne)(`SELECT COALESCE(AVG(score), 0)::float AS average, COUNT(*)::int AS total
       FROM ratings WHERE driver_id = $1`, [user.id]);
        res.json({
            today: today || { rides: 0, earned: 0 },
            thisMonth: thisMonth || { rides: 0, earned: 0 },
            allTime: allTime || { rides: 0, earned: 0 },
            rating: rating || { average: 0, total: 0 },
        });
    }
    catch (err) {
        console.error("Driver stats error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/drivers/nearby — Find nearby drivers
router.get("/nearby", async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const radius = parseFloat(req.query.radius) || 10;
        if (isNaN(lat) || isNaN(lng)) {
            res.status(400).json({ error: "Invalid coordinates" });
            return;
        }
        const latDelta = radius / 111;
        const lngDelta = radius / (111 * Math.cos(lat * Math.PI / 180));
        const drivers = await (0, database_1.query)(`SELECT u.id, u.full_name, u.profile_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat, dp.current_lng, dp.current_heading,
              COALESCE(dp.rating_avg, 0)::float AS average_rating
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_online = true
         AND dp.current_lat BETWEEN $1 AND $2
         AND dp.current_lng BETWEEN $3 AND $4
       LIMIT 20`, [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta]);
        res.json({ drivers });
    }
    catch (err) {
        console.error("Nearby drivers error:", err);
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/drivers/profile — Update driver profile
router.patch("/profile", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const { license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const existing = await (0, database_1.queryOne)("SELECT id FROM driver_profiles WHERE user_id = $1", [user.id]);
        if (existing) {
            const updates = [];
            const params = [];
            let idx = 1;
            if (license_number !== undefined) {
                updates.push(`license_number = $${idx}`);
                params.push(license_number);
                idx++;
            }
            if (vehicle_make !== undefined) {
                updates.push(`vehicle_make = $${idx}`);
                params.push(vehicle_make);
                idx++;
            }
            if (vehicle_model !== undefined) {
                updates.push(`vehicle_model = $${idx}`);
                params.push(vehicle_model);
                idx++;
            }
            if (vehicle_year !== undefined) {
                updates.push(`vehicle_year = $${idx}`);
                params.push(vehicle_year);
                idx++;
            }
            if (vehicle_color !== undefined) {
                updates.push(`vehicle_color = $${idx}`);
                params.push(vehicle_color);
                idx++;
            }
            if (license_plate !== undefined) {
                updates.push(`license_plate = $${idx}`);
                params.push(license_plate);
                idx++;
            }
            updates.push("updated_at = NOW()");
            params.push(existing.id);
            await (0, database_1.execute)(`UPDATE driver_profiles SET ${updates.join(", ")} WHERE id = $${idx}`, params);
        }
        else {
            await (0, database_1.execute)(`INSERT INTO driver_profiles (user_id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, is_online)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`, [user.id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate]);
        }
        const profile = await (0, database_1.queryOne)("SELECT * FROM driver_profiles WHERE user_id = $1", [user.id]);
        res.json(profile);
    }
    catch (err) {
        console.error("Driver profile update error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/drivers/me — Current driver's verification status + profile summary.
// Used to gate "Go Online" in the driver app until their docs are approved.
router.get("/me", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await (0, database_1.queryOne)("SELECT id, license_document_name, id_document_name FROM users WHERE firebase_uid = $1 AND role = 'driver'", [req.userId]);
        if (!user) {
            res.status(403).json({ error: "Driver profile not found" });
            return;
        }
        const profile = await (0, database_1.queryOne)("SELECT vehicle_make, vehicle_model, vehicle_color, license_plate, is_online, verification_status FROM driver_profiles WHERE user_id = $1", [user.id]).catch(() => null);
        res.json({
            verification: profile?.verification_status || (user.license_document_name || user.id_document_name ? "approved" : "pending"),
            hasDocuments: Boolean(user.license_document_name || user.id_document_name),
            profile: profile || null,
        });
    }
    catch (err) {
        console.error("Driver me error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=drivers.js.map