"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/v2/app-versions — who is actually running which build?
//
// Why this exists: Play/App Store update at their own pace, and a driver on an
// old APK will not see a new UI until the store pushes it. Ops needs a list of
// exactly who is behind so they can send the Play link to those drivers instead
// of guessing.
//
// Read-only. Uses user_sessions.app_version, which both apps already send on
// session start and every heartbeat.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const database_1 = require("../config/database");
const adminAuth_1 = require("../services/adminAuth");
const router = (0, express_1.Router)();
/** Versions we consider current. Override with env without a code change. */
const LATEST = {
    driver: process.env.DRIVER_LATEST_VERSION || "1.8.18",
    rider: process.env.RIDER_LATEST_VERSION || "1.5.25",
};
const STORE = {
    driver: process.env.DRIVER_STORE_URL || "https://play.google.com/store/apps/details?id=app.vura.driver",
    rider: process.env.RIDER_STORE_URL || "https://play.google.com/store/apps/details?id=app.vura.rider",
};
function olderThan(version, latest) {
    if (!version || version === "unknown")
        return true;
    const a = version.split(".").map((n) => Number(n) || 0);
    const b = latest.split(".").map((n) => Number(n) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0;
        const y = b[i] || 0;
        if (x !== y)
            return x < y;
    }
    return false;
}
router.get("/", (0, adminAuth_1.requireAdmin)("drivers.read"), async (_req, res) => {
    try {
        const dist = await (0, database_1.query)(`SELECT COALESCE(NULLIF(s.app, ''), CASE WHEN u.role = 'driver' THEN 'driver' ELSE 'rider' END) AS app,
              COALESCE(NULLIF(s.app_version, ''), 'unknown') AS version,
              COALESCE(NULLIF(s.platform, ''), 'unknown') AS platform,
              COUNT(DISTINCT s.user_id)::int AS users,
              MAX(s.last_seen_at) AS last_seen
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.revoked_at IS NULL
          AND s.last_seen_at > NOW() - INTERVAL '60 days'
        GROUP BY 1, 2, 3
        ORDER BY users DESC`).catch(() => []);
        const drivers = await (0, database_1.query)(`SELECT u.id, u.full_name AS name, u.email,
              dp.status,
              s.app_version AS version, s.platform,
              s.last_seen_at AS last_seen, s.device_name AS device
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.role = 'driver'
          AND s.revoked_at IS NULL
          AND s.last_seen_at > NOW() - INTERVAL '30 days'
        ORDER BY s.last_seen_at DESC`).catch(() => []);
        const driversOutdated = drivers
            .filter((d) => olderThan(d.version, LATEST.driver))
            .map((d) => ({
            ...d,
            // Mask the address for the list; ops can open the driver profile for full details.
            email: d.email ? String(d.email).replace(/^(.).*(@.*)$/, "$1***$2") : null,
        }));
        const counts = await (0, database_1.queryOne)(`SELECT COUNT(DISTINCT s.user_id) FILTER (WHERE u.role = 'driver')::int AS drivers,
              COUNT(DISTINCT s.user_id) FILTER (WHERE u.role <> 'driver')::int AS riders
         FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.revoked_at IS NULL AND s.last_seen_at > NOW() - INTERVAL '30 days'`).catch(() => null);
        res.json({
            latest: LATEST,
            store: STORE,
            totals: {
                drivers_seen_30d: Number(counts?.drivers || 0),
                riders_seen_30d: Number(counts?.riders || 0),
                drivers_outdated: driversOutdated.length,
            },
            distribution: dist,
            drivers_outdated: driversOutdated,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=adminAppVersions.js.map