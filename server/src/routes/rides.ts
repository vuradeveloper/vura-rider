import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// Helper: map DB ride row to app-friendly format
function mapRide(row: any) {
  if (!row) return null;
  return {
    ...row,
    fare: row.actual_fare ?? row.estimated_fare,
    pickup_lat: parseFloat(row.pickup_lat),
    pickup_lng: parseFloat(row.pickup_lng),
    destination_lat: parseFloat(row.destination_lat),
    destination_lng: parseFloat(row.destination_lng),
    my_rating: row.my_rating ?? null,
    rating_score: row.rating_score ?? null,
    rating_comment: row.rating_comment ?? null,
  };
}

// GET /api/rides/me/active — Get current user's active ride
router.get("/me/active", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;

    const user = await queryOne<{ id: string; role: string }>(
      "SELECT id, role FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.json({ ride: null }); return; }

    const column = user.role === "driver" ? "r.driver_id" : "r.passenger_id";
    const ride = await queryOne<any>(
      `SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              d.full_name AS driver_name, d.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng, dp.current_heading AS driver_heading,
              rat.score AS rating_score, rat.comment AS rating_comment
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       LEFT JOIN ratings rat ON rat.ride_id = r.id AND rat.passenger_id = $2
       WHERE ${column} = $1 AND r.status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
       ORDER BY r.created_at DESC LIMIT 1`,
      [user.id, user.id]
    );

    res.json({ ride: mapRide(ride) });
  } catch (err: any) {
    console.error("Active ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/history — Get ride history with pagination
router.get("/history", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.json({ rides: [], pagination: { page, limit, total: 0, pages: 0 } }); return; }

    const countResult = await queryOne<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM rides WHERE passenger_id = $1 OR driver_id = $1",
      [user.id]
    );
    const total = countResult?.total || 0;

    const rows = await query<any>(
      `SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              d.full_name AS driver_name, d.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       WHERE r.passenger_id = $1 OR r.driver_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [user.id, limit, offset]
    );

    res.json({
      rides: rows.map(mapRide),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("Ride history error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/:id — Get specific ride details
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const ride = await queryOne<any>(
      `SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              d.full_name AS driver_name, d.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng, dp.current_heading AS driver_heading,
              rat.score AS rating_score, rat.comment AS rating_comment
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       LEFT JOIN ratings rat ON rat.ride_id = r.id AND rat.passenger_id = u.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
    res.json({ ride: mapRide(ride) });
  } catch (err: any) {
    console.error("Ride detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/:id/receipt — Get ride receipt
router.get("/:id/receipt", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const ride = await queryOne<any>(
      `SELECT r.id, r.id AS ride_id, r.pickup_address, r.destination_address,
              r.distance_km, r.duration_mins,
              COALESCE(r.actual_fare, r.estimated_fare) AS fare,
              r.platform_fee AS ride_request_fee,
              r.created_at, r.completed_at,
              d.full_name AS driver_name, d.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.license_plate,
              r.id || '-' || TO_CHAR(r.created_at, 'YYYYMMDD') AS receipt_number
       FROM rides r
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
    res.json({ receipt: ride });
  } catch (err: any) {
    console.error("Receipt error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rides/schedule — Schedule a future ride
router.post("/schedule", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduledAt, tier } = req.body;

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const ride = await queryOne(
      `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [user.id, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng]
    );

    res.status(201).json({ ride: mapRide(ride) });
  } catch (err: any) {
    console.error("Schedule ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/scheduled — Get scheduled rides
router.get("/scheduled", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.json({ rides: [] }); return; }

    const rides = await query(
      `SELECT r.*, d.full_name AS driver_name
       FROM rides r
       LEFT JOIN users d ON d.id = r.driver_id
       WHERE r.passenger_id = $1 AND r.status = 'pending'
       ORDER BY r.created_at ASC`,
      [user.id]
    );

    res.json({ rides: rides.map(mapRide) });
  } catch (err: any) {
    console.error("Scheduled rides error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rides/scheduled/:id/cancel — Cancel a scheduled ride
router.post("/scheduled/:id/cancel", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await execute(
      "UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = 'Scheduled ride cancelled by user', cancelled_at = NOW() WHERE id = $2",
      [req.userId, req.params.id]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error("Cancel scheduled ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;