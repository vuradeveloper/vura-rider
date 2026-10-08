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
import { sweepDestinationSessionsOnce } from "./destinationSession";
import { getDriverIndex } from "./driverIndex";
import { getConfig } from "./config";

const TICK_MS = 2000;
const SWEEP_EVERY_TICKS = 15;

let timer: NodeJS.Timeout | null = null;
let running = false;
let ticks = 0;

// The eviction sweep guards SEPARATELY from the tick's own `running` flag: even
// if a future caller invokes it directly (tests, a debug endpoint, a second
// worker process), a run never overlaps another run — the second call returns
// 0 immediately instead of issuing a second DELETE.
let evicting = false;

/**
 * Drop drivers from the H3 index who have gone quiet past stale_seconds
 * (40 today; read from app_config, never hardcoded here).
 *
 * Cheap by construction: idx_driver_cells_fresh (last_seen_at) turns the
 * DELETE into an index range scan — no seq scan, no lock on driver_profiles,
 * and driver_cells rows are rebuildable from the next GPS ping, so a lost row
 * costs nothing.
 */
export async function evictStaleIndexOnce(): Promise<number> {
  if (evicting) return 0; // skip: the previous run is still going
  evicting = true;
  try {
    const cfg = await getConfig();
    const n = await getDriverIndex().evictStale(cfg.stale_seconds);
    if (n > 0) {
      console.log(
        `[offerWorker] evicted ${n} stale driver cell(s) (last_seen older than ${cfg.stale_seconds}s)`
      );
    }
    return n;
  } catch (err: any) {
    // Never let a sweep failure kill the worker loop.
    console.warn("[offerWorker] evictStale failed:", err?.message);
    return 0;
  } finally {
    evicting = false;
  }
}

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
          // Index hygiene: same cadence as the driver demotion sweep (~30s),
          // non-overlapping (evictStaleIndexOnce skips if still running).
          await evictStaleIndexOnce();
          // Module 2: auto-end sweep (~30s cadence): feature_disabled →
          // arrived → offline (explicit or grace silence) → idle timeout; the
          // arrival check ALSO runs on every GPS ping (onDriverPingPosition),
          // and both paths close through ONE row-guarded closeSession so a
          // session can never end twice. Same non-overlap guard pattern as the
          // eviction above: a slow sweep makes the next tick skip rather than
          // race it.
          const destEnded = await sweepDestinationSessionsOnce(io);
          if (destEnded > 0) {
            console.log(`[offerWorker] auto-ended ${destEnded} destination session(s)`);
          }
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

  // Module 2: a session that hit its end condition while the server was down
  // (feature_disabled / arrived / offline / idle timeout) must be closed soon
  // after boot — the daily-use count and the driver's banner both read the
  // session row.
  setTimeout(() => {
    void sweepDestinationSessionsOnce(io)
      .then((n) => {
        if (n > 0) {
          console.log(`[offerWorker] resumed: ${n} destination session(s) ended while down`);
        }
      })
      .catch(() => undefined);
  }, 6000);

  console.log("[offerWorker] started (2s tick · offer TTL 15s · driver stale 45s)");
}

export function stopOfferWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
