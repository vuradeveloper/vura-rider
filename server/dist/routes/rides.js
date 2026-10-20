"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupStaleRides = cleanupStaleRides;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const AffiliateService_1 = require("../services/AffiliateService");
const rideSim_1 = require("../services/rideSim");
const dispatch_1 = require("../services/dispatch");
const vehicleImages_1 = require("../services/vehicleImages");
const driverPhoto_1 = require("../services/driverPhoto");
const trace_1 = require("../services/trace");
const adminRiders_1 = require("../services/adminRiders");
const rideCategories_1 = require("../services/rideCategories");
const preauthorization_1 = require("../services/preauthorization");
const PayLaterService_1 = require("../services/PayLaterService");
const promos_1 = require("../services/promos");
const router = (0, express_1.Router)();
// GET /api/rides/me/active-state â€” ONE call that rebuilds the app's world.
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
        LIMIT 1`, [user.id]).catch(() => null);
        // The rider's photo next to the car: users.profile_photo_url, else the
        // driver's newest profile_photo/face_scan document (presigned + cached —
        // this endpoint is polled every 3s and must never hit S3 per call).
        if (ride)
            ride.driver_photo_url = await (0, driverPhoto_1.resolveDriverPhotoUrl)(ride.driver_id, ride.driver_photo_url);
        // The rider must see the ACTUAL car. attachVehicleImages resolves the approved
        // photo for this driver's make|model|generation and hands the app OUR OWN
        // stored URL (GET /api/vehicle-images/â€¦), never a third-party link. The lookup
        // is cached for 5 minutes because this endpoint is polled every second, and a
        // failure here can never break the active-state response â€” the app just keeps
        // its SVG.
        await (0, vehicleImages_1.attachVehicleImages)(ride);
        const ridePayload = ride ? mapRide(ride) : null;
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
// POST /api/rides/:id/accept â€” REST twin of the `driver:ride:accept` socket event.
// Idempotent + atomic (see services/dispatch.ts acceptRide): safe to retry, and two
// drivers accepting at the same moment can never both win.
router.post("/request", auth_1.requireAuth, async (req, res) => {
    // WHY THIS EXISTS
    //
    // Until now a ride could ONLY be created by emitting the `passenger:ride:request`
    // socket event. If the rider's socket was down, reconnecting, or mid-token-
    // refresh at the moment they tapped Book, no ride was created at all -- or one
    // was created but nothing dispatched it, and it only got picked up whenever
    // reviveWaitingRides happened to run. Dispatch must not depend on a long-lived
    // connection: the request should not care whether the caller can hold a socket.
    //
    // THE ORDERING, which is the entire point:
    //   1. INSERT the ride                  (the only thing we wait for)
    //   2. respond 201 with id + SEARCHING  (rider shows "Finding your driver...")
    //   3. THEN start dispatch, un-awaited
    //
    // Dispatch runs AFTER the response is written, so ranking, socket delivery and
    // push can never add latency to the booking. Deliberately not awaited, and it
    // never rejects into an unhandled rejection.
    //
    // NOTE: no Paystack pre-authorisation on this path. The socket path awaits a live
    // network call to Paystack BEFORE inserting the ride, which can add hundreds of
    // ms to every card booking. Charging is settled outside this call.
    const t0 = Date.now();
    try {
        const rider = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!rider) {
            res.status(403).json({ error: "Account not synced yet. Try again in a moment." });
            return;
        }
        // Rider-gate (Phase 2): suspend/ban enforcement — no-op unless app_config
        // key `rider_gate` is enabled (seed OFF), so behaviour is unchanged by
        // default. Both booking paths (REST here, socket at passenger:ride:request)
        // run this one check.
        try {
            await (0, adminRiders_1.assertRiderCanBook)(rider.id);
        }
        catch (gateErr) {
            res.status(gateErr.status || 403).json({ error: gateErr.message || "Account not allowed" });
            return;
        }
        const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, paymentMethod, fare, deviceId, waypoints, stops, tier, } = req.body || {};
        // THE TIER THE RIDER PICKED (go / comfort / xl / black). Dispatch matches
        // it against the car's CarScan eligible categories, so it must reach the
        // DB on the same row as the ride. Unknown values normalise to 'go'.
        const rideTier = (0, rideCategories_1.canonicalTier)(tier);
        // Ride Now, Pay Later: the REST booking path runs the SAME guard as the
        // socket path (active account → terms accepted → not past due → fare fits
        // available credit). payment_method is CLIENT INPUT and can never be
        // trusted: without this check anyone could book pay-later rides and, since
        // the ledger debit requires an active account at completion, ride free.
        if (String(paymentMethod || "").toLowerCase() === "pay_later") {
            try {
                await (0, PayLaterService_1.takePayLaterRide)(rider.id, Number(fare) || 0);
            }
            catch (plErr) {
                res
                    .status(402)
                    .json({ error: plErr.message || "Ride Now, Pay Later is not available for this ride." });
                return;
            }
        }
        // Coordinates are mandatory: without them dispatch cannot match
        // (offerToNextDriver returns ride_has_no_pickup_coords) and the rider would sit
        // on "Finding your driver..." forever. Fail loudly now rather than accepting a
        // ride we already know we cannot dispatch.
        if (!Number.isFinite(Number(pickupLat)) || !Number.isFinite(Number(pickupLng))) {
            res.status(400).json({ error: "Pickup coordinates are required" });
            return;
        }
        const rideWaypoints = (Array.isArray(waypoints) ? waypoints : Array.isArray(stops) ? stops : [])
            .filter((w) => w && Number.isFinite(Number(w?.lat)) && Number.isFinite(Number(w?.lng)))
            .slice(0, 8)
            .map((w) => ({ address: String(w?.address ?? ""), lat: Number(w.lat), lng: Number(w.lng) }));
        // One rider, one live ride. A double-tap or a client retry must not create two
        // rides that two drivers could each accept.
        const existing = await (0, database_1.queryOne)(`SELECT id, status FROM rides
        WHERE passenger_id = $1
          AND status IN ('searching','scheduled','accepted','driver_arrived','in_progress')
        ORDER BY created_at DESC LIMIT 1`, [rider.id]).catch(() => null);
        if (existing?.id) {
            // Reuse it, but still make sure dispatch is running for it.
            res.status(200).json({
                rideId: existing.id,
                status: existing.status,
                reused: true,
                ms: Date.now() - t0,
            });
            const ioReuse = global.__vuraIo;
            if (ioReuse && ["searching", "scheduled"].includes(existing.status)) {
                res.on("finish", () => void (0, dispatch_1.startDispatch)(ioReuse, existing.id).catch(() => undefined));
            }
            return;
        }
        // ── Promo (rider side): same server-authoritative rule as the socket path.
        // The client may only NAME the promo it displayed; window, audience,
        // per-user targeting and the N-days/N-rides redemption budget are re-checked
        // here and the discount recomputed from scratch. (The REST path used to
        // ignore promos entirely — the app books over REST, so nothing ever
        // discounted.) A promo failure must NEVER block booking.
        let rideFare = fare != null ? Number(fare) : null;
        let appliedPromo = null;
        let promoForRecord = null;
        if (rideFare != null && (req.body?.promoId || req.body?.promoCode)) {
            try {
                const promo = await (0, promos_1.ridePromoFor)("rider", String(req.body.promoId || req.body.promoCode), rider.id);
                if (promo && (await (0, promos_1.promoUsableFor)(promo, rider.id))) {
                    const applied = (0, promos_1.applyPromoToFare)(rideFare, promo);
                    rideFare = applied.fare;
                    appliedPromo = { id: promo.id, code: promo.code, discount: applied.discount };
                    promoForRecord = promo;
                }
            }
            catch {
                /* promo lookup never blocks booking */
            }
        }
        // ── Invite credit ("Invite & earn" R5): the rider CHOOSES at booking to
        // spend their referral balance on this trip. The client only flips the
        // switch — the amount is min(balance, remaining fare), server-side.
        let inviteCredit = 0;
        if (rideFare != null && rideFare > 0 && req.body?.useAffiliateCredit === true) {
            inviteCredit = await (0, AffiliateService_1.inviteCreditAvailable)(rider.id, rideFare).catch(() => 0);
            if (inviteCredit > 0)
                rideFare = Math.max(0, rideFare - inviteCredit);
        }
        // The tier column ships with migration 013; a database that has not run it
        // yet must still book — exactly the waypointsReady pattern (booking can
        // NEVER break because of a newer column).
        const tierReady = await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'go'`)
            .then(() => true)
            .catch(() => false);
        const ride = await (0, database_1.queryOne)(tierReady
            ? `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng,
                              destination_address, destination_lat, destination_lng,
                              status, estimated_fare, payment_method, device_id, waypoints, tier)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'searching',$8,$9,$10,$11,$12)
           RETURNING id, status`
            : `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng,
                              destination_address, destination_lat, destination_lng,
                              status, estimated_fare, payment_method, device_id, waypoints)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'searching',$8,$9,$10,$11)
           RETURNING id, status`, [
            rider.id,
            pickupAddress ?? null,
            Number(pickupLat), Number(pickupLng),
            destinationAddress ?? null,
            Number.isFinite(Number(destinationLat)) ? Number(destinationLat) : null,
            Number.isFinite(Number(destinationLng)) ? Number(destinationLng) : null,
            rideFare,
            paymentMethod || null,
            deviceId || null,
            rideWaypoints.length ? JSON.stringify(rideWaypoints) : null,
            ...(tierReady ? [rideTier] : []),
        ]);
        if (!ride?.id) {
            res.status(500).json({ error: "Could not create the ride" });
            return;
        }
        // Stamp what was applied (receipts/audits/support — same copy the socket
        // path stores) and burn one redemption on the rider's promo budget.
        if (appliedPromo) {
            await (0, database_1.execute)(`UPDATE rides SET promo_id = $2, promo_code = $3, promo_discount = $4 WHERE id = $1`, [ride.id, appliedPromo.id, appliedPromo.code, appliedPromo.discount]).catch(() => { });
            if (promoForRecord)
                void (0, promos_1.recordPromoUse)(promoForRecord, rider.id).catch(() => { });
        }
        // Spend the invite credit the booking chose: debit + record atomically
        // (once per ride, balance can never go negative). If the debit cannot
        // land, the fare goes back up — nothing is free without the money moving.
        if (inviteCredit > 0 && ride?.id) {
            await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS affiliate_credit NUMERIC(12,2) NOT NULL DEFAULT 0`).catch(() => { });
            const spent = await (0, AffiliateService_1.spendInviteCredit)(rider.id, ride.id, inviteCredit).catch(() => false);
            if (spent) {
                await (0, database_1.execute)(`UPDATE rides SET affiliate_credit = $2 WHERE id = $1`, [ride.id, inviteCredit]).catch(() => { });
            }
            else {
                await (0, database_1.execute)(`UPDATE rides SET estimated_fare = COALESCE(estimated_fare, 0) + $2 WHERE id = $1`, [ride.id, inviteCredit]).catch(() => { });
                inviteCredit = 0;
            }
        }
        // Start the trace here so trip_saved / dispatch_started / drivers_found /
        // offer_sent all share one trace_id for this ride.
        (0, trace_1.startTrace)(ride.id);
        (0, trace_1.trace)(ride.id, "request_received", {
            source: "rest",
            ms_from_start: 0,
            at: new Date(t0).toISOString(),
        });
        (0, trace_1.trace)(ride.id, "trip_saved", {
            source: "rest",
            payment_method: paymentMethod || "cash",
        });
        await (0, dispatch_1.logRideEvent)(ride.id, null, "ride_requested", { source: "rest" }).catch(() => undefined);
        const io = global.__vuraIo;
        // 201 + SEARCHING. The rider can render "Finding your driver..." and this
        // response waits on no matching work at all.
        res.status(201).json({
            rideId: ride.id,
            status: "searching",
            ms: Date.now() - t0,
            dispatching: Boolean(io),
            appliedInviteCredit: inviteCredit,
        });
        // Dispatch AFTER the response is flushed. `io` can be undefined during a
        // deploy restart; the offerWorker still picks the ride up on its next tick via
        // reviveWaitingRides, so a ride is never lost.
        if (io) {
            res.on("finish", () => {
                void (0, dispatch_1.startDispatch)(io, ride.id).catch((err) => {
                    console.error(`[rides] startDispatch FAILED ride=${ride.id}:`, err?.message || err);
                });
            });
        }
    }
    catch (err) {
        console.error("POST /api/rides/request error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message || "Could not create the ride" });
        }
    }
});
// POST /api/rides/:id/accept
// REST twin of the `driver:ride:accept` socket event.
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
// POST /api/rides/:id/decline â€” REST twin of `driver:ride:decline`.
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
router.get("/me/active", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id, role FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ ride: null });
            return;
        }
        // A single account may be BOTH a rider AND a driver (both apps can share one
        // login). We must NOT pick the column from role â€” otherwise a dual-role rider
        // never finds their passenger rides here and stays stuck on "Finding your
        // driver" even after a driver accepts. Look for the latest active ride where
        // this user is passenger OR driver.
        const ride = await (0, database_1.queryOne)(`SELECT r.*,
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
       ORDER BY r.created_at DESC LIMIT 1`, [user.id, user.id]);
        // Same single source of truth as /me/active-state: the rider's live trip card
        // is fed by THIS endpoint, so the approved photo must be attached here too.
        if (ride)
            ride.driver_photo_url = await (0, driverPhoto_1.resolveDriverPhotoUrl)(ride.driver_id, ride.driver_photo_url);
        await (0, vehicleImages_1.attachVehicleImages)(ride);
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
        const res = await (0, database_1.query)(`UPDATE rides
         SET status = 'expired', updated_at = NOW()
       WHERE status IN ('searching', 'accepted', 'driver_arrived', 'in_progress')
         AND created_at < NOW() - INTERVAL '${ACTIVE_RIDE_MAX_AGE_MINUTES} minutes'
       RETURNING id`);
        // Card preauthorization: an expired ride must never keep money held.
        for (const row of res || []) {
            (0, preauthorization_1.releaseRideHold)(row.id, "ride_expired").catch((e) => console.warn(`[preauth] release on expired ride ${row.id} failed:`, e?.message || e));
        }
        return res?.length ?? 0;
    }
    catch (err) {
        console.error("cleanupStaleRides error:", err.message);
        return 0;
    }
}
// GET /api/rides/history â€” Get ride history with pagination
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
       LIMIT $2 OFFSET $3`, [user.id, limit, offset]);
        await (0, vehicleImages_1.attachVehicleImages)(rows);
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
// GET /api/rides/available â€” Rides still searching for a driver (driver-side poll)
router.get("/available", auth_1.requireAuth, async (_req, res) => {
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
        const me = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [_req.userId]);
        const dp = me
            ? await (0, database_1.queryOne)("SELECT current_lat, current_lng FROM driver_profiles WHERE user_id = $1", [me.id]).catch(() => null)
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
        const rows = await (0, database_1.query)(`SELECT r.*,
              u.full_name AS passenger_name, u.phone AS passenger_phone,
              CASE WHEN r.status = 'scheduled' THEN TRUE ELSE FALSE END AS is_scheduled,
              -- Distance is only meaningful when we actually know where the
              -- asking driver is. Without a fix it would be measured from
              -- (0,0) in the Gulf of Guinea and could reorder a no-GPS
              -- driver's list nonsensically, so it is left NULL and ordering
              -- falls back to newest-first -- exactly the old behaviour.
              -- ALIAS pickup_distance_km, NOT distance_km: the rides table has
              -- a REAL distance_km column (bootstrap schema), and r.*
              -- expands it — a second output column with the same name made
              -- the bare ORDER BY distance_km AMBIGUOUS (Postgres 42702)
              -- and 500'd this endpoint on every driver poll. The computed
              -- value is copied back onto distance_km in the response below,
              -- so the app contract (r.distance_km) is unchanged.
              CASE WHEN $3::boolean AND r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL
                THEN (6371 * acos(LEAST(1, GREATEST(-1,
                  cos(radians($2)) * cos(radians(r.pickup_lat)) *
                    cos(radians(r.pickup_lng) - radians($1)) +
                  sin(radians($2)) * sin(radians(r.pickup_lat))
                ))))
              END AS pickup_distance_km
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
                 pickup_distance_km ASC NULLS LAST,
                 r.created_at DESC
        LIMIT 20`, [
            hasCoords ? Number(dp.current_lng) : 0,
            hasCoords ? Number(dp.current_lat) : 0,
            hasCoords,
            radiusKm,
        ]);
        res.json({
            // The app reads distance_km (nearest-ride card, offer sheet): publish
            // the COMPUTED pickup distance under the historical name, falling back
            // to the stored fare distance only when this run measured nothing.
            rides: (rows || []).map((row) => mapRide({ ...row, distance_km: row.pickup_distance_km ?? row.distance_km })),
            // Lets the app and debug distinguish "nothing near you" from "you have no
            // GPS fix, so this list is unfiltered".
            scoped: hasCoords,
            radius_km: hasCoords ? radiusKm : null,
        });
    }
    catch (err) {
        // The driver app polls this every 2s — a failure here is the driver's
        // whole offer feed going dark, so it must be LOUD in the logs (RC4 prod:
        // 42702 ambiguity 500'd every poll for ~every online driver).
        console.error(`[rides] GET /api/rides/available FAILED (driver=${_req.userId ?? "unknown"}):`, err?.code ? `${err.code} ${err.message}` : err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/rides/scheduled â€” Get upcoming scheduled rides
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
              d.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, NULL::text AS vehicle_image_url, dp.license_plate
       FROM rides r
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       WHERE r.passenger_id = $1
         AND r.status IN ('scheduled','searching','accepted','driver_arrived','in_progress')
       ORDER BY r.scheduled_at ASC`, [user.id]);
        await (0, vehicleImages_1.attachVehicleImages)(rides);
        res.json({ rides: rides.map(mapRide) });
    }
    catch (err) {
        console.error("Scheduled rides error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/rides/:id â€” Get specific ride details
router.get("/:id", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const ride = await (0, database_1.queryOne)(`SELECT r.*,
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
       WHERE r.id = $1`, [req.params.id]);
        if (!ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        await (0, vehicleImages_1.attachVehicleImages)(ride);
        res.json({ ride: mapRide(ride) });
    }
    catch (err) {
        console.error("Ride detail error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/rides/:id/receipt â€” Get ride receipt
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
        // Invite credit line (019) — read separately so a pre-019 database still
        // answers with the receipt instead of 500ing.
        ride.affiliate_credit = await (0, database_1.queryOne)("SELECT affiliate_credit FROM rides WHERE id = $1", [req.params.id])
            .then((r) => Number(r?.affiliate_credit ?? 0))
            .catch(() => 0);
        res.json({ receipt: ride });
    }
    catch (err) {
        console.error("Receipt error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/rides/schedule â€” Schedule a future ride
router.post("/schedule", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, scheduledAt, tier, estimatedFare, waypoints, stops } = req.body;
        // Stops for the reservation, normalised to { address, lat, lng } â€” same
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
// POST /api/rides/scheduled/:id/cancel â€” Cancel a scheduled ride
// Also accepts rides already in the live pipeline (searching/accepted/â€¦) so the
// rider can truly cancel a ride they no longer want â€” not just pre-booked ones.
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
        // REAL-TIME (2026-10-15): withdraw any offer still sitting on a driver's
        // phone — expire the rows AND emit ride:offer:cancelled to each offered
        // driver's room, the same event the socket cancel sends. Without this a
        // driver could still see/accept the ride for up to 15s after the cancel.
        await (0, dispatch_1.cancelPendingOffers)(io, String(req.params.id), "rider_cancelled");
        io?.to(`ride:${req.params.id}`).emit("ride:cancelled", { reason: "Ride cancelled by user", cancellation_fee: fee });
        io?.to("drivers").emit("ride:cancelled", { rideId: req.params.id, reason: "Ride cancelled by user" });
        // Card preauthorization: cancelling frees the rider's hold immediately
        // (idempotent — no hold / already released answers honestly).
        let paymentStatus = "NONE";
        let released = false;
        try {
            const rel = await (0, preauthorization_1.releaseRideHold)(String(req.params.id), "scheduled_cancel");
            paymentStatus = rel.paymentStatus;
            released = rel.released;
        }
        catch (e) {
            console.error("Scheduled-cancel hold release failed:", e);
        }
        res.json({ success: true, cancellation_fee: fee, paymentStatus, released });
    }
    catch (err) {
        console.error("Cancel scheduled ride error:", err);
        res.status(500).json({ error: err.message });
    }
});
// PATCH /api/rides/:id/pickup â€” Update the pickup location of an active ride
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
// PATCH /api/rides/:id/status â€” Update ride status for simulation
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
            // Card preauthorization: the ride completing captures the hold for the
            // final fare (no-op when there is no hold; PAID still arrives only via
            // the capture.success webhook).
            (0, preauthorization_1.captureRideHold)(String(id)).catch((e) => {
                if (e?.code !== "no_hold") {
                    console.warn(`[preauth] auto-capture on completion ride=${id}:`, e?.message || e);
                }
            });
            // Ride Now, Pay Later (same hook as the socket completion path):
            // books the ledger debit for pay-later rides + ride-to-repay cycle.
            (0, PayLaterService_1.onRideCompletedPayLater)(String(id)).catch((e) => console.warn(`[paylater] completion hook ride=${id}:`, e?.message || e));
            // REST completion must announce itself the way the socket path does —
            // the rider's trip screen (and its rating + tip sheet) keys off this event.
            const doneRow = await (0, database_1.queryOne)(`SELECT GREATEST(COALESCE(NULLIF(r.actual_fare, 0), r.estimated_fare, 0.20)) AS fare,
                u.firebase_uid AS passenger_fb
           FROM rides r LEFT JOIN users u ON u.id = r.passenger_id
          WHERE r.id = $1`, [id]).catch(() => null);
            const io = global.__vuraIo;
            io?.to(`ride:${id}`).emit("ride:completed", { riderTotal: Number(doneRow?.fare || 0) });
            if (doneRow?.passenger_fb) {
                io?.to(`user:${doneRow.passenger_fb}`).emit("ride:completed", {
                    riderTotal: Number(doneRow?.fare || 0),
                });
            }
        }
        res.json({ success: true });
    }
    catch (err) {
        console.error("Update status error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/rides/:id/route â€” The DRIVER saves the authoritative route line it
// is following. The server stores it on the ride so the RIDER can draw the
// EXACT same route (single source of truth â€” no more route mismatch between
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
// ── Card preauthorization (Paystack holds) ────────────────────────────────────
// Docs: https://paystack.com/docs/payments/card-preauthorization/
// State machine + Paystack calls live in services/preauthorization.ts; these
// routes are the HTTP surface the rider app drives:
//   POST /api/rides/book          → hold → authorization_url (or instant
//                                   HOLD_ACTIVE via Reserve-by-Code)
//   POST /api/rides/:id/complete  → capture final fare → CAPTURE_PENDING
//   POST /api/rides/:id/cancel    → release the hold → RELEASED
//   GET  /api/rides/:id/payment   → status for the return/status screen
/** Ride states a booking/hold may exist in. */
const LIVE_RIDE_STATES = [
    "scheduled",
    "searching",
    "no_drivers",
    "accepted",
    "driver_arrived",
    "in_progress",
];
/** Loads a ride only when the caller is its rider or its driver. */
async function loadRideForParty(rideId, firebaseUid) {
    const user = await (0, database_1.queryOne)("SELECT id, email FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user)
        return { user: null, ride: null, party: null };
    const ride = await (0, database_1.queryOne)(`SELECT id, passenger_id, driver_id, status, payment_method, accepted_at,
            payment_status, preauth_reference, hold_checkout_url,
            hold_expires_at, hold_amount_cents, captured_amount, paid_at,
            estimated_fare, actual_fare,
            COALESCE(NULLIF(actual_fare, 0), estimated_fare) AS fare
       FROM rides WHERE id = $1`, [rideId]).catch(() => null);
    const party = ride && ride.passenger_id === user.id
        ? "rider"
        : ride && ride.driver_id === user.id
            ? "driver"
            : null;
    return { user, ride, party };
}
function respondPreauthError(res, err) {
    if (err instanceof preauthorization_1.PreauthError) {
        res.status(err.httpStatus).json({ error: err.message, code: err.code });
        return true;
    }
    return false;
}
// POST /api/rides/book — place (or re-report) the card hold for a ride.
//
// Body: { rideId, riderEmail?, estimatedFare? } — the EMAIL and the ownership
// decision come from the authenticated account (a client-supplied email is only
// a fallback for accounts synced without one; Paystack's Reserve-by-Code
// requires email + authorization_code to match the first transaction).
// Amount: ZAR → cents, docs minimum 100 (services/preauthorization.ts).
router.post("/book", auth_1.requireAuth, async (req, res) => {
    try {
        await (0, preauthorization_1.ensurePreauthSchema)();
        const rideId = String(req.body?.rideId || "");
        if (!rideId) {
            res.status(400).json({ error: "rideId is required" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id, email FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(403).json({ error: "Account not synced yet. Try again in a moment." });
            return;
        }
        const ride = await (0, database_1.queryOne)(`SELECT id, passenger_id, status, payment_method, estimated_fare
         FROM rides WHERE id = $1`, [rideId]).catch(() => null);
        if (!ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        if (ride.passenger_id !== user.id) {
            res.status(403).json({ error: "This ride does not belong to you" });
            return;
        }
        if (!LIVE_RIDE_STATES.includes(String(ride.status))) {
            res.status(409).json({ error: `Ride is ${ride.status} — no hold can be placed.` });
            return;
        }
        // Only card rides get card holds — cash/pay-later rides answer honestly and
        // the client keeps going (payment must never gate dispatch).
        if (String(ride.payment_method || "") === "pay_later") {
            res.json({
                rideId,
                paymentStatus: "NONE",
                reference: null,
                authorizationUrl: null,
                skipped: "not_card",
            });
            return;
        }
        const email = String(user.email || "").trim() || String(req.body?.riderEmail || "").trim();
        if (!email) {
            res.status(400).json({ error: "Your account has no email — needed for Paystack." });
            return;
        }
        const estimated = req.body?.estimatedFare != null && Number(req.body.estimatedFare) > 0
            ? Number(req.body.estimatedFare)
            : Number(ride.estimated_fare || 0);
        const hold = await (0, preauthorization_1.createRideHold)({
            rideId,
            userId: user.id,
            amountRands: estimated,
            email,
        });
        res.json({
            rideId,
            reference: hold.reference,
            paymentStatus: hold.paymentStatus,
            authorizationUrl: hold.authorizationUrl ?? null,
            holdExpiresAt: hold.holdExpiresAt ?? null,
            alreadyHeld: Boolean(hold.alreadyHeld),
        });
    }
    catch (err) {
        if (respondPreauthError(res, err))
            return;
        console.error("POST /api/rides/book error:", err);
        res.status(500).json({ error: err?.message || "Could not start the card hold" });
    }
});
// POST /api/rides/:id/complete — capture the hold for the FINAL fare.
//
// Payment-only: the ride's own status is flipped by the driver's end-trip (or
// the sim PATCH below); this settles the money. Sets CAPTURE_PENDING and stops
// — PAID is ONLY ever set by the preauthorization.capture.success webhook, so
// an optimistic response can never claim money that later fails to settle.
// Allowed for the ride's rider or driver; idempotent while a capture is
// already pending/paid.
router.post("/:id/complete", auth_1.requireAuth, async (req, res) => {
    try {
        const { user, ride, party } = await loadRideForParty(String(req.params.id), req.userId);
        if (!user || !ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        if (!party) {
            res.status(403).json({ error: "This ride does not belong to you" });
            return;
        }
        const result = await (0, preauthorization_1.captureRideHold)(String(req.params.id));
        res.json({
            success: true,
            rideId: ride.id,
            paymentStatus: result.paymentStatus,
            captured: result.captured,
            alreadyProcessed: Boolean(result.alreadyProcessed),
            capturedAmount: result.capturedAmount ?? null,
            note: "PAID is confirmed by Paystack's capture.success webhook.",
        });
    }
    catch (err) {
        if (respondPreauthError(res, err))
            return;
        console.error("POST /api/rides/:id/complete error:", err);
        res.status(500).json({ error: err?.message || "Could not capture the fare" });
    }
});
// GET /api/rides/:id/payment — the return/status screen's single poll:
// payment state + ride state together (holding funds / driver searching /
// ride in progress / paid / released / failed).
router.get("/:id/payment", auth_1.requireAuth, async (req, res) => {
    try {
        await (0, preauthorization_1.ensurePreauthSchema)();
        const { user, ride, party } = await loadRideForParty(String(req.params.id), req.userId);
        if (!user || !ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        if (!party) {
            res.status(403).json({ error: "This ride does not belong to you" });
            return;
        }
        res.json({
            rideId: ride.id,
            rideStatus: ride.status,
            paymentStatus: (0, preauthorization_1.normalizePaymentStatus)(ride.payment_status),
            reference: ride.preauth_reference || null,
            authorizationUrl: ride.hold_checkout_url || null,
            holdExpiresAt: ride.hold_expires_at || null,
            holdAmountCents: ride.hold_amount_cents ?? null,
            capturedAmount: ride.captured_amount ?? null,
            paidAt: ride.paid_at || null,
        });
    }
    catch (err) {
        if (respondPreauthError(res, err))
            return;
        console.error("GET /api/rides/:id/payment error:", err);
        res.status(500).json({ error: err?.message || "Could not read the payment status" });
    }
});
// POST /api/rides/:id/cancel — cancel the ride AND release its card hold.
//
// The rider app's Cancel button calls THIS (REST) so the release is part of the
// same request/response: the UI can show "Your funds have been released" (or a
// precise error) without a second round-trip. Mirrors the fee policy and the
// broadcasts of /scheduled/:id/cancel; the socket path releases too (both fire
// releaseRideHold, which is idempotent).
router.post("/:id/cancel", auth_1.requireAuth, async (req, res) => {
    try {
        await (0, preauthorization_1.ensurePreauthSchema)();
        const rideId = String(req.params.id);
        const { user, ride, party } = await loadRideForParty(rideId, req.userId);
        if (!user || !ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        if (!party) {
            res.status(403).json({ error: "This ride does not belong to you" });
            return;
        }
        // Same cancellation-fee policy as the socket path: no fee while
        // searching/scheduled, flat R15 once a driver was matched (after grace).
        let fee = 0.0;
        if (ride.status === "accepted" || ride.status === "driver_arrived") {
            const acceptedAt = ride.accepted_at ? new Date(ride.accepted_at).getTime() : Date.now();
            if ((Date.now() - acceptedAt) / 60000 > 2)
                fee = 15.0;
        }
        const alreadyCancelled = String(ride.status) === "cancelled";
        const reason = String(req.body?.reason || "Ride cancelled by user").slice(0, 200);
        const result = await (0, database_1.execute)(`UPDATE rides
          SET status = 'cancelled', cancelled_by = $1, cancel_reason = $2,
              cancelled_at = NOW(), cancellation_fee = $3, updated_at = NOW()
        WHERE id = $4
          AND status IN ('scheduled','searching','no_drivers','accepted','driver_arrived','in_progress')`, [user.id, reason, fee, rideId]);
        const cancelled = (result?.rowCount ?? 0) > 0 || alreadyCancelled;
        if (!cancelled) {
            res.status(404).json({ error: "Ride not found or no longer active" });
            return;
        }
        (0, rideSim_1.stopServerRideSim)(rideId);
        // Withdraw live offers + tell both apps (same events as the socket cancel).
        const io = global.__vuraIo;
        await (0, dispatch_1.cancelPendingOffers)(io, rideId, "rider_cancelled");
        io?.to(`ride:${rideId}`).emit("ride:cancelled", {
            reason: "Ride cancelled by user",
            cancellation_fee: fee,
        });
        io?.to("drivers").emit("ride:cancelled", {
            rideId,
            reason: "Ride cancelled by user",
        });
        // ── Release the hold (the whole point of this endpoint) ──
        let paymentStatus = "NONE";
        let released = false;
        let releaseError = null;
        try {
            const rel = await (0, preauthorization_1.releaseRideHold)(rideId, "rest_cancel");
            paymentStatus = rel.paymentStatus;
            released = rel.released;
        }
        catch (e) {
            // The RIDE cancel must stand even if Paystack hiccups; the client is
            // told exactly what happened (funds NOT yet released) and the reaper /
            // expire_action=release remain the backstop.
            releaseError = e?.message || "Could not release the hold";
            paymentStatus = String((await (0, database_1.queryOne)(`SELECT payment_status FROM rides WHERE id = $1`, [rideId]).catch(() => null))?.payment_status || "HOLD_ACTIVE");
            console.error("Cancel hold release failed:", e);
        }
        res.json({
            success: true,
            cancellation_fee: fee,
            paymentStatus,
            released,
            message: released
                ? "Your funds have been released."
                : releaseError
                    ? "Ride cancelled, but releasing your funds failed — please retry or contact support."
                    : "Ride cancelled.",
            ...(releaseError ? { releaseError } : {}),
        });
    }
    catch (err) {
        if (respondPreauthError(res, err))
            return;
        console.error("POST /api/rides/:id/cancel error:", err);
        res.status(500).json({ error: err?.message || "Could not cancel the ride" });
    }
});
async function ensureRouteColumn() {
    await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_data JSONB`).catch(() => { });
    // Rider stops captured at booking time (pickup â†’ waypointsâ€¦ â†’ drop-off).
    await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB`).catch(() => { });
    // The tier the rider picked (013) — dispatch's ride-class filter reads it.
    await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'go'`).catch(() => { });
}
ensureRouteColumn();
exports.default = router;
//# sourceMappingURL=rides.js.map