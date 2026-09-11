"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markDriverLivePing = markDriverLivePing;
exports.syncSimToDriver = syncSimToDriver;
exports.stopServerRideSim = stopServerRideSim;
exports.startServerRideSim = startServerRideSim;
const database_1 = require("../config/database");
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
                if (sim.step >= sim.route.length - 1) {
                    // Reached the end of the published route — nothing more to animate.
                    stopServerRideSim(rideId);
                    return;
                }
                const cur = sim.route[sim.step];
                const nxt = sim.route[Math.min(sim.step + 1, sim.route.length - 1)];
                if (!cur)
                    return;
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