import { Router, Request, Response } from "express";
import { query, queryOne } from "../config/database";

// ── Dispatch inspector ────────────────────────────────────────────────────────
//   GET /api/dev/dispatch?key=<DEV_LOG_READ_KEY>&rideId=<uuid>
//   GET /api/dev/dispatch?key=<DEV_LOG_READ_KEY>            (latest activity)
//
// Reads the dispatch trail without needing CloudWatch: the ride row, every offer
// made for it and the ride_events lines (ride_requested -> candidates_found ->
// offer_sent -> offer_expired / ride_accepted / no_drivers), newest first.
//
// Debugging aid only, so it uses the same read key as the device-log viewer
// (DEV_LOG_READ_KEY, defaulting to DEV_LOG_WRITE_KEY) and is always read-only.
const READ_KEY = process.env.DEV_LOG_READ_KEY || process.env.DEV_LOG_WRITE_KEY || "vura-devlog-key";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  // Opened from a file:// page or curl — keep it simple, allow any origin.
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");

  const key = String(req.query.key || req.headers["x-dev-log-key"] || "");
  if (!key || key !== READ_KEY) {
    res.status(401).json({ error: "bad read key" });
    return;
  }

  const rideId = String(req.query.rideId || "").trim();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "60"), 10) || 60, 1), 300);

  try {
    const ride = rideId
      ? await queryOne<any>(
          `SELECT r.id, r.status, r.offer_round, COALESCE(r.version, 0) AS version,
                  r.passenger_id, r.driver_id, r.pickup_address, r.destination_address,
                  r.estimated_fare, r.no_drivers_at, r.created_at, r.updated_at,
                  u.full_name AS driver_name
             FROM rides r LEFT JOIN users u ON u.id = r.driver_id
            WHERE r.id = $1`,
          [rideId]
        ).catch(() => null)
      : null;

    const offers = await query<any>(
      rideId
        ? `SELECT ro.id, ro.ride_id, ro.driver_id, u.full_name AS driver_name, ro.status,
                  ro.round, ro.decline_reason, ro.expires_at, ro.created_at,
                  GREATEST(0, EXTRACT(EPOCH FROM (ro.expires_at - NOW()))::int) AS seconds_remaining
             FROM ride_offers ro LEFT JOIN users u ON u.id = ro.driver_id
            WHERE ro.ride_id = $1
            ORDER BY ro.created_at DESC LIMIT $2`
        : `SELECT ro.id, ro.ride_id, ro.driver_id, u.full_name AS driver_name, ro.status,
                  ro.round, ro.decline_reason, ro.expires_at, ro.created_at,
                  GREATEST(0, EXTRACT(EPOCH FROM (ro.expires_at - NOW()))::int) AS seconds_remaining
             FROM ride_offers ro LEFT JOIN users u ON u.id = ro.driver_id
            ORDER BY ro.created_at DESC LIMIT $1`,
      rideId ? [rideId, limit] : [limit]
    ).catch(() => [] as any[]);

    const events = await query<any>(
      rideId
        ? `SELECT id, ride_id, driver_id, event, detail, created_at FROM ride_events
            WHERE ride_id = $1 ORDER BY id DESC LIMIT $2`
        : `SELECT id, ride_id, driver_id, event, detail, created_at FROM ride_events
            ORDER BY id DESC LIMIT $1`,
      rideId ? [rideId, limit] : [limit]
    ).catch(() => [] as any[]);

    // Who is currently reachable at all (makes "candidates_found: 0" obvious).
    const drivers = await query<any>(
      `SELECT u.id, u.full_name, dp.status, dp.is_online, dp.current_lat, dp.current_lng,
              GREATEST(0, EXTRACT(EPOCH FROM (NOW() - GREATEST(
                COALESCE(dp.last_location_at, dp.updated_at),
                COALESCE(dp.last_heartbeat_at, dp.updated_at))))::int) AS seconds_since_seen
         FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
        ORDER BY dp.status, seconds_since_seen ASC LIMIT 20`
    ).catch(() => [] as any[]);

    res.json({
      serverTime: new Date().toISOString(),
      ride: ride || null,
      offers,
      events,
      drivers,
      config: {
        offerTtlSeconds: 15,
        candidateFreshnessSeconds: 30,
        driverStaleSeconds: 45,
        maxOfferRounds: 12,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "dispatch read failed" });
  }
});

export default router;
