// ─────────────────────────────────────────────────────────────────────────────
// CHECK-INS — "Is everything okay?" after every anomaly (§1): one pending
// prompt per ride, rider answers I'm-safe / SOS, silence escalates to the
// admin team at the configured deadline.
// ─────────────────────────────────────────────────────────────────────────────
import type { Server as SocketIOServer } from "socket.io";
import { query, queryOne, execute } from "../config/database";
import { ensureSafetyTables, getSafetySettings } from "./safetyConfig";
import { triggerSos } from "./sosService";

const TYPE_LABEL: Record<string, string> = {
  deviation: "your driver may be off the expected route",
  long_stop: "your trip has been stationary for a while",
  overrun: "your trip is taking much longer than expected",
  gps_silence: "we stopped receiving your trip's location",
};

/** Send the prompt for a fresh anomaly (skips if one is already pending). */
export async function sendCheckin(
  io: SocketIOServer,
  rideId: string,
  anomalyId: string | null,
  type: string
): Promise<void> {
  try {
    await ensureSafetyTables();
    const pending = await queryOne<{ id: string }>(
      "SELECT id FROM ride_checkins WHERE ride_id = $1 AND status = 'pending' LIMIT 1",
      [rideId]
    ).catch(() => null);
    if (pending) return;

    const cfg = await getSafetySettings();
    const resp = await queryOne<{ id: string; firebase_uid: string | null; full_name: string | null }>(
      `SELECT u.id, u.firebase_uid, u.full_name FROM rides r
        JOIN users u ON u.id = r.passenger_id WHERE r.id = $1`,
      [rideId]
    ).catch(() => null);

    await execute(
      `INSERT INTO ride_checkins (ride_id, anomaly_id, respond_by)
       VALUES ($1, $2, NOW() + make_interval(secs => $3::int))`,
      [rideId, anomalyId, cfg.checkin_timeout_s]
    );
    if (anomalyId) {
      await execute(
        "UPDATE ride_anomalies SET status = 'checkin_sent' WHERE id = $1 AND status = 'new'",
        [anomalyId]
      ).catch(() => { });
    }

    const reason = TYPE_LABEL[type] || "something unusual was detected";
    const message = `Is everything okay? On your trip, ${reason}.`;
    if (resp?.firebase_uid) {
      io.to(`user:${resp.firebase_uid}`).emit("safety:checkin", {
        ride_id: rideId,
        respond_by: new Date(Date.now() + cfg.checkin_timeout_s * 1000).toISOString(),
        type,
        message,
      });
      io.to(`ride:${rideId}`).emit("safety:checkin", { ride_id: rideId, type, message });
      // FCM so a backgrounded phone still wakes up.
      const { sendPushToUsers } = await import("./notify");
      void sendPushToUsers([resp.id], {
        type: "safety_checkin",
        title: "Is everything okay?",
        body: `${message} Tap to confirm you're safe.`,
        rideId,
        highPriority: true,
        data: { ride_id: rideId, action: "checkin" },
      }).catch(() => { });
    }
    console.log(`[safety] check-in sent ride=${rideId} type=${type}`);
  } catch (err: any) {
    console.warn("[safety] sendCheckin failed:", err?.message || err);
  }
}

export type CheckinResponse = "safe" | "sos";

/**
 * The rider's answer. 'safe' closes the anomaly; 'sos' supersedes it with a
 * full SOS alert (enriched payload) — both stop the escalation clock.
 */
export async function respondCheckin(
  io: SocketIOServer,
  rideId: string,
  riderId: string,
  response: CheckinResponse
): Promise<{ ok: boolean; error?: string; sos?: { id: string } }> {
  await ensureSafetyTables();
  const ride = await queryOne<{ passenger_id: string }>(
    "SELECT passenger_id FROM rides WHERE id = $1",
    [rideId]
  ).catch(() => null);
  if (!ride || ride.passenger_id !== riderId) return { ok: false, error: "Not your ride" };

  const pending = await queryOne<{ id: string; anomaly_id: string | null }>(
    `SELECT id, anomaly_id FROM ride_checkins
      WHERE ride_id = $1 AND status = 'pending'
      ORDER BY sent_at DESC LIMIT 1`,
    [rideId]
  ).catch(() => null);
  if (!pending) return { ok: false, error: "No pending check-in" };

  await execute(
    `UPDATE ride_checkins SET status = 'answered', response = $2, responded_at = NOW()
      WHERE id = $1`,
    [pending.id, response]
  );

  if (response === "safe") {
    if (pending.anomaly_id) {
      await execute(
        "UPDATE ride_anomalies SET status = 'safe', handled_at = NOW(), note = 'rider confirmed safe' WHERE id = $1",
        [pending.anomaly_id]
      ).catch(() => { });
    }
    io.to(`ride:${rideId}`).emit("safety:checkin:answered", { ride_id: rideId, response });
    return { ok: true };
  }

  // 'sos' — escalate for real.
  if (pending.anomaly_id) {
    await execute(
      "UPDATE ride_anomalies SET status = 'escalated', note = 'rider pressed SOS from check-in' WHERE id = $1",
      [pending.anomaly_id]
    ).catch(() => { });
  }
  const sos = await triggerSos({ rideId, byUserId: riderId, byRole: "rider" });
  return { ok: true, sos };
}

/** Deadline pass: pending check-ins nobody answered → admin alert. */
export async function timeoutCheckins(): Promise<string[]> {
  await ensureSafetyTables();
  const overdue = await query<{ id: string; ride_id: string; anomaly_id: string | null }>(
    `SELECT id, ride_id, anomaly_id FROM ride_checkins
      WHERE status = 'pending' AND respond_by < NOW()`
  ).catch(() => []);
  for (const c of overdue) {
    await execute(
      "UPDATE ride_checkins SET status = 'escalated' WHERE id = $1",
      [c.id]
    );
    if (c.anomaly_id) {
      await execute(
        "UPDATE ride_anomalies SET status = 'escalated', handled_at = NOW(), note = 'no rider response before deadline' WHERE id = $1",
        [c.anomaly_id]
      ).catch(() => { });
    }
    await execute(
      "INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'checkin_escalated', $2)",
      [c.ride_id, JSON.stringify({ checkin_id: c.id, at: new Date().toISOString() })]
    ).catch(() => { });
    console.error(`🚨 [safety] CHECK-IN NO RESPONSE — ride ${c.ride_id} (admin team alerted)`);
  }
  return overdue.map((c) => c.ride_id);
}
