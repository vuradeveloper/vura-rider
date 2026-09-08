import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import { settleFirstRide } from "../services/AffiliateService";

const router = Router();

// ── Server-side car simulation ──
// The driver app animates its car locally while open; when it's backgrounded/killed
// the phone pauses its timers, so no `driver:location` events reach the rider. This
// server mirror keeps the car moving (and the rider seeing the SAME route + car) even
// when the driver's app is closed. It steps along the driver-published route,and
// broadcasts to the ride room every tick.
const rideSimTimers = new Map<string, ReturnType<typeof setInterval>>();
const RIDE_SIM_STEP_MS = 900;
const RIDE_SIM_STEPS_PER_TICK = 6;

function getSimBearing(sLat: number, sLng: number, dLat: number, dLng: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const y = Math.sin(toRad(dLng - sLng)) * Math.cos(toRad(dLat));
  const x = Math.cos(toRad(sLat)) * Math.sin(toRad(dLat)) - Math.sin(toRad(sLat)) * Math.cos(toRad(dLat)) * Math.cos(toRad(dLng - sLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function startServerRideSim(rideId: string, route: { latitude: number; longitude: number }[]) {
  if (!Array.isArray(route) || route.length < 2) return;
  const prev = rideSimTimers.get(rideId); if (prev) clearInterval(prev);
  let step = 0;
  const tick = setInterval(() => {
    (async () => {
      try {
        step = Math.min(step + RIDE_SIM_STEPS_PER_TICK, route.length - 1);
        const cur = route[step];
        const nxt = route[Math.min(step +  1, route.length -  1)];
        if (!cur) return;
        const bearing = nxt ? getSimBearing(cur.latitude, cur.longitude, nxt.latitude, nxt.longitude) :  0;
        await execute(
          `UPDATE driver_profiles dp SET current_lat = $1, current_lng = $2, current_heading = $3
           FROM rides r WHERE r.id = $4 AND r.driver_id = dp.user_id`,
          [cur.latitude, cur.longitude, bearing, rideId]
        ).catch(() => {});
        const ride = await queryOne<{ status: string }>("SELECT status FROM rides WHERE id = $1", [rideId]).catch(() => null);
        if (!ride || ["cancelled", "completed", "expired"].includes(ride.status) || step >= route.length -  1) {
          clearInterval(tick);
          rideSimTimers.delete(rideId);
          return;
        }
        const io = (global as any).__vuraIo as
          | { to: (room: string) => { emit: (ev: string, ...args: any[]) => void } }
          | undefined;
        io?.to(`ride:${rideId}`).emit("ride:driver:location", {
          rideId: rideId,
          lat: cur.latitude,
          lng: cur.longitude,
          bearing,
          heading: bearing,
        });
      } catch (err: any) {
        // transient DB/broadcast errors — keep pacing the sim
      }
    })();
  }, RIDE_SIM_STEP_MS);
  rideSimTimers.set(rideId, tick);
}

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
    // The authoritative route the DRIVER is following (array of {lat,lng}),
    // so the rider draws the EXACT same line — no per-app route mismatch.
    route: Array.isArray(row.route_data)
      ? row.route_data
      : row.route_data?.coordinates ?? null,
  };
}

// A ride is only "active" if it was created recently. If the app/server crashed
// mid-ride (or a demo/test ride was never finished), a stuck "driver_arrived"
// or "in_progress" row would otherwise be returned FOREVER and every login would
// show "Trip in progress" → "Back to ride". We treat anything older than this as
// dead so a fresh login never resurrects an ancient ride.
const ACTIVE_RIDE_MAX_AGE_MINUTES = 240; // 4 hours

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
              rat.score AS rating_score, rat.comment AS rating_comment,
              r.route_data
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       LEFT JOIN ratings rat ON rat.ride_id = r.id AND rat.passenger_id = $2
       WHERE ${column} = $1
         AND r.status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
         AND r.created_at > NOW() - INTERVAL '${ACTIVE_RIDE_MAX_AGE_MINUTES} minutes'
       ORDER BY r.created_at DESC LIMIT 1`,
      [user.id, user.id]
    );

    res.json({ ride: mapRide(ride) });
  } catch (err: any) {
    console.error("Active ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Periodically clean up rides stuck in "active" states past their freshness
// window so they can never show up as "Trip in progress" / be accepted again.
export async function cleanupStaleRides(): Promise<number> {
  try {
    const res = await execute(
      `UPDATE rides
         SET status = 'expired', updated_at = NOW()
       WHERE status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
         AND created_at < NOW() - INTERVAL '${ACTIVE_RIDE_MAX_AGE_MINUTES} minutes'`
    );
    return res?.rowCount ?? 0;
  } catch (err) {
    console.error("cleanupStaleRides error:", (err as any).message);
    return 0;
  }
}

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
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              rat.score AS rating_score, rat.comment AS rating_comment
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       LEFT JOIN LATERAL (
         SELECT score, comment FROM ratings
         WHERE ride_id = r.id AND driver_id = r.driver_id
         LIMIT 1
       ) rat ON true
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

// GET /api/rides/available — Rides still searching for a driver (driver-side poll)
router.get("/available", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    // Newest first so a fresh booking is NEVER hidden behind old stale
    // "searching" rides that nobody accepted. Only show rides younger than
    // 30 minutes so abandoned/stuck requests drop out automatically.
    const rows = await query<any>(
      `SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       WHERE r.status = 'searching'
         AND r.created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY r.created_at DESC
       LIMIT 20`
    );
    res.json({ rides: (rows || []).map((row) => mapRide(row)) });
  } catch (err: any) {
    console.error("Available rides error:", err);
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
              rat.score AS rating_score, rat.comment AS rating_comment,
              r.route_data
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
              COALESCE(NULLIF(r.actual_fare, 0), NULLIF(r.estimated_fare, 0), 0) AS fare,
              r.platform_fee AS ride_request_fee,
              r.payment_method, r.payment_status,
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

    const scheduled = new Date(scheduledAt);
    if (!scheduledAt || isNaN(scheduled.getTime())) {
      res.status(400).json({ error: "A valid scheduledAt date/time is required" });
      return;
    }
    if (scheduled.getTime() <= Date.now()) {
      res.status(400).json({ error: "Scheduled time must be in the future" });
      return;
    }

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const ride = await queryOne(
      `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, scheduled_at, tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
       RETURNING *`,
      [user.id, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduled.toISOString(), tier || "x"]
    );

    res.status(201).json({ ride: mapRide(ride) });
  } catch (err: any) {
    console.error("Schedule ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/scheduled — Get upcoming scheduled rides
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
       WHERE r.passenger_id = $1 AND r.status = 'scheduled' AND r.scheduled_at > NOW()
       ORDER BY r.scheduled_at ASC`,
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
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const result = await execute(
      `UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = 'Scheduled ride cancelled by user', cancelled_at = NOW()
       WHERE id = $2 AND passenger_id = $3 AND status = 'scheduled'`,
      [user.id, req.params.id, user.id]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Scheduled ride not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("Cancel scheduled ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/rides/:id/pickup — Update the pickup location of an active ride
router.patch("/:id/pickup", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { id } = req.params;
    const { address, lat, lng } = req.body;

    if (!address || lat == null || lng == null) {
      res.status(400).json({ error: "address, lat and lng are required" });
      return;
    }

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const ride = await queryOne<any>(
      "SELECT id, status FROM rides WHERE id = $1 AND passenger_id = $2",
      [id, user.id]
    );
    if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

    if (!["searching", "accepted", "driver_arrived", "in_progress"].includes(ride.status)) {
      res.status(400).json({ error: "Pickup can no longer be updated on this ride" });
      return;
    }

    const updated = await queryOne<any>(
      `UPDATE rides
       SET pickup_address = $1, pickup_lat = $2, pickup_lng = $3, updated_at = NOW()
       WHERE id = $4 AND passenger_id = $5
       RETURNING *`,
      [address, lat, lng, id, user.id]
    );

    res.json({ success: true, ride: mapRide(updated) });
  } catch (err: any) {
    console.error("Update pickup error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/rides/:id/status — Update ride status for simulation
router.patch("/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updates: string[] = ["status = $1", "updated_at = NOW()"];
    const params: any[] = [status, id];

    if (status === "completed") {
      updates.push("completed_at = NOW()");
      // Never let a completed ride fall to R0. If the fare is 0/missing use
      // the estimated fare; if that is also missing, default to the app's
      // minimum demo fare (R0.20).
      updates.push("actual_fare = GREATEST(COALESCE(NULLIF(estimated_fare, 0), 0.20), COALESCE(actual_fare, 0))");
    }

    await execute(
      `UPDATE rides SET ${updates.join(", ")} WHERE id = $${params.length}`,
      params
    );

    if (status === "completed") {
      await settleFirstRide(String(id));
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Update status error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rides/:id/route — The DRIVER saves the authoritative route line it
// is following. The server stores it on the ride so the RIDER can draw the
// EXACT same route (single source of truth — no more route mismatch between
// driver and rider apps).
router.post("/:id/route", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const route = req.body?.route;
    if (!Array.isArray(route) || route.length < 2) {
      res.status(400).json({ error: "route must be an array of {latitude,longitude}" });
      return;
    }
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) { res.status(401).json({ error: "User not synced" }); return; }

    const ride = await queryOne<{ id: string }>(
      `UPDATE rides SET route_data = $1::jsonb, updated_at = NOW()
       WHERE id = $2 AND driver_id = $3
       RETURNING id`,
      [JSON.stringify(route), id, user.id]
    );
    if (!ride) { res.status(404).json({ error: "Ride not found or not your ride" }); return; }
    // Start (or restart) the server-side car sim so the rider keeps seeing the
    // driver's car move even when the driver's app is closed/backgrounded.

    startServerRideSim(String(id), route);

    res.json({ success: true });
  } catch (err: any) {
    console.error("Save route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Ensure the route_data column exists (idempotent migration).
async function ensureRouteColumn() {
  await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_data JSONB`).catch(() => {});
}
ensureRouteColumn();

export default router;