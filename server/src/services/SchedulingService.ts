import { query, queryOne, execute } from "../config/database";
import type { Server as SocketIOServer } from "socket.io";
import { emitRideAccepted, startDispatch } from "./dispatch";
import { mintRidePin } from "./pinService";
import { sendPushToUser } from "./notify";

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
// 10 and 5 minute pickup reminders (the phone-buzz window the rider/driver
// asked for). The claim table makes each one exactly-once across restarts.
const PICKUP_REMINDER_WINDOW_MINUTES = 10;

// Fallback dedupe if the reminder table cannot be created/read.
const remindedRideIds = new Set<string>();

async function ensureReminderTable(): Promise<void> {
  await execute(
    `CREATE TABLE IF NOT EXISTS scheduled_reminders (
       ride_id UUID NOT NULL,
       kind VARCHAR(16) NOT NULL,
       sent_at TIMESTAMPTZ DEFAULT NOW(),
       PRIMARY KEY (ride_id, kind)
     )`
  ).catch(() => undefined);
}

/** Claim a reminder exactly once (DB-backed; in-memory fallback). */
async function claimReminder(rideId: string, kind: string): Promise<boolean> {
  const key = `${rideId}:${kind}`;
  try {
    const row = await queryOne<{ ride_id: string }>(
      `INSERT INTO scheduled_reminders (ride_id, kind) VALUES ($1, $2)
       ON CONFLICT (ride_id, kind) DO NOTHING
       RETURNING ride_id`,
      [rideId, kind]
    );
    return !!row;
  } catch (err: any) {
    // Table missing / transient DB issue: still never send the same reminder
    // twice in this process.
    if (remindedRideIds.has(key)) return false;
    remindedRideIds.add(key);
    console.warn(`[Scheduler] reminder claim fallback ${key}:`, err?.message || err);
    return true;
  }
}

let timer: NodeJS.Timeout | null = null;

// Finds scheduled rides whose pickup is now within BOOK_AHEAD_MINUTES and
// transitions them into the normal driver-matching pool ('searching'). This is
// the "automatic booking": once a scheduled ride is due, it behaves exactly
// like a regular on-demand ride request.
export async function processDueScheduledRides(io: SocketIOServer): Promise<number> {
  const due = await query<any>(
    `SELECT r.id, r.scheduled_at, r.passenger_id, u.firebase_uid AS passenger_uid
       FROM rides r
       JOIN users u ON u.id = r.passenger_id
     WHERE r.status = 'scheduled' AND r.announced = FALSE AND r.driver_id IS NULL
       AND r.scheduled_at <= NOW() + make_interval(mins => $1)
       AND r.scheduled_at > NOW() - INTERVAL '30 minutes'
     ORDER BY r.scheduled_at ASC`,
    [BOOK_AHEAD_MINUTES]
  );

  for (const ride of due) {
    await execute(
      `UPDATE rides SET status = 'searching', announced = TRUE, updated_at = NOW()
       WHERE id = $1 AND status = 'scheduled' AND announced = FALSE`,
      [ride.id]
    );
    io.to(`ride:${ride.id}`).emit("ride:scheduled:started", {
      rideId: ride.id,
      scheduledAt: ride.scheduled_at,
    });
    if (ride.passenger_uid) {
      io.to(`user:${ride.passenger_uid}`).emit("ride:scheduled:started", {
        rideId: ride.id,
        scheduledAt: ride.scheduled_at,
      });
    }
    // The app may be closed while the rider waits for their reserved pickup.
    // Push this milestone so the rider knows matching has started even if the
    // socket is gone (the in-app screen receives the same event when open).
    if (ride.passenger_id) {
      sendPushToUser(ride.passenger_id, {
        type: "scheduled_ride_started",
        title: "Your scheduled ride is starting",
        body: "We are finding a driver for your pickup now.",
        highPriority: true,
        channelId: "scheduled_reminders",
        data: { rideId: ride.id, type: "scheduled_ride_started" },
      }).catch(() => {});
    }
    // START MATCHING NOW. A scheduled ride can be days old, so the offer
    // worker's "created within 15 minutes" revive guard would never pick it up;
    // the ride would sit in 'searching' with nobody ever offered it. Dispatch
    // it explicitly the moment it becomes due.
    void startDispatch(io, ride.id).catch((err) =>
      console.warn(`[Scheduler] dispatch failed for scheduled ride ${ride.id}:`, err?.message || err)
    );
    console.log(`[Scheduler] Auto-booked scheduled ride ${ride.id} (pickup ${ride.scheduled_at})`);
  }
  return due.length;
}

/**
 * 10-minute and 5-minute pickup reminders for a scheduled ride. Sent to the
 * rider always, and to the assigned driver too. HIGH priority + the
 * `scheduled_reminders` Android channel (importance HIGH, sound + vibration)
 * so the phone actually buzzes instead of silently posting to the tray.
 */
export async function sendPickupReminders(io: SocketIOServer): Promise<number> {
  const due = await query<any>(
    `SELECT r.id, r.scheduled_at, r.pickup_address,
            r.passenger_id, r.driver_id,
            pu.firebase_uid AS passenger_uid,
            du.firebase_uid AS driver_uid,
            du.full_name AS driver_name
       FROM rides r
       JOIN users pu ON pu.id = r.passenger_id
       LEFT JOIN users du ON du.id = r.driver_id
      WHERE r.status IN ('scheduled', 'searching', 'no_drivers', 'accepted', 'driver_arrived')
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at > NOW()
        AND r.scheduled_at <= NOW() + make_interval(mins => $1)
      ORDER BY r.scheduled_at ASC`,
    [PICKUP_REMINDER_WINDOW_MINUTES]
  );

  let sent = 0;
  const now = Date.now();
  for (const ride of due) {
    const when = new Date(ride.scheduled_at).getTime();
    if (!Number.isFinite(when)) continue;
    const minutes = Math.max(0, Math.ceil((when - now) / 60000));
    const kind = minutes <= 5 ? "5" : "10";
    if (minutes > PICKUP_REMINDER_WINDOW_MINUTES) continue;
    if (!(await claimReminder(ride.id, kind))) continue;

    const timeLabel = new Date(when).toLocaleTimeString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const pickup = String(ride.pickup_address || "your pickup point");
    const driver = String(ride.driver_name || "Your driver");
    const hasDriver = !!ride.driver_id;
    const active = ["accepted", "driver_arrived"].includes(String(ride.status || ""));

    if (ride.passenger_id) {
      const title = `Ride in ${kind} minutes`;
      const body =
        kind === "5"
          ? hasDriver
            ? active
              ? `Be ready at ${pickup}. ${driver} is arriving for your ${timeLabel} pickup.`
              : `Be ready at ${pickup}. ${driver} is on the way for your ${timeLabel} pickup.`
            : `Be ready at ${pickup}. We are still matching a driver for your ${timeLabel} pickup.`
          : hasDriver
            ? active
              ? `${driver} is on the way for your ${timeLabel} pickup at ${pickup}.`
              : `${driver} is reserved for your ${timeLabel} pickup at ${pickup}.`
            : `We are matching a driver for your ${timeLabel} pickup at ${pickup}.`;
      void sendPushToUser(ride.passenger_id, {
        type: "scheduled_reminder",
        title,
        body,
        highPriority: true,
        channelId: "scheduled_reminders",
        data: { rideId: ride.id, type: "scheduled_reminder", minutes: kind },
      }).catch(() => {});
      sent++;
    }

    if (hasDriver) {
      void sendPushToUser(ride.driver_id, {
        type: "reservation_reminder",
        title: `Reserved pickup in ${kind} minutes`,
        body:
          kind === "5"
            ? active
              ? `Your pickup at ${pickup} is in 5 minutes. You are on the way — drive safely.`
              : `Your reserved pickup at ${pickup} is in 5 minutes. Stay online — the trip activates now.`
            : active
              ? `Your pickup at ${pickup} is in 10 minutes. Head there now.`
              : `Your reserved pickup at ${pickup} is in 10 minutes. Head there now and stay online.`,
        highPriority: true,
        channelId: "scheduled_reminders",
        data: { rideId: ride.id, type: "reservation_reminder", minutes: kind },
      }).catch(() => {});
      sent++;
    }

    io.to(`ride:${ride.id}`).emit("ride:scheduled:reminder", {
      rideId: ride.id,
      minutes: Number(kind),
      scheduledAt: ride.scheduled_at,
    });
    if (ride.driver_uid) {
      io.to(`user:${ride.driver_uid}`).emit("ride:reservation:reminder", {
        rideId: ride.id,
        minutes: Number(kind),
        scheduledAt: ride.scheduled_at,
      });
    }
    console.log(`[Scheduler] ${kind}-minute pickup reminder ride=${ride.id}`);
  }
  return sent;
}

export function startScheduler(io: SocketIOServer): NodeJS.Timeout {
  if (timer) return timer;
  void ensureReminderTable();
  timer = setInterval(() => {
    processDueScheduledRides(io).catch((err) => {
      console.error("[Scheduler] Failed to process due scheduled rides:", err);
    });
    activateDueReservations(io).catch((err) => {
      console.error("[Scheduler] Failed to activate reservations:", err);
    });
    remindAssignedDrivers(io).catch((err) => {
      console.error("[Scheduler] Failed to send reservation reminders:", err);
    });
    releaseOfflineReservations(io).catch((err) => {
      console.error("[Scheduler] Failed to release offline reservations:", err);
    });
    sendPickupReminders(io).catch((err) => {
      console.error("[Scheduler] Failed to send pickup reminders:", err);
    });
  }, POLL_INTERVAL_MS);
  return timer;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ── Reservation reminders & offline release (Uber Reserve behaviour) ───────
// A driver who pre-accepted a reservation is reminded shortly before pickup,
// and if they are still offline near pickup time the reservation is released
// back into the normal matching pool so the rider still gets a car.

/**
 * A reserved ride activates 15 minutes before pickup: only then does it become
 * an active trip and the driver go on_trip. Before that the driver stays
 * available for normal rides. If the driver is offline or already on a trip,
 * releaseOfflineReservations() returns the ride to matching instead.
 */
export async function activateDueReservations(io: SocketIOServer): Promise<number> {
  const due = await query<any>(
    `SELECT r.id, r.driver_id, r.passenger_id, r.scheduled_at, r.pickup_address,
            u.firebase_uid AS driver_uid, u.full_name AS driver_name,
            p.firebase_uid AS passenger_uid
       FROM rides r
       JOIN driver_profiles dp ON dp.user_id = r.driver_id
       JOIN users u ON u.id = r.driver_id
       JOIN users p ON p.id = r.passenger_id
      WHERE r.status = 'scheduled'
        AND r.driver_id IS NOT NULL
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at <= NOW() + make_interval(mins => $1)
        AND r.scheduled_at > NOW() - INTERVAL '30 minutes'
        AND COALESCE(dp.is_online, FALSE) = TRUE
        AND COALESCE(dp.status, '') NOT IN ('on_trip', 'break')
      ORDER BY r.scheduled_at ASC`,
    [BOOK_AHEAD_MINUTES]
  );

  let activated = 0;
  for (const ride of due) {
    const upd = await queryOne<{ version: number }>(
      `UPDATE rides
          SET status = 'accepted', accepted_at = NOW(), updated_at = NOW(),
              version = COALESCE(version, 0) + 1
        WHERE id = $1 AND status = 'scheduled' AND driver_id = $2
        RETURNING COALESCE(version, 0) AS version`,
      [ride.id, ride.driver_id]
    );
    if (!upd) continue;

    await execute(
      `UPDATE driver_profiles SET status = 'on_trip', updated_at = NOW() WHERE user_id = $1`,
      [ride.driver_id]
    ).catch(() => {});
    void mintRidePin(ride.id).catch((err) =>
      console.warn("[Scheduler] PIN mint failed:", err?.message || err)
    );
    await emitRideAccepted(io, ride.id, ride.driver_id, Number(upd.version) || 0).catch((err) =>
      console.warn("[Scheduler] emitRideAccepted failed:", err?.message || err)
    );
    if (ride.driver_uid) {
      io.to(`user:${ride.driver_uid}`).emit("ride:reservation:activated", {
        rideId: ride.id,
        scheduledAt: ride.scheduled_at,
      });
      sendPushToUser(ride.driver_id, {
        type: "reservation_activated",
        title: "Reservation starting",
        body: "Head to the pickup point for your reserved ride.",
        highPriority: true,
        channelId: "scheduled_reminders",
        data: { rideId: ride.id, type: "reservation_activated" },
      }).catch(() => {});
    }
    activated++;
    console.log(
      `[Scheduler] Activated reservation ${ride.id} (pickup ${ride.scheduled_at})`
    );
  }
  return activated;
}

/** Reminds the assigned driver once, ~REMINDER_MINUTES before pickup. */
export async function remindAssignedDrivers(io: SocketIOServer): Promise<number> {
  const due = await query<any>(
    `SELECT r.id, r.driver_id, r.scheduled_at, u.firebase_uid AS driver_uid
       FROM rides r
       JOIN users u ON u.id = r.driver_id
      WHERE r.status = 'scheduled'
        AND r.driver_id IS NOT NULL
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at <= NOW() + make_interval(mins => $1)
        AND r.scheduled_at > NOW() - INTERVAL '30 minutes'`,
    [REMINDER_MINUTES]
  );

  let sent = 0;
  for (const ride of due) {
    if (!(await claimReminder(ride.id, "30"))) continue;

    if (ride.driver_uid) {
      sendPushToUser(ride.driver_id, {
        type: "reservation_reminder",
        title: "Reserved pickup in 30 minutes",
        body: "You have a reserved pickup in 30 minutes. Go online to keep it.",
        highPriority: true,
        channelId: "scheduled_reminders",
        data: { rideId: ride.id, type: "reservation_reminder" },
      }).catch(() => {});
      io.to(`user:${ride.driver_uid}`).emit("ride:reservation:reminder", {
        rideId: ride.id,
        scheduledAt: ride.scheduled_at,
      });
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
export async function releaseOfflineReservations(io: SocketIOServer): Promise<number> {
  const due = await query<any>(
    `SELECT r.id, r.passenger_id, r.scheduled_at, u.firebase_uid AS passenger_uid
       FROM rides r
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       JOIN users u ON u.id = r.passenger_id
      WHERE r.status = 'scheduled'
        AND r.driver_id IS NOT NULL
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at <= NOW() + make_interval(mins => $1)
        AND r.scheduled_at > NOW() - INTERVAL '30 minutes'
        AND (COALESCE(dp.is_online, FALSE) = FALSE OR COALESCE(dp.status, '') IN ('on_trip', 'break'))`,
    [RELEASE_MINUTES]
  );

  let released = 0;
  for (const ride of due) {
    const upd = await queryOne<{ id: string }>(
      `UPDATE rides
          SET status = 'searching', driver_id = NULL, announced = TRUE, updated_at = NOW()
        WHERE id = $1 AND status = 'scheduled'
        RETURNING id`,
      [ride.id]
    );
    if (!upd) continue; // another process already handled it

    if (ride.passenger_uid) {
      sendPushToUser(ride.passenger_id, {
        type: "reservation_released",
        title: "Finding a new driver",
        body: "Your reserved driver went offline — we're finding a replacement for your pickup.",
        highPriority: true,
        channelId: "scheduled_reminders",
        data: { rideId: ride.id, type: "reservation_released" },
      }).catch(() => {});
    }
    io.to(`user:${ride.passenger_uid}`).emit("ride:reservation:released", {
      rideId: ride.id,
      reason: "reserved_driver_offline",
    });
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
