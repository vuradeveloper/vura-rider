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
exports.startOfferWorker = startOfferWorker;
exports.stopOfferWorker = stopOfferWorker;
const dispatch_1 = require("./dispatch");
const TICK_MS = 2000;
const SWEEP_EVERY_TICKS = 15;
let timer = null;
let running = false;
let ticks = 0;
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
                if (ticks % SWEEP_EVERY_TICKS === 0) {
                    const demoted = await (0, dispatch_1.sweepStaleDrivers)(io);
                    if (demoted > 0)
                        console.log(`[offerWorker] marked ${demoted} silent driver(s) offline`);
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
    console.log("[offerWorker] started (2s tick · offer TTL 15s · driver stale 45s)");
}
function stopOfferWorker() {
    if (timer)
        clearInterval(timer);
    timer = null;
}
//# sourceMappingURL=offerWorker.js.map