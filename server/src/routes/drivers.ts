import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// GET /api/drivers/stats — Get driver statistics
router.get("/stats", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1 AND role = 'driver'",
      [firebaseUid]
    );
    if (!user) { res.status(403).json({ error: "Driver profile not found" }); return; }

    const today = await queryOne(
      `SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed' AND DATE(created_at) = CURRENT_DATE`,
      [user.id]
    );
    const thisMonth = await queryOne(
      `SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed'
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`,
      [user.id]
    );
    const allTime = await queryOne(
      `SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed'`,
      [user.id]
    );
    const rating = await queryOne(
      `SELECT COALESCE(AVG(score), 0)::float AS average, COUNT(*)::int AS total
       FROM ratings WHERE driver_id = $1`,
      [user.id]
    );

    res.json({
      today: today || { rides: 0, earned: 0 },
      thisMonth: thisMonth || { rides: 0, earned: 0 },
      allTime: allTime || { rides: 0, earned: 0 },
      rating: rating || { average: 0, total: 0 },
    });
  } catch (err: any) {
    console.error("Driver stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drivers/nearby — Find nearby drivers
router.get("/nearby", async (req: AuthRequest, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseFloat(req.query.radius as string) || 10;

    if (isNaN(lat) || isNaN(lng)) { res.status(400).json({ error: "Invalid coordinates" }); return; }

    const latDelta = radius / 111;
    const lngDelta = radius / (111 * Math.cos(lat * Math.PI / 180));

    const drivers = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat, dp.current_lng, dp.current_heading,
              COALESCE(dp.rating_avg, 0)::float AS average_rating
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_online = true
         AND dp.current_lat BETWEEN $1 AND $2
         AND dp.current_lng BETWEEN $3 AND $4
       LIMIT 20`,
      [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta]
    );

    res.json({ drivers });
  } catch (err: any) {
    console.error("Nearby drivers error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/drivers/profile — Update driver profile
router.patch("/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate } = req.body;

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const existing = await queryOne("SELECT id FROM driver_profiles WHERE user_id = $1", [user.id]);

    if (existing) {
      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (license_number !== undefined) { updates.push(`license_number = $${idx}`); params.push(license_number); idx++; }
      if (vehicle_make !== undefined) { updates.push(`vehicle_make = $${idx}`); params.push(vehicle_make); idx++; }
      if (vehicle_model !== undefined) { updates.push(`vehicle_model = $${idx}`); params.push(vehicle_model); idx++; }
      if (vehicle_year !== undefined) { updates.push(`vehicle_year = $${idx}`); params.push(vehicle_year); idx++; }
      if (vehicle_color !== undefined) { updates.push(`vehicle_color = $${idx}`); params.push(vehicle_color); idx++; }
      if (license_plate !== undefined) { updates.push(`license_plate = $${idx}`); params.push(license_plate); idx++; }
      updates.push("updated_at = NOW()");

      params.push(existing.id);
      await execute(`UPDATE driver_profiles SET ${updates.join(", ")} WHERE id = $${idx}`, params);
    } else {
      await execute(
        `INSERT INTO driver_profiles (user_id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, is_online)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [user.id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate]
      );
    }

    const profile = await queryOne("SELECT * FROM driver_profiles WHERE user_id = $1", [user.id]);
    res.json(profile);
  } catch (err: any) {
    console.error("Driver profile update error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;