import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import { settleFirstRide } from "../services/AffiliateService";
import { startServerRideSim, stopServerRideSim } from "../services/rideSim";
import { acceptRide, declineOffer } from "../services/dispatch";
import { attachVehicleImages } from "../services/vehicleImages";
import type { Server as SocketIOServer } from "socket.io";

const router = Router();

// GET /api/rides/me/active-state â€” ONE call that rebuilds the app's world.
//
// The apps call this on launch, on returning to the foreground and on every socket
// reconnect. The DB is the source of truth, so a force-quit mid-trip lands the user
// back on their trip instead of an empty home screen; a driver gets their pending
// offer with the SECONDS REMAINING (so an expired offer can never show a stale
// accept button).
router.get("/me/active-state", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{ id: string; role: string }>(
      "SELECT id, role FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) {
      res.json({ role: null, offer: null, ride: null, serverTime: new Date().toISOString() });
      return;
    }

    // Driver: a pending, unexpired offer with a countdown.
    const offer = await queryOne<any>(
      `SELECT ro.id AS offer_id, ro.round, ro.expires_at,
              GREATEST(0, EXTRACT(EPOCH FROM (ro.expires_at - NOW()))::int) AS seconds_remaining,
              r.id AS ride_id, r.status, r.pickup_address, r.pickup_lat, r.pickup_lng,
              r.destination_address, r.destination_lat, r.destination_lng,
              r.estimated_fare, r.payment_method, r.waypoints
         FROM ride_offers ro
         JOIN rides r ON r.id = ro.ride_id
        WHERE ro.driver_id = $1 AND ro.status = 'pending' AND ro.expires_at > NOW()
        ORDER BY ro.created_at DESC
        LIMIT 1`,
      [user.id]
    ).catch(() => null);

    // Either role: the ride this user is currently on (rider or driver side).
    const ride = await queryOne<any>(
      `SELECT r.*,
              d.full_name AS driver_name, d.phone AS driver_phone,
              d.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, NULL::text AS vehicle_image_url, dp.license_plate,
              dp.vehicle_year, dp.body_type, dp.vehicle_category,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng,
              dp.current_heading AS driver_heading,
              COALESCE(r.version, 0) AS version
         FROM rides r
         LEFT JOIN users d ON d.id = r.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
        WHERE (r.passenger_id = $1 OR r.driver_id = $1)
          AND r.status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
          AND r.created_at > NOW() - INTERVAL '${ACTIVE_RIDE_MAX_AGE_MINUTES} minutes'
        ORDER BY r.created_at DESC
        LIMIT 1`,
      [user.id]
    ).catch(() => null);

    // The rider must see the ACTUAL car. attachVehicleImages resolves the approved
    // photo for this driver's make|model|generation and hands the app OUR OWN
    // stored URL (GET /api/vehicle-images/â€¦), never a third-party link. The lookup
    // is cached for 5 minutes because this endpoint is polled every second, and a
    // failure here can never break the active-state response â€” the app just keeps
    // its SVG.
    await attachVehicleImages(ride);
    const ridePayload: any = ride ? mapRide(ride) : null;

    res.json({
      role: user.role,
      offer: offer
        ? {
            offerId: offer.offer_id,
            rideId: offer.ride_id,
            round: offer.round,
            expiresAt: offer.expires_at,
            secondsRemaining: offer.seconds_remaining,
            ride: mapRide(offer),
          }
        : null,
      ride: ridePayload,
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Active state error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rides/:id/accept â€” REST twin of the `driver:ride:accept` socket event.
// Idempotent + atomic (see services/dispatch.ts acceptRide): safe to retry, and two
// drivers accepting at the same moment can never both win.
router.post("/:id/accept", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const io = (global as any).__vuraIo as SocketIOServer | undefined;
    if (!io) {
      res.status(503).json({ ok: false, error: "Dispatch is starting up, please retry" });
      return;
    }
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) {
      res.status(403).json({ ok: false, error: "Driver account not synced" });
      return;
    }
    const result = await acceptRide(io, { rideId: String(req.params.id), driverId: user.id });
    if (!result.ok) {
      res.status(409).json({ ok: false, error: result.error || "Ride no longer available" });
      return;
    }
    res.json({ ok: true, rideId: result.rideId, version: result.version, duplicate: result.duplicate === true });
  } catch (err: any) {
    console.error("REST accept error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/rides/:id/decline â€” REST twin of `driver:ride:decline`.
router.post("/:id/decline", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const io = (global as any).__vuraIo as SocketIOServer | undefined;
    if (!io) {
      res.status(503).json({ ok: false, error: "Dispatch is starting up, please retry" });
      return;
    }
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) {
      res.status(403).json({ ok: false, error: "Driver account not synced" });
      return;
    }
    const result = await declineOffer(io, {
      rideId: String(req.params.id),
      driverId: user.id,
      reason: req.body?.reason || "declined",
    });
    res.json({ ok: true, duplicate: result.duplicate === true });
  } catch (err: any) {
    console.error("REST decline error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


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
    // so the rider draws the EXACT same line â€” no per-app route mismatch.
    route: Array.isArray(row.route_data)
      ? row.route_data
      : row.route_data?.coordinates ?? null,
    // Rider stops captured at booking time (pickup â†’ stopsâ€¦ â†’ drop-off). Sent
    // under both names so either app's normaliser finds them.
    waypoints: Array.isArray(row.waypoints) ? row.waypoints : null,
    stops: Array.isArray(row.waypoints) ? row.waypoints : null,
  };
}

// A ride is only "active" if it was created recently. If the app/server crashed
// mid-ride (or a demo/test ride was never finished), a stuck "driver_arrived"
// or "in_progress" row would otherwise be returned FOREVER and every login would
// show "Trip in progress" â†’ "Back to ride". We treat anything older than this as
// dead so a fresh login never resurrects an ancient ride.
const ACTIVE_RIDE_MAX_AGE_MINUTES = 240; // 4 hours

// GET /api/rides/me/active â€” Get current user's active ride
router.get("/me/active", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;

    const user = await queryOne<{ id: string; role: string }>(
      "SELECT id, role FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.json({ ride: null }); return; }

    // A single account may be BOTH a rider AND a driver (both apps can share one
    // login). We must NOT pick the column from role â€” otherwise a dual-role rider
    // never finds their passenger rides here and stays stuck on "Finding your
    // driver" even after a driver accepts. Look for the latest active ride where
    // this user is passenger OR driver.
    const ride = await queryOne<any>(
      `SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              d.full_name AS driver_name, d.phone AS driver_phone,
              d.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, NULL::text AS vehicle_image_url, dp.license_plate,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng, dp.current_heading AS driver_heading,
              rat.score AS rating_score, rat.comment AS rating_comment,
              r.route_data
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       LEFT JOIN ratings rat ON rat.ride_id = r.id AND rat.passenger_id = $2
       WHERE (r.passenger_id = $1 OR r.driver_id = $1)
         AND r.status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
         AND r.created_at > NOW() - INTERVAL '${ACTIVE_RIDE_MAX_AGE_MINUTES} minutes'
       ORDER BY r.created_at DESC LIMIT 1`,
      [user.id, user.id]
    );

    // Same single source of truth as /me/active-state: the rider's live trip card
    // is fed by THIS endpoint, so the approved photo must be attached here too.
    await attachVehicleImages(ride);
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

// GET /api/rides/history â€” Get ride history with pagination
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
              d.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, NULL::text AS vehicle_image_url, dp.license_plate,
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

    await attachVehicleImages(rows);
    res.json({
      rides: rows.map(mapRide),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("Ride history error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/available â€” Rides still searching for a driver (driver-side poll)
router.get("/available", requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    // SCOPE THIS TO THE DRIVER WHO IS ASKING.
    //
    // This endpoint used to return EVERY searching ride on the platform, newest
    // first, and the app simply took the first one (App.tsx: live[0]). That meant
    // a driver in Cape Town was shown a rider in Pretoria, every driver in the
    // country raced for the same ride, and acceptRide had to reject the losers
    // with "Another driver is reviewing this ride".
    //
    // It is kept as the FALLBACK for a missed socket event -- deliberately so.
    // Two rules protect that:
    //   * A driver with no GPS fix still sees everything. Staying available must
    //     never depend on having coordinates (see commit 107a87a).
    //   * Rides with no pickup coords are still returned. Dispatch cannot match
    //     them either (offerToNextDriver bails with ride_has_no_pickup_coords),
    //     so hiding them here would only hide the diagnosis.
    const me = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [_req.userId!]
    );
    const dp = me
      ? await queryOne<{ current_lat: number | null; current_lng: number | null }>(
          "SELECT current_lat, current_lng FROM driver_profiles WHERE user_id = $1",
          [me.id]
        ).catch(() => null)
      : null;

    const hasCoords = dp?.current_lat != null && dp?.current_lng != null;
    // Default 3 km, overridable per deployment. Generous enough that a driver
    // who is genuinely close is never left out; tight enough to stop a city-wide
    // broadcast.
    const radiusKm = Number(process.env.DISPATCH_RADIUS_KM || 3);
    // Newest first so a fresh booking is NEVER hidden behind old stale
    // "searching" rides that nobody accepted. Only show rides younger than
    // 30 minutes so abandoned/stuck requests drop out automatically.
    // Parked 'no_drivers' rides are listed on purpose: the driver app polls this
    // endpoint every 2 seconds, and a ride that ran out of offers must still be
    // visible (and claimable — services/dispatch.acceptRide allows a direct claim
    // on 'no_drivers' when nobody else holds a live offer).
    // Also surfaces upcoming SCHEDULED rides so drivers can accept them
    // BEFORE the pickup time (driver pre-accept). Drivers see them with a
    // "Scheduled" badge and can claim them early â€” driver:ride:accept
    // accepts status 'scheduled' (see socket handlers).
    // Haversine against the ASKING driver's position. When they have no fix
    // ($3::boolean false) the radius test passes for every ride, so behaviour is
    // unchanged from before for a driver without a GPS fix.
    const rows = await query<any>(
      `SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              CASE WHEN r.status = 'scheduled' THEN TRUE ELSE FALSE END AS is_scheduled,
              -- Distance is only meaningful when we actually know where the
              -- asking driver is. Without a fix it would be measured from
              -- (0,0) in the Gulf of Guinea and could reorder a no-GPS
              -- driver's list nonsensically, so it is left NULL and ordering
              -- falls back to newest-first -- exactly the old behaviour.
              CASE WHEN $3::boolean AND r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL
                THEN (6371 * acos(LEAST(1, GREATEST(-1,
                  cos(radians($2)) * cos(radians(r.pickup_lat)) *
                    cos(radians(r.pickup_lng) - radians($1)) +
                  sin(radians($2)) * sin(radians(r.pickup_lat))
                ))))
              END AS distance_km
         FROM rides r
         LEFT JOIN users u ON u.id = r.passenger_id
        WHERE ((r.status IN ('searching', 'no_drivers') AND r.created_at > NOW() - INTERVAL '30 minutes')
           OR (r.status = 'scheduled' AND r.scheduled_at > NOW()))
          -- Keep rides whose pickup coords are missing: dispatch cannot match
          -- them either, so hiding them here would only hide the diagnosis.
          AND (NOT $3::boolean
               OR r.pickup_lat IS NULL OR r.pickup_lng IS NULL
               OR (6371 * acos(LEAST(1, GREATEST(-1,
                     cos(radians($2)) * cos(radians(r.pickup_lat)) *
                       cos(radians(r.pickup_lng) - radians($1)) +
                     sin(radians($2)) * sin(radians(r.pickup_lat))
                   )))) <= $4::double precision)
        -- Nearest first (not merely newest) so the closest real option is what
        -- the driver sees. Scheduled rides still sort ahead of live ones so
        -- pre-accept keeps working.
        -- NULLS LAST: rides we could not measure sort after measured ones, so a
        -- no-GPS driver keeps newest-first ordering among the unmeasurable.
        ORDER BY CASE WHEN r.status = 'scheduled' THEN 0 ELSE 1 END,
                 distance_km ASC NULLS LAST,
                 r.created_at DESC
        LIMIT 20`,
      [
        hasCoords ? Number(dp!.current_lng) : 0,
        hasCoords ? Number(dp!.current_lat) : 0,
        hasCoords,
        radiusKm,
      ]
    );
    res.json({
      rides: (rows || []).map((row) => mapRide(row)),
      // Lets the app and debug distinguish "nothing near you" from "you have no
      // GPS fix, so this list is unfiltered".
      scoped: hasCoords,
      radius_km: hasCoords ? radiusKm : null,
    });
  } catch (err: any) {
    console.error("Available rides error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/scheduled â€” Get upcoming scheduled rides
router.get("/scheduled", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.json({ rides: [] }); return; }

    // Return rides that are still upcoming OR already in the live pipeline
    // (searching / accepted / driver_arrived / in_progress) so the ride never
    // "disappears" from the rider's side once the pickup time comes. Include
    // driver name + phone + car details so the rider sees WHO is coming.
    const rides = await query(
      `SELECT r.*,
              d.full_name AS driver_name, d.phone AS driver_phone,
              d.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, NULL::text AS vehicle_image_url, dp.license_plate
       FROM rides r
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       WHERE r.passenger_id = $1
         AND r.status IN ('scheduled','searching','accepted','driver_arrived','in_progress')
       ORDER BY r.scheduled_at ASC`,
      [user.id]
    );

    await attachVehicleImages(rides);
    res.json({ rides: rides.map(mapRide) });
  } catch (err: any) {
    console.error("Scheduled rides error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/:id â€” Get specific ride details
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const ride = await queryOne<any>(
      `SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              d.full_name AS driver_name, d.phone AS driver_phone,
              d.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, NULL::text AS vehicle_image_url, dp.license_plate,
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
    await attachVehicleImages(ride);
    res.json({ ride: mapRide(ride) });
  } catch (err: any) {
    console.error("Ride detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rides/:id/receipt â€” Get ride receipt
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

// POST /api/rides/schedule â€” Schedule a future ride
router.post("/schedule", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduledAt, tier, estimatedFare, waypoints, stops } = req.body;
    // Stops for the reservation, normalised to { address, lat, lng } â€” same
    // shape and limits as the live booking path.
    const rideWaypoints = (Array.isArray(waypoints) ? waypoints : Array.isArray(stops) ? stops : [])
      .filter((w: any) => w && Number.isFinite(Number(w?.lat)) && Number.isFinite(Number(w?.lng)))
      .slice(0, 8)
      .map((w: any) => ({ address: String(w?.address ?? ""), lat: Number(w.lat), lng: Number(w.lng) }));

    const scheduled = new Date(scheduledAt);
    if (!scheduledAt || isNaN(scheduled.getTime())) {
      res.status(400).json({ error: "A valid scheduledAt date/time is required" });
      return;
    }
    if (scheduled.getTime() <= Date.now()) {
      res.status(400).json({ error: "Scheduled time must be in the future" });
      return;
    }
    // â”€â”€ Reservation window (mirrors Uber Reserve) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // A reservation must be made at least 30 minutes ahead (so a driver can be
    // lined up in advance) and at most 90 days ahead.
    const MIN_LEAD_MS = 30 * 60 * 1000;
    const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;
    const leadMs = scheduled.getTime() - Date.now();
    if (leadMs < MIN_LEAD_MS) {
      res.status(400).json({
        error: "Reservations must be made at least 30 minutes ahead of pickup.",
        code: "RESERVATION_TOO_SOON",
        minLeadMinutes: 30,
      });
      return;
    }
    if (leadMs > MAX_AHEAD_MS) {
      res.status(400).json({
        error: "Reservations can be made at most 90 days ahead of pickup.",
        code: "RESERVATION_TOO_FAR",
        maxAheadDays: 90,
      });
      return;
    }

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // The upfront price is stored at booking time and is locked for the
    // reservation (a reserved fare does not change later, like Uber Reserve).
    const lockedFare =
      estimatedFare != null && Number.isFinite(Number(estimatedFare)) && Number(estimatedFare) > 0
        ? Number(estimatedFare)
        : null;

    // Insert with the stops column when the database has it; if the column is
    // genuinely absent (older DB, no ALTER rights) 42703 = undefined_column and
    // we transparently retry without it, so reserving a ride never 500s.
    const insertScheduledRide = (withStops: boolean) => queryOne(
      withStops
        ? `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, scheduled_at, tier, estimated_fare, waypoints)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10, $11)
           RETURNING *`
        : `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, scheduled_at, tier, estimated_fare)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10)
           RETURNING *`,
      withStops
        ? [user.id, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduled.toISOString(), tier || "x", lockedFare, rideWaypoints.length ? JSON.stringify(rideWaypoints) : null]
        : [user.id, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduled.toISOString(), tier || "x", lockedFare]
    );
    let ride: any;
    try {
      ride = await insertScheduledRide(true);
    } catch (e: any) {
      if (e?.code === "42703") ride = await insertScheduledRide(false);
      else throw e;
    }

    res.status(201).json({ ride: mapRide(ride) });
  } catch (err: any) {
    console.error("Schedule ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rides/scheduled/:id/cancel â€” Cancel a scheduled ride
// Also accepts rides already in the live pipeline (searching/accepted/â€¦) so the
// rider can truly cancel a ride they no longer want â€” not just pre-booked ones.
// The status filter intentionally mirrors the "scheduled section" statuses.
router.post("/scheduled/:id/cancel", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Share the same cancellation-fee policy as the socket path: no fee while
    // searching/scheduled, flat R15 once a driver was matched (after grace).
    const before = await queryOne<{ status: string; accepted_at: Date | null }>(
      "SELECT status, accepted_at FROM rides WHERE id = $1 LIMIT 1",
      [req.params.id]
    ).catch(() => null);
    const FEE_FLAT_RANDS = 15.0;
    const FEE_GRACE_MINUTES = 2;
    let fee = 0.0;
    if (before?.status === "accepted" || before?.status === "driver_arrived") {
      let elapsedMin = 0;
      if (before.accepted_at) {
        elapsedMin = (Date.now() - new Date(before.accepted_at).getTime()) / 60000;
      }
      if (elapsedMin > FEE_GRACE_MINUTES) fee = FEE_FLAT_RANDS;
    }

    const result = await execute(
      `UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = 'Ride cancelled by user', cancelled_at = NOW(), cancellation_fee = $2
       WHERE id = $3 AND passenger_id = $4
         AND status IN ('scheduled','searching','accepted','driver_arrived','in_progress')`,
      [user.id, fee, req.params.id, user.id]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Ride not found or no longer active" });
      return;
    }
    stopServerRideSim(String(req.params.id));

    // Tell the rider + driver + any online driver instantly so the ride
    // disappears everywhere (same broadcast the socket cancel does).
    const io = (global as any).__vuraIo as
      | { to: (room: string) => { emit: (ev: string, ...args: any[]) => void } }
      | undefined;
    io?.to(`ride:${req.params.id}`).emit("ride:cancelled", { reason: "Ride cancelled by user", cancellation_fee: fee });
    io?.to("drivers").emit("ride:cancelled", { rideId: req.params.id, reason: "Ride cancelled by user" });

    res.json({ success: true, cancellation_fee: fee });
  } catch (err: any) {
    console.error("Cancel scheduled ride error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/rides/:id/pickup â€” Update the pickup location of an active ride
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

// PATCH /api/rides/:id/status â€” Update ride status for simulation
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

// POST /api/rides/:id/route â€” The DRIVER saves the authoritative route line it
// is following. The server stores it on the ride so the RIDER can draw the
// EXACT same route (single source of truth â€” no more route mismatch between
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

// Ensure columns added after the original schema exist (idempotent migrations).
async function ensureRouteColumn() {
  await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_data JSONB`).catch(() => {});
  // Rider stops captured at booking time (pickup â†’ waypointsâ€¦ â†’ drop-off).
  await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB`).catch(() => {});
}
ensureRouteColumn();

export default router;