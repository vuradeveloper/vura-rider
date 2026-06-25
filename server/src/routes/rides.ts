import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { query, queryOne } from "../config/database";
import { RideWithDetails, User } from "../types";

const router = Router();

// ── Active ride (rider restore state) ──
router.get("/me/active", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = req.user!.dbUser;

    const ride = await queryOne<RideWithDetails>(
      `SELECT r.*,
              p.full_name AS passenger_name, p.phone AS passenger_phone,
              d.full_name AS driver_name, d.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate AS driver_license_plate,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng, dp.current_heading AS driver_heading
       FROM rides r
       LEFT JOIN users p ON p.id = r.passenger_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = d.id
       WHERE (r.passenger_id = $1 OR r.driver_id = $1)
         AND r.status NOT IN ('completed', 'cancelled')
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [u.id]
    );

    res.json({ ride: ride ?? null });
  } catch (err: any) {
    console.error("GET /api/rides/me/active error:", err.message);
    res.status(500).json({ error: "Failed to get active ride" });
  }
});

// ── Ride history (paginated) ──
router.get("/history", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = req.user!.dbUser;
    const page = parseInt((req.query.page as string) ?? "1");
    const limit = Math.min(parseInt((req.query.limit as string) ?? "20"), 100);
    const offset = (page - 1) * limit;

    const rides = await query<RideWithDetails>(
      `SELECT r.*,
              d.full_name AS driver_name,
              p.full_name AS passenger_name,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color,
              dp.license_plate AS driver_license_plate,
              rt.score AS my_rating
       FROM rides r
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN users p ON p.id = r.passenger_id
       LEFT JOIN driver_profiles dp ON dp.user_id = d.id
       LEFT JOIN ratings rt ON rt.ride_id = r.id AND rt.passenger_id = $1
       WHERE (r.passenger_id = $1 OR r.driver_id = $1)
         AND r.status IN ('completed', 'cancelled')
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [u.id, limit, offset]
    );

    const countRows = await query(
      `SELECT COUNT(*)::int AS total
       FROM rides
       WHERE (passenger_id = $1 OR driver_id = $1)
         AND status IN ('completed', 'cancelled')`,
      [u.id]
    );

    const total = countRows[0]?.total ?? 0;

    res.json({
      rides,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("GET /api/rides/history error:", err.message);
    res.status(500).json({ error: "Failed to get ride history" });
  }
});

// ── Single ride details ──
router.get("/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = req.user!.dbUser;
    const { id } = req.params;

    const ride = await queryOne<RideWithDetails>(
      `SELECT r.*,
              d.full_name AS driver_name, d.phone AS driver_phone,
              p.full_name AS passenger_name, p.phone AS passenger_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color,
              dp.license_plate AS driver_license_plate,
              rt.score AS rating_score, rt.comment AS rating_comment
       FROM rides r
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN users p ON p.id = r.passenger_id
       LEFT JOIN driver_profiles dp ON dp.user_id = d.id
       LEFT JOIN ratings rt ON rt.ride_id = r.id
       WHERE r.id = $1 AND (r.passenger_id = $2 OR r.driver_id = $2)`,
      [id, u.id]
    );

    if (!ride) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    res.json({ ride });
  } catch (err: any) {
    console.error("GET /api/rides/:id error:", err.message);
    res.status(500).json({ error: "Failed to get ride" });
  }
});

export default router;
