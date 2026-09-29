"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupStaleRides = cleanupStaleRides;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const AffiliateService_1 = require("../services/AffiliateService");
const rideSim_1 = require("../services/rideSim");
const dispatch_1 = require("../services/dispatch");
const router = (0, express_1.Router)();
// GET /api/rides/me/active-state — ONE call that rebuilds the app's world.
//
// The apps call this on launch, on returning to the foreground and on every socket
// reconnect. The DB is the source of truth, so a force-quit mid-trip lands the user
// back on their trip instead of an empty home screen; a driver gets their pending
// offer with the SECONDS REMAINING (so an expired offer can never show a stale
// accept button).
router.get("/me/active-state", auth_1.requireAuth, async (req, res) => {
    try {
        const user = await (0, database_1.queryOne)("SELECT id, role FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.json({ role: null, offer: null, ride: null, serverTime: new Date().toISOString() });
            return;
        }
        // Driver: a pending, unexpired offer with a countdown.
        const offer = await (0, database_1.queryOne)(`SELECT ro.id AS offer_id, ro.round, ro.expires_at,
              GREATEST(0, EXTRACT(EPOCH FROM (ro.expires_at - NOW()))::int) AS seconds_remaining,
              r.id AS ride_id, r.status, r.pickup_address, r.pickup_lat, r.pickup_lng,
              r.destination_address, r.destination_lat, r.destination_lng,
              r.estimated_fare, r.payment_method, r.waypoints
         FROM ride_offers ro
         JOIN rides r ON r.id = ro.ride_id
        WHERE ro.driver_id = $1 AND ro.status = 'pending' AND ro.expires_at > NOW()
        ORDER BY ro.created_at DESC
        LIMIT 1`, [user.id]).catch(() => null);
        // Either role: the ride this user is currently on (rider or driver side).
        const ride = await (0, database_1.queryOne)(`SELECT r.*,
              d.full_name AS driver_name, d.phone AS driver_phone,
              d.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
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
        LIMIT 1`, [user.id]).catch(() => null);
        // The rider must see the ACTUAL car. If an approved photo exists for this
        // driver's make|model|generation|colour we hand the app OUR OWN stored URL
        // (GET /api/vehicle-images/…), never a third-party link. Cached for 5 minutes
        // because this endpoint is polled every second, and a failure here can never
        // break the active-state response — the app just keeps its SVG.
        let ridePayload = ride ? mapRide(ride) : null;
        if (ridePayload && (ride.vehicle_make || ride.vehicle_model)) {
            try {
                const { resolveVehicleImageCached } = await Promise.resolve().then(() => __importStar(require("../services/vehicleImages")));
                const img = await resolveVehicleImageCached({
                    make: ride.vehicle_make,
                    model: ride.vehicle_model,
                    year: ride.vehicle_year,
                    colour: ride.vehicle_color,
                });
                if (img.url)
                    ridePayload.vehicle_image_url = img.url;
            }
            catch {
                /* no approved photo yet — the app draws the body-type SVG */
            }
        }
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
    }
    catch (err) {
        console.error("Active state error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/rides/:id/accept — REST twin of the `driver:ride:accept` socket event.
// Idempotent + atomic (see services/dispatch.ts acceptRide): safe to retry, and two
// drivers accepting at the same moment can never both win.
router.post("/:id/accept", auth_1.requireAuth, async (req, res) => {
    try {
        const io = global.__vuraIo;
        if (!io) {
            res.status(503).json({ ok: false, error: "Dispatch is starting up, please retry" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(403).json({ ok: false, error: "Driver account not synced" });
            return;
        }
        const result = await (0, dispatch_1.acceptRide)(io, { rideId: String(req.params.id), driverId: user.id });
        if (!result.ok) {
            res.status(409).json({ ok: false, error: result.error || "Ride no longer available" });
            return;
        }
        res.json({ ok: true, rideId: result.rideId, version: result.version, duplicate: result.duplicate === true });
    }
    catch (err) {
        console.error("REST accept error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});
// POST /api/rides/:id/decline — REST twin of `driver:ride:decline`.
router.post("/:id/decline", auth_1.requireAuth, async (req, res) => {
    try {
        const io = global.__vuraIo;
        if (!io) {
            res.status(503).json({ ok: false, error: "Dispatch is starting up, please retry" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(403).json({ ok: false, error: "Driver account not synced" });
            return;
        }
        const result = await (0, dispatch_1.declineOffer)(io, {
            rideId: String(req.params.id),
            driverId: user.id,
            reason: req.body?.reason || "declined",
        });
        res.json({ ok: true, duplicate: result.duplicate === true });
    }
    catch (err) {
        console.error("REST decline error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});
// Helper: map DB ride row to app-friendly format
function mapRide(row) {
    if (!row)
        return null;
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
        // Rider stops captured at booking time (pickup → stops… → drop-off). Sent
        // under both names so either app's normaliser finds them.
        waypoints: Array.isArray(row.waypoints) ? row.waypoints : null,
        stops: Array.isArray(row.waypoints) ? row.waypoints : null,
    };
}
// A ride is only "active" if it was created recently. If the app/server crashed
// mid-ride (or a demo/test ride was never finished), a stuck "driver_arrived"
// or "in_progress" row would otherwise be returned FOREVER and every login would
// show "Trip in progress" → "Back to ride". We treat anything older than this as
// dead so a fresh login never resurrects an ancient ride.
const ACTIVE_RIDE_MAX_AGE_MINUTES = 240; // 4 hours
// GET /api/rides/me/active — Get current user's active ride
router.get("/me/active", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id, role FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ ride: null });
            return;
        }
        // A single account may be BOTH a rider AND a driver (both apps can share one
        // login). We must NOT pick the column from role — otherwise a dual-role rider
        // never finds their passenger rides here and stays stuck on "Finding your
        // driver" even after a driver accepts. Look for the latest active ride where
        // this user is passenger OR driver.
        const ride = await (0, database_1.queryOne)(`SELECT r.*,
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
       WHERE (r.passenger_id = $1 OR r.driver_id = $1)
         AND r.status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
         AND r.created_at > NOW() - INTERVAL '${ACTIVE_RIDE_MAX_AGE_MINUTES} minutes'
       ORDER BY r.created_at DESC LIMIT 1`, [user.id, user.id]);
        res.json({ ride: mapRide(ride) });
    }
    catch (err) {
        console.error("Active ride error:", err);
        res.status(500).json({ error: err.message });
    }
});
// Periodically clean up rides stuck in "active" states past their freshness
// window so they can never show up as "Trip in progress" / be accepted again.
async function cleanupStaleRides() {
    try {
        const res = await (0, database_1.execute)(`UPDATE rides
         SET status = 'expired', updated_at = NOW()
       WHERE status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
         AND created_at < NOW() - INTERVAL '${ACTIVE_RIDE_MAX_AGE_MINUTES} minutes'`);
        return res?.rowCount ?? 0;
    }
    catch (err) {
        console.error("cleanupStaleRides error:", err.message);
        return 0;
    }
}
// GET /api/rides/history — Get ride history with pagination
router.get("/history", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ rides: [], pagination: { page, limit, total: 0, pages: 0 } });
            return;
        }
        const countResult = await (0, database_1.queryOne)("SELECT COUNT(*)::int AS total FROM rides WHERE passenger_id = $1 OR driver_id = $1", [user.id]);
        const total = countResult?.total || 0;
        const rows = await (0, database_1.query)(`SELECT r.*,
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
       LIMIT $2 OFFSET $3`, [user.id, limit, offset]);
        res.json({
            rides: rows.map(mapRide),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    }
    catch (err) {
        console.error("Ride history error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/rides/available — Rides still searching for a driver (driver-side poll)
router.get("/available", auth_1.requireAuth, async (_req, res) => {
    try {
        // Newest first so a fresh booking is NEVER hidden behind old stale
        // "searching" rides that nobody accepted. Only show rides younger than
        // 30 minutes so abandoned/stuck requests drop out automatically.
        // Also surfaces upcoming SCHEDULED rides so drivers can accept them
        // BEFORE the pickup time (driver pre-accept). Drivers see them with a
        // "Scheduled" badge and can claim them early — driver:ride:accept
        // accepts status 'scheduled' (see socket handlers).
        const rows = await (0, database_1.query)(`SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              CASE WHEN r.status = 'scheduled' THEN TRUE ELSE FALSE END AS is_scheduled
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
       WHERE (r.status = 'searching' AND r.created_at > NOW() - INTERVAL '30 minutes')
          OR (r.status = 'scheduled' AND r.scheduled_at > NOW())
       ORDER BY CASE WHEN r.status = 'scheduled' THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 20`);
        res.json({ rides: (rows || []).map((row) => mapRide(row)) });
    }
    catch (err) {
        console.error("Available rides error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/rides/scheduled — Get upcoming scheduled rides
router.get("/scheduled", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ rides: [] });
            return;
        }
        // Return rides that are still upcoming OR already in the live pipeline
        // (searching / accepted / driver_arrived / in_progress) so the ride never
        // "disappears" from the rider's side once the pickup time comes. Include
        // driver name + phone + car details so the rider sees WHO is coming.
        const rides = await (0, database_1.query)(`SELECT r.*,
              d.full_name AS driver_name, d.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate
       FROM rides r
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       WHERE r.passenger_id = $1
         AND r.status IN ('scheduled','searching','accepted','driver_arrived','in_progress')
       ORDER BY r.scheduled_at ASC`, [user.id]);
        res.json({ rides: rides.map(mapRide) });
    }
    catch (err) {
        console.error("Scheduled rides error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/rides/:id — Get specific ride details
router.get("/:id", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const ride = await (0, database_1.queryOne)(`SELECT r.*,
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
       WHERE r.id = $1`, [req.params.id]);
        if (!ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        res.json({ ride: mapRide(ride) });
    }
    catch (err) {
        console.error("Ride detail error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/rides/:id/receipt — Get ride receipt
router.get("/:id/receipt", auth_1.requireAuth, async (req, res) => {
    try {
        const ride = await (0, database_1.queryOne)(`SELECT r.id, r.id AS ride_id, r.pickup_address, r.destination_address,
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
       WHERE r.id = $1`, [req.params.id]);
        if (!ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        res.json({ receipt: ride });
    }
    catch (err) {
        console.error("Receipt error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/rides/schedule — Schedule a future ride
router.post("/schedule", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduledAt, tier, estimatedFare, waypoints, stops } = req.body;
        // Stops for the reservation, normalised to { address, lat, lng } — same
        // shape and limits as the live booking path.
        const rideWaypoints = (Array.isArray(waypoints) ? waypoints : Array.isArray(stops) ? stops : [])
            .filter((w) => w && Number.isFinite(Number(w?.lat)) && Number.isFinite(Number(w?.lng)))
            .slice(0, 8)
            .map((w) => ({ address: String(w?.address ?? ""), lat: Number(w.lat), lng: Number(w.lng) }));
        const scheduled = new Date(scheduledAt);
        if (!scheduledAt || isNaN(scheduled.getTime())) {
            res.status(400).json({ error: "A valid scheduledAt date/time is required" });
            return;
        }
        if (scheduled.getTime() <= Date.now()) {
            res.status(400).json({ error: "Scheduled time must be in the future" });
            return;
        }
        // ── Reservation window (mirrors Uber Reserve) ──────────────────────────
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
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // The upfront price is stored at booking time and is locked for the
        // reservation (a reserved fare does not change later, like Uber Reserve).
        const lockedFare = estimatedFare != null && Number.isFinite(Number(estimatedFare)) && Number(estimatedFare) > 0
            ? Number(estimatedFare)
            : null;
        // Insert with the stops column when the database has it; if the column is
        // genuinely absent (older DB, no ALTER rights) 42703 = undefined_column and
        // we transparently retry without it, so reserving a ride never 500s.
        const insertScheduledRide = (withStops) => (0, database_1.queryOne)(withStops
            ? `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, scheduled_at, tier, estimated_fare, waypoints)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10, $11)
           RETURNING *`
            : `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, scheduled_at, tier, estimated_fare)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10)
           RETURNING *`, withStops
            ? [user.id, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduled.toISOString(), tier || "x", lockedFare, rideWaypoints.length ? JSON.stringify(rideWaypoints) : null]
            : [user.id, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduled.toISOString(), tier || "x", lockedFare]);
        let ride;
        try {
            ride = await insertScheduledRide(true);
        }
        catch (e) {
            if (e?.code === "42703")
                ride = await insertScheduledRide(false);
            else
                throw e;
        }
        res.status(201).json({ ride: mapRide(ride) });
    }
    catch (err) {
        console.error("Schedule ride error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/rides/scheduled/:id/cancel — Cancel a scheduled ride
// Also accepts rides already in the live pipeline (searching/accepted/…) so the
// rider can truly cancel a ride they no longer want — not just pre-booked ones.
// The status filter intentionally mirrors the "scheduled section" statuses.
router.post("/scheduled/:id/cancel", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Share the same cancellation-fee policy as the socket path: no fee while
        // searching/scheduled, flat R15 once a driver was matched (after grace).
        const before = await (0, database_1.queryOne)("SELECT status, accepted_at FROM rides WHERE id = $1 LIMIT 1", [req.params.id]).catch(() => null);
        const FEE_FLAT_RANDS = 15.0;
        const FEE_GRACE_MINUTES = 2;
        let fee = 0.0;
        if (before?.status === "accepted" || before?.status === "driver_arrived") {
            let elapsedMin = 0;
            if (before.accepted_at) {
                elapsedMin = (Date.now() - new Date(before.accepted_at).getTime()) / 60000;
            }
            if (elapsedMin > FEE_GRACE_MINUTES)
                fee = FEE_FLAT_RANDS;
        }
        const result = await (0, database_1.execute)(`UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = 'Ride cancelled by user', cancelled_at = NOW(), cancellation_fee = $2
       WHERE id = $3 AND passenger_id = $4
         AND status IN ('scheduled','searching','accepted','driver_arrived','in_progress')`, [user.id, fee, req.params.id, user.id]);
        if (!result.rowCount) {
            res.status(404).json({ error: "Ride not found or no longer active" });
            return;
        }
        (0, rideSim_1.stopServerRideSim)(String(req.params.id));
        // Tell the rider + driver + any online driver instantly so the ride
        // disappears everywhere (same broadcast the socket cancel does).
        const io = global.__vuraIo;
        io?.to(`ride:${req.params.id}`).emit("ride:cancelled", { reason: "Ride cancelled by user", cancellation_fee: fee });
        io?.to("drivers").emit("ride:cancelled", { rideId: req.params.id, reason: "Ride cancelled by user" });
        res.json({ success: true, cancellation_fee: fee });
    }
    catch (err) {
        console.error("Cancel scheduled ride error:", err);
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/rides/:id/pickup — Update the pickup location of an active ride
router.patch("/:id/pickup", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const { id } = req.params;
        const { address, lat, lng } = req.body;
        if (!address || lat == null || lng == null) {
            res.status(400).json({ error: "address, lat and lng are required" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const ride = await (0, database_1.queryOne)("SELECT id, status FROM rides WHERE id = $1 AND passenger_id = $2", [id, user.id]);
        if (!ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        if (!["searching", "accepted", "driver_arrived", "in_progress"].includes(ride.status)) {
            res.status(400).json({ error: "Pickup can no longer be updated on this ride" });
            return;
        }
        const updated = await (0, database_1.queryOne)(`UPDATE rides
       SET pickup_address = $1, pickup_lat = $2, pickup_lng = $3, updated_at = NOW()
       WHERE id = $4 AND passenger_id = $5
       RETURNING *`, [address, lat, lng, id, user.id]);
        res.json({ success: true, ride: mapRide(updated) });
    }
    catch (err) {
        console.error("Update pickup error:", err);
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/rides/:id/status — Update ride status for simulation
router.patch("/:id/status", auth_1.requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const updates = ["status = $1", "updated_at = NOW()"];
        const params = [status, id];
        if (status === "completed") {
            updates.push("completed_at = NOW()");
            // Never let a completed ride fall to R0. If the fare is 0/missing use
            // the estimated fare; if that is also missing, default to the app's
            // minimum demo fare (R0.20).
            updates.push("actual_fare = GREATEST(COALESCE(NULLIF(estimated_fare, 0), 0.20), COALESCE(actual_fare, 0))");
        }
        await (0, database_1.execute)(`UPDATE rides SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
        if (status === "completed") {
            await (0, AffiliateService_1.settleFirstRide)(String(id));
        }
        res.json({ success: true });
    }
    catch (err) {
        console.error("Update status error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/rides/:id/route — The DRIVER saves the authoritative route line it
// is following. The server stores it on the ride so the RIDER can draw the
// EXACT same route (single source of truth — no more route mismatch between
// driver and rider apps).
router.post("/:id/route", auth_1.requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const route = req.body?.route;
        if (!Array.isArray(route) || route.length < 2) {
            res.status(400).json({ error: "route must be an array of {latitude,longitude}" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(401).json({ error: "User not synced" });
            return;
        }
        const ride = await (0, database_1.queryOne)(`UPDATE rides SET route_data = $1::jsonb, updated_at = NOW()
       WHERE id = $2 AND driver_id = $3
       RETURNING id`, [JSON.stringify(route), id, user.id]);
        if (!ride) {
            res.status(404).json({ error: "Ride not found or not your ride" });
            return;
        }
        // Start (or restart) the server-side car sim so the rider keeps seeing the
        // driver's car move even when the driver's app is closed/backgrounded.
        (0, rideSim_1.startServerRideSim)(String(id), route);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Save route error:", err);
        res.status(500).json({ error: err.message });
    }
});
// Ensure columns added after the original schema exist (idempotent migrations).
async function ensureRouteColumn() {
    await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_data JSONB`).catch(() => { });
    // Rider stops captured at booking time (pickup → waypoints… → drop-off).
    await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB`).catch(() => { });
}
ensureRouteColumn();
exports.default = router;
//# sourceMappingURL=rides.js.map