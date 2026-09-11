import { execute, queryOne } from "../config/database";

// ── Server-side car simulation ──
// The driver app animates its car locally while open; when it's backgrounded/killed
// the phone pauses its timers, so no `driver:location` events reach the rider. This
// server mirror keeps the car moving (and the rider seeing the SAME route + car) even
// when the driver's app is closed. It steps along the driver-published route and
// broadcasts to the ride room every tick.
//
// SINGLE SOURCE OF TRUTH: when the driver app is open it streams `driver:location`
// every ~1s. That live stream is authoritative. The sim must NOT also broadcast at the
// same time or the rider sees two cars fighting. markDriverLivePing() records the last
// live ping; the sim skips ticks while the driver is actively streaming and only moves
// the car when the driver app goes quiet (backgrounded/closed). syncSimToDriver()
// snaps the sim's internal cursor to the driver's last reported position so when the
// live stream stops the sim continues seamlessly from there (no backward jump).
interface SimState {
  route: { latitude: number; longitude: number }[];
  step: number;
  timer: ReturnType<typeof setInterval>;
}
const rideSims = new Map<string, SimState>();
const rideLivePings = new Map<string, number>();
const RIDE_SIM_STEP_MS = 900;
const RIDE_SIM_STEPS_PER_TICK = 6;
const LIVE_PING_TIMEOUT_MS = 3500; // driver app streams ~1/s; >3.5s means gone quiet

function getSimBearing(sLat: number, sLng: number, dLat: number, dLng: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const y = Math.sin(toRad(dLng - sLng)) * Math.cos(toRad(dLat));
  const x = Math.cos(toRad(sLat)) * Math.sin(toRad(dLat)) - Math.sin(toRad(sLat)) * Math.cos(toRad(dLat)) * Math.cos(toRad(dLng - sLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The driver app just reported a live position for this ride — sim should back off. */
export function markDriverLivePing(rideId: string): void {
  rideLivePings.set(rideId, Date.now());
}

/**
 * Snap the sim cursor to the driver's live position (nearest route vertex). Called
 * on every live ping so the sim resumes exactly where the driver left off when the
 * app goes quiet. No-op if the route isn't known or the position is off-route.
 */
export function syncSimToDriver(rideId: string, lat: number, lng: number): void {
  const sim = rideSims.get(rideId);
  if (!sim || !Array.isArray(sim.route) || sim.route.length < 2) return;
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
export function stopServerRideSim(rideId: string): void {
  const prev = rideSims.get(rideId);
  if (prev) clearInterval(prev.timer);
  rideSims.delete(rideId);
  rideLivePings.delete(rideId);
}

export function startServerRideSim(rideId: string, route: { latitude: number; longitude: number }[]) {
  if (!Array.isArray(route) || route.length < 2) return;
  stopServerRideSim(rideId);
  const sim: SimState = { route, step: 0, timer: null as any };
  sim.timer = setInterval(() => {
    (async () => {
      try {
        // Driver app is live — its stream is the source of truth. Stay silent.
        const livePing = rideLivePings.get(rideId);
        if (livePing && Date.now() - livePing < LIVE_PING_TIMEOUT_MS) return;

        const ride = await queryOne<{ status: string }>("SELECT status FROM rides WHERE id = $1", [rideId]).catch(() => null);
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
        if (!cur) return;
        const bearing = nxt ? getSimBearing(cur.latitude, cur.longitude, nxt.latitude, nxt.longitude) : 0;
        await execute(
          `UPDATE driver_profiles dp SET current_lat = $1, current_lng = $2, current_heading = $3
           FROM rides r WHERE r.id = $4 AND r.driver_id = dp.user_id`,
          [cur.latitude, cur.longitude, bearing, rideId]
        ).catch(() => {});
        const io = (global as any).__vuraIo as
          | { to: (room: string) => { emit: (ev: string, ...args: any[]) => void } }
          | undefined;
        io?.to(`ride:${rideId}`).emit("ride:driver:location", {
          rideId: rideId,
          lat: cur.latitude,
          lng: cur.longitude,
          bearing,
          heading: bearing,
        });
      } catch (err: any) {
        // transient DB/broadcast errors — keep pacing the sim
      }
    })();
  }, RIDE_SIM_STEP_MS);
  rideSims.set(rideId, sim);
}