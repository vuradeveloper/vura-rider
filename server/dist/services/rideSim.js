"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markDriverLivePing = markDriverLivePing;
exports.syncSimToDriver = syncSimToDriver;
exports.stopServerRideSim = stopServerRideSim;
exports.startServerRideSim = startServerRideSim;
const database_1 = require("../config/database");
const push_1 = require("./push");
const AffiliateService_1 = require("./AffiliateService");
const rideSims = new Map();
const rideLivePings = new Map();
const RIDE_SIM_STEP_MS = 900;
const RIDE_SIM_STEPS_PER_TICK = 6;
const LIVE_PING_TIMEOUT_MS = 3500; // driver app streams ~1/s; >3.5s means gone quiet
function getSimBearing(sLat, sLng, dLat, dLng) {
    const toRad = (v) => (v * Math.PI) / 180;
    const y = Math.sin(toRad(dLng - sLng)) * Math.cos(toRad(dLat));
    const x = Math.cos(toRad(sLat)) * Math.sin(toRad(dLat)) - Math.sin(toRad(sLat)) * Math.cos(toRad(dLat)) * Math.cos(toRad(dLng - sLng));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function getVuraIo() {
    return global.__vuraIo;
}
/** Straight-line distance in meters (fine for the pickup/destination thresholds below). */
function metersBetween(aLat, aLng, bLat, bLng) {
    const toRad = (v) => (v * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
async function pushToRider(rideId, title, body) {
    try {
        const rider = await (0, database_1.queryOne)("SELECT u.firebase_uid FROM rides r JOIN users u ON u.id = r.passenger_id WHERE r.id = $1", [rideId]).catch(() => null);
        if (rider?.firebase_uid) {
            await (0, push_1.sendPushToUser)(rider.firebase_uid, { title, body, data: { ride_id: rideId } }).catch(() => { });
        }
    }
    catch {
        /* never block the sim on a push */
    }
}
/**
 * The sim's published route ended. Decide what that MEANS depending on the ride phase:
 *   accepted      → car reached the pickup — notify the rider and park.
 *   in_progress   → car reached the destination — complete the ride (unless near pickup).
 * Returns true when the sim should stop.
 */
async function handleRouteEnd(rideId, status, lat, lng) {
    const io = getVuraIo();
    if (status === "accepted") {
        await (0, database_1.execute)("UPDATE rides SET status = 'driver_arrived' WHERE id = $1 AND status = 'accepted'", [rideId]).catch(() => { });
        io?.to(`ride:${rideId}`).emit("ride:driver:arrived");
        await pushToRider(rideId, "Driver arrived", "Your driver has arrived at the pickup point.");
        return true;
    }
    if (status === "in_progress") {
        // Safety: if the ride is in_progress but this route only covered the pickup leg,
        // the route-end is the PICKUP, not the destination — never complete the ride there.
        const pickup = await (0, database_1.queryOne)("SELECT pickup_lat, pickup_lng FROM rides WHERE id = $1", [rideId]).catch(() => null);
        if (pickup?.pickup_lat != null &&
            pickup?.pickup_lng != null &&
            metersBetween(lat, lng, Number(pickup.pickup_lat), Number(pickup.pickup_lng)) < 150) {
            return true; // still at the pickup — park, do NOT complete
        }
        const fareRow = await (0, database_1.queryOne)(`SELECT GREATEST(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0.20), COALESCE(actual_fare, 0)) AS fare
       FROM rides WHERE id = $1`, [rideId]).catch(() => null);
        const fare = Number(fareRow?.fare ?? 0);
        await (0, database_1.execute)("UPDATE rides SET status = 'completed', completed_at = NOW(), actual_fare = $1 WHERE id = $2 AND status = 'in_progress'", [fare, rideId]).catch(() => { });
        try {
            await (0, database_1.execute)(`INSERT INTO driver_earnings (driver_id, ride_id, gross_amount, fee, net_amount)
         SELECT r.driver_id, r.id, $1, 0, $1 FROM rides r WHERE r.id = $2`, [fare, rideId]).catch(() => { });
        }
        catch { /* earnings logging must never block completion */ }
        try {
            (0, AffiliateService_1.settleFirstRide)(rideId);
        }
        catch { /* affiliate settlement is best-effort */ }
        io?.to(`ride:${rideId}`).emit("ride:completed", { riderTotal: fare });
        await pushToRider(rideId, "Ride complete", "You've arrived at your destination. Thanks for riding with Vura!");
        return true;
    }
    // driver_arrived / other — nothing more to animate, just park.
    return true;
}
/** The driver app just reported a live position for this ride — sim should back off. */
function markDriverLivePing(rideId) {
    rideLivePings.set(rideId, Date.now());
}
/**
 * Snap the sim cursor to the driver's live position (nearest route vertex). Called
 * on every live ping so the sim resumes exactly where the driver left off when the
 * app goes quiet. No-op if the route isn't known or the position is off-route.
 */
function syncSimToDriver(rideId, lat, lng) {
    const sim = rideSims.get(rideId);
    if (!sim || !Array.isArray(sim.route) || sim.route.length < 2)
        return;
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < sim.route.length; i++) {
        const p = sim.route[i];
        const dLat = (p.latitude - lat) * 111_320;
        const dLng = (p.longitude - lng) * 111_320 * Math.max(0.3, Math.cos((lat * Math.PI) / 180));
        const d = dLat * dLat + dLng * dLng;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    if (best >= 0 && bestDist < 0.2 * 1_000_000 /** ~200m radius (deg² scaled) */) {
        sim.step = best;
    }
}
/** Stop the sim for a ride immediately (ride completed/cancelled/expired). */
function stopServerRideSim(rideId) {
    const prev = rideSims.get(rideId);
    if (prev)
        clearInterval(prev.timer);
    rideSims.delete(rideId);
    rideLivePings.delete(rideId);
}
function startServerRideSim(rideId, route) {
    if (!Array.isArray(route) || route.length < 2)
        return;
    stopServerRideSim(rideId);
    const sim = { route, step: 0, timer: null };
    sim.timer = setInterval(() => {
        (async () => {
            try {
                // Driver app is live — its stream is the source of truth. Stay silent.
                const livePing = rideLivePings.get(rideId);
                if (livePing && Date.now() - livePing < LIVE_PING_TIMEOUT_MS)
                    return;
                const ride = await (0, database_1.queryOne)("SELECT status FROM rides WHERE id = $1", [rideId]).catch(() => null);
                if (!ride || ["cancelled", "completed", "expired"].includes(ride.status)) {
                    stopServerRideSim(rideId);
                    return;
                }
                sim.step = Math.min(sim.step + RIDE_SIM_STEPS_PER_TICK, sim.route.length - 1);
                const cur = sim.route[sim.step];
                if (!cur)
                    return;
                if (sim.step >= sim.route.length - 1) {
                    // Reached the end of the published route — the LEG ends here. Handle the
                    // appropriate lifecycle transition (arrived at pickup / destination reached).
                    const shouldStop = await handleRouteEnd(rideId, ride.status, cur.latitude, cur.longitude);
                    if (shouldStop) {
                        stopServerRideSim(rideId);
                    }
                    return;
                }
                const nxt = sim.route[Math.min(sim.step + 1, sim.route.length - 1)];
                const bearing = nxt ? getSimBearing(cur.latitude, cur.longitude, nxt.latitude, nxt.longitude) : 0;
                await (0, database_1.execute)(`UPDATE driver_profiles dp SET current_lat = $1, current_lng = $2, current_heading = $3
           FROM rides r WHERE r.id = $4 AND r.driver_id = dp.user_id`, [cur.latitude, cur.longitude, bearing, rideId]).catch(() => { });
                const io = global.__vuraIo;
                io?.to(`ride:${rideId}`).emit("ride:driver:location", {
                    rideId: rideId,
                    lat: cur.latitude,
                    lng: cur.longitude,
                    bearing,
                    heading: bearing,
                });
            }
            catch (err) {
                // transient DB/broadcast errors — keep pacing the sim
            }
        })();
    }, RIDE_SIM_STEP_MS);
    rideSims.set(rideId, sim);
}
//# sourceMappingURL=rideSim.js.map