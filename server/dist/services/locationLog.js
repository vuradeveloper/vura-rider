"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.logRidePoint = logRidePoint;
exports.ridePath = ridePath;
exports.purgeOldLocations = purgeOldLocations;
exports.lastRidePoint = lastRidePoint;
// ─────────────────────────────────────────────────────────────────────────────
// LOCATION LOG — persists the driver's ping ONLY while their ride is active
// (the caller has already confirmed active status), for anomaly detection and
// the admin live map's travelled-path. Privacy: rows are purged after
// safety_config.location_retention_days by the daily janitor.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const safetyConfig_1 = require("./safetyConfig");
/**
 * Record one point of the active trip. Fire-and-forget at the call site —
 * a history failure must never break a GPS ping the rider's map relies on.
 */
async function logRidePoint(rideId, driverId, lat, lng) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    await (0, database_1.execute)(`INSERT INTO ride_location_points (ride_id, driver_id, lat, lng, recorded_at)
     VALUES ($1, $2, $3, $4, NOW())`, [rideId, driverId, lat, lng]);
}
/** Recent path for one ride (admin map + anomaly review). */
async function ridePath(rideId, limit = 2000) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const { query } = await Promise.resolve().then(() => __importStar(require("../config/database")));
    return query(`SELECT lat, lng, recorded_at FROM ride_location_points
      WHERE ride_id = $1 ORDER BY recorded_at ASC LIMIT $2`, [rideId, limit]);
}
/**
 * Delete points past the retention window. Returns the number of rows
 * removed. Runs from the safety worker (daily) — one quiet query.
 */
async function purgeOldLocations() {
    try {
        await (0, safetyConfig_1.ensureSafetyTables)();
        const s = await (0, safetyConfig_1.getSafetySettings)();
        const r = await (0, database_1.execute)(`DELETE FROM ride_location_points
        WHERE recorded_at < NOW() - make_interval(days => $1::int)`, [s.location_retention_days]);
        return r.rowCount ?? 0;
    }
    catch {
        return 0;
    }
}
/** Last known point for a ride (check-in/SOS payload enrichment). */
async function lastRidePoint(rideId) {
    try {
        await (0, safetyConfig_1.ensureSafetyTables)();
        return await (0, database_1.queryOne)(`SELECT lat, lng, recorded_at FROM ride_location_points
        WHERE ride_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [rideId]);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=locationLog.js.map