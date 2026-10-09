"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.evictStaleIndexOnce = evictStaleIndexOnce;
exports.getBuildCommit = getBuildCommit;
exports.formatBootLog = formatBootLog;
exports.startOfferWorker = startOfferWorker;
exports.stopOfferWorker = stopOfferWorker;
const child_process_1 = require("child_process");
const dispatch_1 = require("./dispatch");
const destinationSession_1 = require("./destinationSession");
const driverIndex_1 = require("./driverIndex");
const config_1 = require("./config");
const TICK_MS = 2000;
const SWEEP_EVERY_TICKS = 15;
let timer = null;
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
async function evictStaleIndexOnce() {
    if (evicting)
        return 0; // skip: the previous run is still going
    evicting = true;
    try {
        const cfg = await (0, config_1.getConfig)();
        const n = await (0, driverIndex_1.getDriverIndex)().evictStale(cfg.stale_seconds);
        if (n > 0) {
            console.log(`[offerWorker] evicted ${n} stale driver cell(s) (last_seen older than ${cfg.stale_seconds}s)`);
        }
        return n;
    }
    catch (err) {
        // Never let a sweep failure kill the worker loop.
        console.warn("[offerWorker] evictStale failed:", err?.message);
        return 0;
    }
    finally {
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
function getBuildCommit() {
    const fromEnv = process.env.BUILD_COMMIT?.trim();
    if (fromEnv)
        return fromEnv;
    try {
        const fromGit = (0, child_process_1.execFileSync)("git", ["rev-parse", "--short", "HEAD"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 3000,
        }).trim();
        if (/^[0-9a-f]{4,40}$/i.test(fromGit))
            return fromGit;
    }
    catch {
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
function formatBootLog(cfg, buildCommit) {
    const evict = cfg ? `${cfg.stale_seconds}s` : "unknown";
    return (`[offerWorker] started (2s tick · offer TTL ${dispatch_1.OFFER_TTL_SECONDS}s · ` +
        `driver stale ${dispatch_1.DRIVER_STALE_SECONDS}s (demote) · ` +
        `loc fresh ${dispatch_1.LOCATION_FRESH_SECONDS}s (candidates) · ` +
        `index evict ${evict} (app_config) · build ${buildCommit})`);
}
function startOfferWorker(io) {
    if (timer)
        return;
    timer = setInterval(() => {
        if (running)
            return; // a slow DB must not stack ticks
        running = true;
        void (async () => {
            try {
                ticks += 1;
                const expired = await (0, dispatch_1.expireOffers)(io);
                if (expired > 0)
                    console.log(`[offerWorker] expired ${expired} offer(s) and moved them on`);
                // Riders must never be left waiting just because no driver was available at
                // the exact second they booked: retry waiting/parked rides every tick.
                await (0, dispatch_1.reviveWaitingRides)(io).catch(() => 0);
                if (ticks % SWEEP_EVERY_TICKS === 0) {
                    const demoted = await (0, dispatch_1.sweepStaleDrivers)(io);
                    if (demoted > 0)
                        console.log(`[offerWorker] marked ${demoted} silent driver(s) offline`);
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
                    const destEnded = await (0, destinationSession_1.sweepDestinationSessionsOnce)(io);
                    if (destEnded > 0) {
                        console.log(`[offerWorker] auto-ended ${destEnded} destination session(s)`);
                    }
                }
            }
            catch (err) {
                console.warn("[offerWorker] tick failed:", err?.message);
            }
            finally {
                running = false;
            }
        })();
    }, TICK_MS);
    // A restart must resume mid-dispatch state from the DB, not sit idle until the
    // first tick: clear anything already overdue ~4s after boot.
    setTimeout(() => {
        void (0, dispatch_1.expireOffers)(io)
            .then((n) => {
            if (n > 0)
                console.log(`[offerWorker] resumed: ${n} overdue offer(s) handled`);
        })
            .catch(() => undefined);
    }, 4000);
    // Module 2: a session that hit its end condition while the server was down
    // (feature_disabled / arrived / offline / idle timeout) must be closed soon
    // after boot — the daily-use count and the driver's banner both read the
    // session row.
    setTimeout(() => {
        void (0, destinationSession_1.sweepDestinationSessionsOnce)(io)
            .then((n) => {
            if (n > 0) {
                console.log(`[offerWorker] resumed: ${n} destination session(s) ended while down`);
            }
        })
            .catch(() => undefined);
    }, 6000);
    // Boot line: async because stale_seconds lives in app_config (10s cache).
    // A config-read failure must never swallow the boot line — the compiled
    // constants and the build hash still print, index evict marked unknown.
    void (0, config_1.getConfig)().then((cfg) => console.log(formatBootLog(cfg, getBuildCommit())), (err) => {
        console.warn(`[offerWorker] app_config unread at boot: ${err?.message}`);
        console.log(formatBootLog(null, getBuildCommit()));
    });
}
function stopOfferWorker() {
    if (timer)
        clearInterval(timer);
    timer = null;
}
//# sourceMappingURL=offerWorker.js.map