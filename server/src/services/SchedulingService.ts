import { query, execute } from "../config/database";
import type { Server as SocketIOServer } from "socket.io";

// How long before pickup the system starts matching a driver — mirrors how
// Uber/Bolt dispatch drivers ~15-30 minutes before a reserved pickup so the
// driver arrives on time.
const BOOK_AHEAD_MINUTES = 15;
const POLL_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

// Finds scheduled rides whose pickup is now within BOOK_AHEAD_MINUTES and
// transitions them into the normal driver-matching pool ('searching'). This is
// the "automatic booking": once a scheduled ride is due, it behaves exactly
// like a regular on-demand ride request.
export async function processDueScheduledRides(io: SocketIOServer): Promise<number> {
  const due = await query<any>(
    `SELECT id, scheduled_at FROM rides
     WHERE status = 'scheduled' AND announced = FALSE
       AND scheduled_at <= NOW() + make_interval(mins => $1)
       AND scheduled_at > NOW()
     ORDER BY scheduled_at ASC`,
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
    console.log(`[Scheduler] Auto-booked scheduled ride ${ride.id} (pickup ${ride.scheduled_at})`);
  }
  return due.length;
}

export function startScheduler(io: SocketIOServer): NodeJS.Timeout {
  if (timer) return timer;
  timer = setInterval(() => {
    processDueScheduledRides(io).catch((err) => {
      console.error("[Scheduler] Failed to process due scheduled rides:", err);
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
