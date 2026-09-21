"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDueScheduledRides = processDueScheduledRides;
exports.startScheduler = startScheduler;
exports.stopScheduler = stopScheduler;
exports.remindAssignedDrivers = remindAssignedDrivers;
exports.releaseOfflineReservations = releaseOfflineReservations;
const database_1 = require("../config/database");
const push_1 = require("./push");
// How long before pickup the system starts matching a driver — mirrors how
// Uber/Bolt dispatch drivers ~15-30 minutes before a reserved pickup so the
// driver arrives on time.
const BOOK_AHEAD_MINUTES = 15;
const POLL_INTERVAL_MS = 60_000;
// ── Reservation (Uber Reserve-style) constants ────────────────────────────
// A driver who pre-accepted a reservation is reminded ~30 min before pickup,
// and if they are still OFFLINE ~20 min before pickup the reservation is
// released back into the normal matching pool so the rider still gets a car.
const REMINDER_MINUTES = 30;
const RELEASE_MINUTES = 20;
// In-memory dedupe so a reminder is sent once per reservation. (Deliberately
// no schema change; a restart at worst re-sends one reminder.)
const remindedRideIds = new Set();
let timer = null;
// Finds scheduled rides whose pickup is now within BOOK_AHEAD_MINUTES and
// transitions them into the normal driver-matching pool ('searching'). This is
// the "automatic booking": once a scheduled ride is due, it behaves exactly
// like a regular on-demand ride request.
async function processDueScheduledRides(io) {
    const due = await (0, database_1.query)(`SELECT id, scheduled_at FROM rides
     WHERE status = 'scheduled' AND announced = FALSE
       AND scheduled_at <= NOW() + make_interval(mins => $1)
       AND scheduled_at > NOW()
     ORDER BY scheduled_at ASC`, [BOOK_AHEAD_MINUTES]);
    for (const ride of due) {
        await (0, database_1.execute)(`UPDATE rides SET status = 'searching', announced = TRUE, updated_at = NOW()
       WHERE id = $1 AND status = 'scheduled' AND announced = FALSE`, [ride.id]);
        io.to(`ride:${ride.id}`).emit("ride:scheduled:started", {
            rideId: ride.id,
            scheduledAt: ride.scheduled_at,
        });
        console.log(`[Scheduler] Auto-booked scheduled ride ${ride.id} (pickup ${ride.scheduled_at})`);
    }
    return due.length;
}
function startScheduler(io) {
    if (timer)
        return timer;
    timer = setInterval(() => {
        processDueScheduledRides(io).catch((err) => {
            console.error("[Scheduler] Failed to process due scheduled rides:", err);
        });
        remindAssignedDrivers(io).catch((err) => {
            console.error("[Scheduler] Failed to send reservation reminders:", err);
        });
        releaseOfflineReservations(io).catch((err) => {
            console.error("[Scheduler] Failed to release offline reservations:", err);
        });
    }, POLL_INTERVAL_MS);
    return timer;
}
function stopScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
// ── Reservation reminders & offline release (Uber Reserve behaviour) ───────
// A driver who pre-accepted a reservation is reminded shortly before pickup,
// and if they are still offline near pickup time the reservation is released
// back into the normal matching pool so the rider still gets a car.
/** Reminds the assigned driver once, ~REMINDER_MINUTES before pickup. */
async function remindAssignedDrivers(io) {
    const due = await (0, database_1.query)(`SELECT r.id, r.scheduled_at, u.firebase_uid AS driver_uid
       FROM rides r
       JOIN users u ON u.id = r.driver_id
      WHERE r.status = 'accepted'
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at <= NOW() + make_interval(mins => $1)
        AND r.scheduled_at > NOW()`, [REMINDER_MINUTES]);
    let sent = 0;
    for (const ride of due) {
        if (remindedRideIds.has(ride.id))
            continue;
        remindedRideIds.add(ride.id);
        if (ride.driver_uid) {
            (0, push_1.sendPushToUser)(ride.driver_uid, {
                title: "Reservation soon",
                body: "You have a reserved pickup in 30 minutes. Go online to keep it.",
                data: { rideId: ride.id, type: "reservation_reminder" },
            }).catch(() => { });
        }
        io.to(`ride:${ride.id}`).emit("ride:reservation:reminder", {
            rideId: ride.id,
            scheduledAt: ride.scheduled_at,
        });
        sent++;
        console.log(`[Scheduler] Reservation reminder sent for ride ${ride.id}`);
    }
    return sent;
}
/**
 * Releases a reservation back to 'searching' when its pre-accepted driver is
 * still offline within RELEASE_MINUTES of pickup, then notifies the rider.
 * Uses an atomic UPDATE ... WHERE status='accepted' so it can never fire twice.
 */
async function releaseOfflineReservations(io) {
    const due = await (0, database_1.query)(`SELECT r.id, r.scheduled_at, u.firebase_uid AS passenger_uid
       FROM rides r
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       JOIN users u ON u.id = r.passenger_id
      WHERE r.status = 'accepted'
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at <= NOW() + make_interval(mins => $1)
        AND r.scheduled_at > NOW()
        AND COALESCE(dp.is_online, FALSE) = FALSE`, [RELEASE_MINUTES]);
    let released = 0;
    for (const ride of due) {
        const upd = await (0, database_1.queryOne)(`UPDATE rides
          SET status = 'searching', driver_id = NULL, announced = TRUE, updated_at = NOW()
        WHERE id = $1 AND status = 'accepted'
        RETURNING id`, [ride.id]);
        if (!upd)
            continue; // another process already handled it
        if (ride.passenger_uid) {
            (0, push_1.sendPushToUser)(ride.passenger_uid, {
                title: "Finding a new driver",
                body: "Your reserved driver went offline — we're finding a replacement for your pickup.",
                data: { rideId: ride.id, type: "reservation_released" },
            }).catch(() => { });
        }
        io.to(`ride:${ride.id}`).emit("ride:driver:cancelled", {
            rideId: ride.id,
            reason: "reserved_driver_offline",
        });
        io.to("drivers").emit("ride:rematch", { rideId: ride.id });
        released++;
        console.log(`[Scheduler] Released reservation ${ride.id} (driver offline)`);
    }
    return released;
}
//# sourceMappingURL=SchedulingService.js.map