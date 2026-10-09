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
import { execFileSync } from "child_process";
import {
  expireOffers,
  reviveWaitingRides,
  sweepStaleDrivers,
  DRIVER_STALE_SECONDS,
  LOCATION_FRESH_SECONDS,
  OFFER_TTL_SECONDS,
} from "./dispatch";
import { getDriverIndex } from "./driverIndex";
import { getConfig } from "./config";
import type { AppConfig } from "./config";

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

/**
 * Short hash of the running build, so a boot log line can be matched to the
 * commit (and therefore the server/dist rebuild) that produced it. Order:
 *   1. BUILD_COMMIT env — the only source that works when the deployed
 *      artifact is a zip without a .git directory (Elastic Beanstalk);
 *   2. `git rev-parse` — dev machines and source checkouts;
 *   3. "unknown" — never invent a hash.
 */
export function getBuildCommit(): string {
  const fromEnv = process.env.BUILD_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromGit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    if (/^[0-9a-f]{4,40}$/i.test(fromGit)) return fromGit;
  } catch {
    // no git / not a checkout — fall through
  }
  return "unknown";
}

/**
 * The boot line. It used to hardcode "driver stale 45s", which was wrong in
 * two different ways: the compiled demotion threshold is DRIVER_STALE_SECONDS
 * (20 in src; whatever the deployed dist was built with), and H3 index
 * eviction is a THIRD, separate value (app_config stale_seconds, 40 today).
 * Print every real number plus the build hash so an audit can verify a running
 * server without reading source.
 *
 * Pure on purpose — unit-tested in offerWorker.boot.test.ts.
 */
export function formatBootLog(
  cfg: Pick<AppConfig, "stale_seconds"> | null,
  buildCommit: string
): string {
  const evict = cfg ? `${cfg.stale_seconds}s` : "unknown";
  return (
    `[offerWorker] started (2s tick · offer TTL ${OFFER_TTL_SECONDS}s · ` +
    `driver stale ${DRIVER_STALE_SECONDS}s (demote) · ` +
    `loc fresh ${LOCATION_FRESH_SECONDS}s (candidates) · ` +
    `index evict ${evict} (app_config) · build ${buildCommit})`
  );
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

  // Boot line: async because stale_seconds lives in app_config (10s cache).
  // A config-read failure must never swallow the boot line — the compiled
  // constants and the build hash still print, index evict marked unknown.
  void getConfig().then(
    (cfg) => console.log(formatBootLog(cfg, getBuildCommit())),
    (err: any) => {
      console.warn(`[offerWorker] app_config unread at boot: ${err?.message}`);
      console.log(formatBootLog(null, getBuildCommit()));
    }
  );
}

export function stopOfferWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
