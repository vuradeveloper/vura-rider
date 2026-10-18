// ─────────────────────────────────────────────────────────────────────────────
// SAFETY WORKER — the heartbeat behind §1 and §6:
//   • every SAFETY_SWEEP_MS (default 20s): evaluate all active trips, and turn
//     fresh anomalies into rider check-ins;
//   • same tick: escalate check-ins nobody answered before their deadline;
//   • every 6h (+ once shortly after boot): purge location points past the
//     retention window (privacy §6).
// Started from index.ts with the socket server (check-ins must reach rooms).
// ─────────────────────────────────────────────────────────────────────────────
import type { Server as SocketIOServer } from "socket.io";
import { sweepAnomalies } from "./anomalyDetection";
import { sendCheckin, timeoutCheckins } from "./checkinService";
import { purgeOldLocations } from "./locationLog";
import { ensureSafetyTables } from "./safetyConfig";

const SWEEP_MS = Math.max(
  5_000,
  Number(process.env.SAFETY_SWEEP_MS || 20_000) || 20_000
);
const PURGE_MS = 6 * 60 * 60 * 1000;

let running = false;

async function tick(io: SocketIOServer): Promise<void> {
  if (running) return; // never overlap sweeps
  running = true;
  try {
    await ensureSafetyTables();
    const found = await sweepAnomalies();
    for (const f of found) {
      await sendCheckin(io, f.rideId, null, f.type);
      console.log(
        `[safety] anomaly ride=${f.rideId} type=${f.type} data=${JSON.stringify(f.data)}`
      );
    }
    const escalated = await timeoutCheckins();
    if (escalated.length) {
      console.error(`🚨 [safety] ${escalated.length} check-in(s) escalated to the admin team`);
    }
  } catch (err: any) {
    console.warn("[safety] worker tick failed:", err?.message || err);
  } finally {
    running = false;
  }
}

/** Wire the intervals. Called once from index.ts after io exists. */
export function startSafetyWorker(io: SocketIOServer): void {
  const sweep = setInterval(() => void tick(io), SWEEP_MS);
  const purge = setInterval(() => void purgeOldLocations(), PURGE_MS);
  sweep.unref?.();
  purge.unref?.();
  // First pass shortly after boot (catches trips in flight during a deploy),
  // then a first privacy purge a minute later.
  setTimeout(() => void tick(io), 15_000).unref?.();
  setTimeout(async () => {
    const n = await purgeOldLocations();
    if (n > 0) console.log(`[safety] purged ${n} location point(s) past retention`);
  }, 60_000).unref?.();
  console.log(`[safety] worker started (sweep=${SWEEP_MS}ms, retention purge=6h)`);
}
