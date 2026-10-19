"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSafetyWorker = startSafetyWorker;
const anomalyDetection_1 = require("./anomalyDetection");
const checkinService_1 = require("./checkinService");
const locationLog_1 = require("./locationLog");
const safetyConfig_1 = require("./safetyConfig");
const SWEEP_MS = Math.max(5_000, Number(process.env.SAFETY_SWEEP_MS || 20_000) || 20_000);
const PURGE_MS = 6 * 60 * 60 * 1000;
let running = false;
async function tick(io) {
    if (running)
        return; // never overlap sweeps
    running = true;
    try {
        await (0, safetyConfig_1.ensureSafetyTables)();
        const found = await (0, anomalyDetection_1.sweepAnomalies)();
        for (const f of found) {
            await (0, checkinService_1.sendCheckin)(io, f.rideId, null, f.type);
            console.log(`[safety] anomaly ride=${f.rideId} type=${f.type} data=${JSON.stringify(f.data)}`);
        }
        const escalated = await (0, checkinService_1.timeoutCheckins)();
        if (escalated.length) {
            console.error(`🚨 [safety] ${escalated.length} check-in(s) escalated to the admin team`);
        }
    }
    catch (err) {
        console.warn("[safety] worker tick failed:", err?.message || err);
    }
    finally {
        running = false;
    }
}
/** Wire the intervals. Called once from index.ts after io exists. */
function startSafetyWorker(io) {
    const sweep = setInterval(() => void tick(io), SWEEP_MS);
    const purge = setInterval(() => void (0, locationLog_1.purgeOldLocations)(), PURGE_MS);
    sweep.unref?.();
    purge.unref?.();
    // First pass shortly after boot (catches trips in flight during a deploy),
    // then a first privacy purge a minute later.
    setTimeout(() => void tick(io), 15_000).unref?.();
    setTimeout(async () => {
        const n = await (0, locationLog_1.purgeOldLocations)();
        if (n > 0)
            console.log(`[safety] purged ${n} location point(s) past retention`);
    }, 60_000).unref?.();
    console.log(`[safety] worker started (sweep=${SWEEP_MS}ms, retention purge=6h)`);
}
//# sourceMappingURL=safetyWorker.js.map