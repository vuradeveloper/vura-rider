// ─────────────────────────────────────────────────────────────────────────────
// Offer-expiry worker.
//
// WHY A DB-POLLING WORKER: the dispatch spec requires offers to expire even if the
// server restarts mid-flow. An in-memory setTimeout dies with the process, so the
// worker polls ride_offers for rows past expires_at and moves each ride to the next
// driver. This mirrors the existing SchedulingService pattern (no BullMQ/Redis on
// Elastic Beanstalk).
//
// Ticks every 2s: expire offers -> re-offer -> 'no_drivers' when nobody is left.
// Every ~30s it also demotes drivers who stopped reporting (location/heartbeat), so
// a force-quit driver cannot keep absorbing offers.
// ─────────────────────────────────────────────────────────────────────────────

import type { Server as SocketIOServer } from "socket.io";
import { expireOffers, reviveWaitingRides, sweepStaleDrivers } from "./dispatch";

const TICK_MS = 2000;
const SWEEP_EVERY_TICKS = 15;

let timer: NodeJS.Timeout | null = null;
let running = false;
let ticks = 0;

export function startOfferWorker(io: SocketIOServer): void {
  if (timer) return;

  timer = setInterval(() => {
    if (running) return; // a slow DB must not stack ticks
    running = true;
    void (async () => {
      try {
        ticks += 1;
        const expired = await expireOffers(io);
        if (expired > 0) console.log(`[offerWorker] expired ${expired} offer(s) and moved them on`);
        // Riders must never be left waiting just because no driver was available at
        // the exact second they booked: retry waiting/parked rides every tick.
        await reviveWaitingRides(io).catch(() => 0);
        if (ticks % SWEEP_EVERY_TICKS === 0) {
          const demoted = await sweepStaleDrivers(io);
          if (demoted > 0) console.log(`[offerWorker] marked ${demoted} silent driver(s) offline`);
        }
      } catch (err: any) {
        console.warn("[offerWorker] tick failed:", err?.message);
      } finally {
        running = false;
      }
    })();
  }, TICK_MS);

  // A restart must resume mid-dispatch state from the DB, not sit idle until the
  // first tick: clear anything already overdue ~4s after boot.
  setTimeout(() => {
    void expireOffers(io)
      .then((n) => {
        if (n > 0) console.log(`[offerWorker] resumed: ${n} overdue offer(s) handled`);
      })
      .catch(() => undefined);
  }, 4000);

  console.log("[offerWorker] started (2s tick · offer TTL 15s · driver stale 45s)");
}

export function stopOfferWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
