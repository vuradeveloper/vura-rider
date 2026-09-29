"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const dispatch_1 = require("../services/dispatch");
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
        const { license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, vehicle_type, vehicle_vin, odometer_km, carscan_report_name } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Ensure the newer vehicle columns exist (safe on every call).
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(50)`).catch(() => { });
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_vin VARCHAR(50)`).catch(() => { });
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS odometer_km INTEGER`).catch(() => { });
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS carscan_report_name VARCHAR(255)`).catch(() => { });
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
            if (vehicle_type !== undefined) {
                updates.push(`vehicle_type = $${idx}`);
                params.push(vehicle_type);
                idx++;
            }
            if (vehicle_vin !== undefined) {
                updates.push(`vehicle_vin = $${idx}`);
                params.push(vehicle_vin);
                idx++;
            }
            if (odometer_km !== undefined) {
                updates.push(`odometer_km = $${idx}`);
                params.push(odometer_km);
                idx++;
            }
            if (carscan_report_name !== undefined) {
                updates.push(`carscan_report_name = $${idx}`);
                params.push(carscan_report_name);
                idx++;
            }
            updates.push("updated_at = NOW()");
            params.push(existing.id);
            await (0, database_1.execute)(`UPDATE driver_profiles SET ${updates.join(", ")} WHERE id = $${idx}`, params);
        }
        else {
            await (0, database_1.execute)(`INSERT INTO driver_profiles (user_id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, vehicle_type, vehicle_vin, odometer_km, carscan_report_name, is_online)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`, [user.id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, vehicle_type, vehicle_vin, odometer_km, carscan_report_name]);
        }
        const profile = await (0, database_1.queryOne)("SELECT * FROM driver_profiles WHERE user_id = $1", [user.id]);
        res.json(profile);
    }
    catch (err) {
        console.error("Driver profile update error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/drivers/profile — Full driver profile row (vehicle details + license
// number) so the driver app can re-hydrate the "Link Your Car" form after save.
router.get("/profile", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const profile = await (0, database_1.queryOne)("SELECT * FROM driver_profiles WHERE user_id = $1", [user.id]);
        res.json({ profile: profile || null });
    }
    catch (err) {
        console.error("Get driver profile error:", err);
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
// POST /api/drivers/online | /offline — REST twins of the `driver:online` socket
// event. The toggle calls these so the driver's INTENT (is_online) is recorded on
// the server and the app can show the SERVER's answer instead of its own opinion.
// They are idempotent, and coming online immediately retries any waiting ride.
router.post("/online", auth_1.requireAuth, async (req, res) => {
    try {
        const dbUser = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!dbUser) {
            res.status(403).json({ error: "Driver account not synced yet" });
            return;
        }
        const online = req.body?.online !== false; // default: go online
        const onTrip = await (0, database_1.queryOne)(`SELECT id FROM rides WHERE driver_id = $1
        AND status IN ('accepted','driver_arrived','in_progress') LIMIT 1`, [dbUser.id]).catch(() => null);
        const status = online ? (onTrip ? "on_trip" : "available") : "offline";
        const row = await (0, database_1.queryOne)(`INSERT INTO driver_profiles (user_id, is_online, status, last_heartbeat_at, verification_status)
       VALUES ($1, $2, $3, NOW(), 'approved')
       ON CONFLICT (user_id) DO UPDATE
         SET is_online = EXCLUDED.is_online,
             status = EXCLUDED.status,
             last_heartbeat_at = NOW(),
             updated_at = NOW()
       RETURNING user_id, is_online, status, last_heartbeat_at`, [dbUser.id, online, status]).catch(() => null);
        console.log(`[driver] online_intent=${online} status=${status} driver=${dbUser.id}`);
        if (online)
            void (0, dispatch_1.reviveWaitingRides)(global.__vuraIo).catch(() => 0);
        res.json({ ok: true, online_intent: !!row?.is_online, status: row?.status || status });
    }
    catch (err) {
        console.error("Driver online/offline error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/drivers/offline — explicit offline (kept as its own path for clarity).
router.post("/offline", auth_1.requireAuth, async (req, res) => {
    const dbUser = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]).catch(() => null);
    if (!dbUser) {
        res.status(403).json({ error: "Driver account not synced yet" });
        return;
    }
    await (0, database_1.execute)(`UPDATE driver_profiles SET is_online = FALSE, status = 'offline', updated_at = NOW()
      WHERE user_id = $1`, [dbUser.id]).catch(() => undefined);
    console.log(`[driver] online_intent=false status=offline driver=${dbUser.id}`);
    res.json({ ok: true, online_intent: false, status: "offline" });
});
exports.default = router;
//# sourceMappingURL=drivers.js.map