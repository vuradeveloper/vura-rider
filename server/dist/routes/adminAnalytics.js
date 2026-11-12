"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/v2/analytics — the numbers behind the decisions.
//
// One call returns a whole operating picture for the chosen window (7/30/90
// days): money, demand, supply, funnel, zones, payments, cancellations,
// retention, forecast and plain-English insights. The admin screen renders it
// as a "control room" rather than a wall of tiles.
//
// Read-only. Every query degrades to an empty list on a missing table or
// column (older database), so analytics can never take the console down.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const database_1 = require("../config/database");
const adminAuth_1 = require("../services/adminAuth");
const analyticsAlerts_1 = require("../services/analyticsAlerts");
const router = (0, express_1.Router)();
const RANGES = [7, 30, 90];
function pct(part, whole) {
    if (!whole)
        return 0;
    return Math.round((part / whole) * 1000) / 10;
}
function delta(current, previous) {
    if (!previous)
        return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
}
router.get("/overview", (0, adminAuth_1.requireAdmin)("dashboard.read"), async (req, res) => {
    try {
        const days = RANGES.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
        const interval = `${days} days`;
        const prevInterval = `${days * 2} days`;
        // ── Headline money + volume (current window vs the one before it) ────────
        const totals = await (0, database_1.queryOne)(`SELECT
         COUNT(*)::int AS rides,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE status = 'no_drivers')::int AS no_drivers,
         COALESCE(SUM(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)) FILTER (WHERE status = 'completed'), 0) AS gmv,
         COALESCE(SUM(platform_fee) FILTER (WHERE status = 'completed'), 0) AS commission,
         COALESCE(SUM(COALESCE(booking_fee_cents, 0)::numeric / 100) FILTER (WHERE status = 'completed'), 0) AS booked_fee
       FROM rides WHERE created_at >= NOW() - $1::interval`, [interval]).catch(() => null);
        const previous = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS rides,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COALESCE(SUM(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)) FILTER (WHERE status = 'completed'), 0) AS gmv,
              COALESCE(SUM(platform_fee) FILTER (WHERE status = 'completed'), 0) AS commission
         FROM rides
        WHERE created_at >= NOW() - $1::interval AND created_at < NOW() - $2::interval`, [prevInterval, interval]).catch(() => null);
        // ── Daily series ─────────────────────────────────────────────────────────
        const daily = await (0, database_1.query)(`SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS rides,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              COALESCE(SUM(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)) FILTER (WHERE status = 'completed'), 0) AS gmv,
              COALESCE(SUM(platform_fee) FILTER (WHERE status = 'completed'), 0) AS commission
         FROM rides
        WHERE created_at >= NOW() - $1::interval
        GROUP BY 1 ORDER BY 1`, [interval]).catch(() => []);
        // ── Demand by hour (7 × 24 heatmap) + busiest slots ─────────────────────
        const hourly = await (0, database_1.query)(`SELECT EXTRACT(DOW FROM created_at)::int AS dow,
              EXTRACT(HOUR FROM created_at)::int AS hour,
              COUNT(*)::int AS rides
         FROM rides
        WHERE created_at >= NOW() - $1::interval
        GROUP BY 1, 2`, [interval]).catch(() => []);
        const dows = await (0, database_1.query)(`SELECT EXTRACT(DOW FROM created_at)::int AS dow,
              COUNT(*)::int AS rides,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM rides WHERE created_at >= NOW() - $1::interval
        GROUP BY 1 ORDER BY 1`, [interval]).catch(() => []);
        // ── Funnel ───────────────────────────────────────────────────────────────
        const funnelRow = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS requested,
              COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS matched,
              COUNT(*) FILTER (WHERE arrived_at IS NOT NULL)::int AS arrived,
              COUNT(*) FILTER (WHERE trip_started_at IS NOT NULL)::int AS started,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM rides WHERE created_at >= NOW() - $1::interval`, [interval]).catch(() => null);
        // ── Payment mix, cancellations, zones ───────────────────────────────────
        const payments = await (0, database_1.query)(`SELECT COALESCE(NULLIF(payment_method, ''), 'unknown') AS method,
              COUNT(*)::int AS rides,
              COALESCE(SUM(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)), 0) AS gmv
         FROM rides WHERE status = 'completed' AND created_at >= NOW() - $1::interval
        GROUP BY 1 ORDER BY rides DESC`, [interval]).catch(() => []);
        const cancellations = await (0, database_1.query)(`SELECT COALESCE(NULLIF(cancel_reason, ''), 'No reason given') AS reason, COUNT(*)::int AS count
         FROM rides WHERE status = 'cancelled' AND created_at >= NOW() - $1::interval
        GROUP BY 1 ORDER BY count DESC LIMIT 8`, [interval]).catch(() => []);
        const zones = await (0, database_1.query)(`SELECT COALESCE(NULLIF(SPLIT_PART(COALESCE(pickup_address, ''), ',', 1), ''), 'Unknown') AS area,
              COUNT(*)::int AS rides,
              COALESCE(SUM(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)), 0) AS gmv
         FROM rides WHERE status = 'completed' AND created_at >= NOW() - $1::interval
        GROUP BY 1 ORDER BY rides DESC LIMIT 10`, [interval]).catch(() => []);
        // ── Supply ───────────────────────────────────────────────────────────────
        const supply = await (0, database_1.queryOne)(`SELECT
         COUNT(*) FILTER (WHERE status IN ('available','on_trip'))::int AS online,
         COUNT(*) FILTER (WHERE status = 'available')::int AS available,
         COUNT(*) FILTER (WHERE status = 'on_trip')::int AS on_trip,
         COUNT(*) FILTER (WHERE status = 'break')::int AS break,
         COUNT(*) FILTER (WHERE status = 'offline' OR status IS NULL)::int AS offline,
         COUNT(*)::int AS total
       FROM driver_profiles`).catch(() => null);
        const activeDrivers = await (0, database_1.queryOne)(`SELECT
         (SELECT COUNT(DISTINCT driver_id)::int FROM rides
           WHERE status = 'completed' AND created_at >= NOW() - $1::interval) AS active,
         (SELECT COUNT(*)::int FROM users WHERE role = 'driver' AND created_at >= NOW() - $1::interval) AS new`, [interval]).catch(() => null);
        const newRiders = await (0, database_1.queryOne)(`SELECT
         (SELECT COUNT(*)::int FROM users WHERE role <> 'driver' AND created_at >= NOW() - $1::interval) AS new,
         (SELECT COUNT(DISTINCT passenger_id)::int FROM rides
           WHERE created_at >= NOW() - $1::interval AND passenger_id IS NOT NULL) AS active,
         (SELECT COUNT(*)::int FROM (
             SELECT passenger_id FROM rides
              WHERE created_at >= NOW() - $1::interval AND passenger_id IS NOT NULL
              GROUP BY passenger_id HAVING COUNT(*) > 1
          ) t) AS repeat`, [interval]).catch(() => null);
        // ── Platform health: payments + disputes ────────────────────────────────
        const paymentHealth = await (0, database_1.queryOne)(`SELECT
         COUNT(*) FILTER (WHERE status IN ('completed','paid','success'))::int AS paid,
         COUNT(*) FILTER (WHERE status IN ('pending','pending_payment','card_pending'))::int AS pending,
         COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))::int AS failed,
         COUNT(*) FILTER (WHERE status IN ('refunded','refund_pending'))::int AS refunded
       FROM payments WHERE created_at >= NOW() - $1::interval`, [interval]).catch(() => null);
        const disputes = await (0, database_1.queryOne)(`SELECT COUNT(*) FILTER (WHERE status IN ('open','in_review'))::int AS open,
              COUNT(*) FILTER (WHERE status IN ('resolved','declined'))::int AS resolved
         FROM disputes WHERE created_at >= NOW() - $1::interval`, [interval]).catch(() => null);
        // ── Top drivers (net earnings) ──────────────────────────────────────────
        const topDrivers = await (0, database_1.query)(`SELECT COALESCE(u.full_name, 'Driver') AS name,
              COUNT(*)::int AS rides,
              COALESCE(SUM(de.net_amount), 0) AS net,
              COALESCE(MAX(dp.rating_avg), 0) AS rating
         FROM driver_earnings de
         JOIN rides r ON r.id = de.ride_id
         LEFT JOIN users u ON u.id = de.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = de.driver_id
        WHERE r.created_at >= NOW() - $1::interval
        GROUP BY u.full_name ORDER BY net DESC LIMIT 8`, [interval]).catch(() => []);
        // ── Waiting time (driver arrived → trip started) ───────────────────────
        const waitTimes = await (0, database_1.query)(`SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day,
              COALESCE(AVG(EXTRACT(EPOCH FROM (trip_started_at - arrived_at)) / 60), 0) AS avg_minutes,
              COUNT(*)::int AS trips
         FROM rides
        WHERE created_at >= NOW() - $1::interval
          AND arrived_at IS NOT NULL AND trip_started_at IS NOT NULL
        GROUP BY 1 ORDER BY 1`, [interval]).catch(() => []);
        // ── No-driver requests by hour (lost sales) ────────────────────────────
        const noDriverHourly = await (0, database_1.query)(`SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count
         FROM rides
        WHERE status = 'no_drivers' AND created_at >= NOW() - $1::interval
        GROUP BY 1 ORDER BY 1`, [interval]).catch(() => []);
        // ── Driver earnings per completed trip (distribution) ──────────────────
        const earningsDist = await (0, database_1.query)(`WITH per_ride AS (
         SELECT de.driver_id, de.net_amount
           FROM driver_earnings de
           JOIN rides r ON r.id = de.ride_id
          WHERE r.created_at >= NOW() - $1::interval
       )
       SELECT CASE
                WHEN net_amount < 20 THEN 'Under R20'
                WHEN net_amount < 50 THEN 'R20–R50'
                WHEN net_amount < 100 THEN 'R50–R100'
                WHEN net_amount < 200 THEN 'R100–R200'
                ELSE 'R200+'
              END AS bucket,
              COUNT(DISTINCT driver_id)::int AS drivers
         FROM per_ride GROUP BY 1`, [interval]).catch(() => []);
        // ── Top riders (repeat demand) ─────────────────────────────────────────
        const topRiders = await (0, database_1.query)(`SELECT COALESCE(u.full_name, 'Rider') AS name,
              COUNT(*)::int AS rides,
              COALESCE(SUM(COALESCE(NULLIF(r.actual_fare, 0), r.estimated_fare, 0)), 0) AS gmv
         FROM rides r
         JOIN users u ON u.id = r.passenger_id
        WHERE r.status = 'completed' AND r.created_at >= NOW() - $1::interval
        GROUP BY u.id, u.full_name ORDER BY rides DESC LIMIT 8`, [interval]).catch(() => []);
        // ── Drivers at risk of churning (online but no trip for 7 days) ───────
        const churnRisk = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS count
         FROM driver_profiles dp
        WHERE dp.status IN ('available','break','offline')
          AND NOT EXISTS (
            SELECT 1 FROM rides r
             WHERE r.driver_id = dp.user_id AND r.status = 'completed'
               AND r.created_at >= NOW() - INTERVAL '7 days'
          )`).catch(() => null);
        // ── Zones with conversion, not just volume ─────────────────────────────
        const zonesDetail = await (0, database_1.query)(`SELECT COALESCE(NULLIF(SPLIT_PART(COALESCE(pickup_address, ''), ',', 1), ''), 'Unknown') AS area,
              COUNT(*)::int AS rides,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE status = 'no_drivers')::int AS no_drivers,
              COALESCE(SUM(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)) FILTER (WHERE status = 'completed'), 0) AS gmv,
              COALESCE(AVG(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)) FILTER (WHERE status = 'completed'), 0) AS avg_fare
         FROM rides WHERE created_at >= NOW() - $1::interval
        GROUP BY 1 HAVING COUNT(*) >= 3 ORDER BY rides DESC LIMIT 14`, [interval]).catch(() => []);
        // ── Assemble ────────────────────────────────────────────────────────────
        const t = totals || {};
        const gmv = Number(t.gmv || 0);
        const commission = Number(t.commission || 0);
        const bookingFee = Number(t.booked_fee || 0);
        const netRevenue = Math.round((commission + bookingFee) * 100) / 100;
        const completed = Number(t.completed || 0);
        const cancelled = Number(t.cancelled || 0);
        const noDrivers = Number(t.no_drivers || 0);
        const rides = Number(t.rides || 0);
        const settled = completed + cancelled + noDrivers;
        const avgFare = completed ? gmv / completed : 0;
        const takeRate = gmv ? (netRevenue / gmv) * 100 : 0;
        const prevGmv = Number(previous?.gmv || 0);
        const prevCompleted = Number(previous?.completed || 0);
        const prevCommission = Number(previous?.commission || 0);
        const funnelSteps = [
            { id: "requested", label: "Ride requests", count: Number(funnelRow?.requested || rides) },
            { id: "matched", label: "Driver matched", count: Number(funnelRow?.matched || 0) },
            { id: "arrived", label: "Driver arrived", count: Number(funnelRow?.arrived || 0) },
            { id: "started", label: "Trip started", count: Number(funnelRow?.started || 0) },
            { id: "completed", label: "Completed", count: Number(funnelRow?.completed || completed) },
        ].map((s, i, arr) => ({
            ...s,
            pct: pct(s.count, arr[0].count || 1),
            drop: i === 0 ? 0 : Math.max(0, arr[i - 1].count - s.count),
        }));
        const busiest = [...hourly]
            .sort((a, b) => b.rides - a.rides)
            .slice(0, 5)
            .map((h) => ({ dow: h.dow, hour: h.hour, rides: h.rides }));
        const avgDaily = daily.length ? gmv / daily.length : 0;
        const forecast = Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() + i + 1);
            const wobble = 0.86 + ((i * 37) % 23) / 100;
            return {
                date: d.toISOString().slice(0, 10),
                gmv: Math.round(avgDaily * wobble * 100) / 100,
            };
        });
        const insights = [];
        if (rides > 0) {
            const completion = pct(completed, settled || rides);
            insights.push({
                severity: completion >= 80 ? "good" : completion >= 65 ? "warn" : "bad",
                title: `Completion rate ${completion}%`,
                body: completion >= 80
                    ? "Dispatch and pricing are healthy for this window."
                    : "Too many requests end without a trip. Check supply at the busiest slots below.",
                metric: `${completed} of ${settled || rides}`,
            });
            const cancelPct = pct(cancelled, settled || rides);
            insights.push({
                severity: cancelPct <= 8 ? "good" : cancelPct <= 15 ? "warn" : "bad",
                title: `Cancellations ${cancelPct}%`,
                body: cancelPct <= 8
                    ? "Cancellation behaviour is inside a normal range."
                    : "Cancellations are above 8% — usually supply, pickup accuracy or wait time.",
                metric: `${cancelled} cancelled`,
            });
            if (noDrivers > 0) {
                insights.push({
                    severity: noDrivers / (settled || rides) <= 0.05 ? "warn" : "bad",
                    title: `${noDrivers} requests had no driver`,
                    body: "These are lost sales. They cluster by hour and area — use the heatmap to stage drivers.",
                    metric: `${pct(noDrivers, settled || rides)}% of settled`,
                });
            }
            const supplyNow = supply || {};
            const util = Number(supplyNow.online || 0) > 0 ? (Number(supplyNow.on_trip || 0) / Number(supplyNow.online)) * 100 : 0;
            insights.push({
                severity: util >= 55 ? "good" : util >= 30 ? "warn" : "bad",
                title: `Driver utilisation ${Math.round(util)}%`,
                body: util >= 55
                    ? "Supply is being used well right now."
                    : "Most online drivers are idle. Shift incentives to the busiest slots instead of broad bonuses.",
                metric: `${supplyNow.on_trip || 0} on trip · ${supplyNow.available || 0} free`,
            });
            insights.push({
                severity: takeRate >= 10 && takeRate <= 20 ? "good" : "warn",
                title: `Platform take rate ${Math.round(takeRate * 10) / 10}%`,
                body: takeRate > 20
                    ? "Above the R5-cap model. Check booking-fee or commission drift."
                    : "Within the R5-capped commission plus 4% booking-fee model.",
                metric: `R${netRevenue.toFixed(2)} of R${gmv.toFixed(2)}`,
            });
        }
        res.json({
            range: { days, from: new Date(Date.now() - days * 864e5).toISOString(), to: new Date().toISOString() },
            generated_at: new Date().toISOString(),
            headline: {
                gmv: Math.round(gmv * 100) / 100,
                net_revenue: netRevenue,
                commission: Math.round(commission * 100) / 100,
                booking_fee: Math.round(bookingFee * 100) / 100,
                rides,
                completed,
                cancelled,
                no_drivers: noDrivers,
                completion_rate: pct(completed, settled || rides),
                cancellation_rate: pct(cancelled, settled || rides),
                avg_fare: Math.round(avgFare * 100) / 100,
                take_rate: Math.round(takeRate * 10) / 10,
                deltas: {
                    gmv: delta(gmv, prevGmv),
                    completed: delta(completed, prevCompleted),
                    net_revenue: delta(netRevenue, prevCommission),
                },
            },
            daily,
            hourly,
            dows,
            funnel: funnelSteps,
            payments,
            cancellations,
            zones,
            supply: supply || { online: 0, available: 0, on_trip: 0, break: 0, offline: 0, total: 0 },
            active_drivers: activeDrivers || { active: 0, new: 0 },
            riders: newRiders || { new: 0, active: 0, repeat: 0 },
            payment_health: paymentHealth || { paid: 0, pending: 0, failed: 0, refunded: 0 },
            disputes: disputes || { open: 0, resolved: 0 },
            top_drivers: topDrivers,
            busiest,
            forecast,
            insights,
            wait_times: waitTimes,
            no_driver_hourly: noDriverHourly,
            earnings_distribution: earningsDist,
            top_riders: topRiders,
            churn_risk: Number(churnRisk?.count || 0),
            zones_detail: zonesDetail,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── Alerts: the Control Room talking back ─────────────────────────────────
router.get("/alerts", (0, adminAuth_1.requireAdmin)("dashboard.read"), async (_req, res) => {
    try {
        res.json({ alerts: await (0, analyticsAlerts_1.listAlerts)(80), recipients: (0, analyticsAlerts_1.alertRecipients)() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post("/alerts/scan", (0, adminAuth_1.requireAdmin)("dashboard.read"), async (_req, res) => {
    try {
        const created = await (0, analyticsAlerts_1.runAnalyticsScan)();
        res.json({ ok: true, created });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post("/alerts/test", (0, adminAuth_1.requireAdmin)("dashboard.read"), async (req, res) => {
    try {
        const actor = req.adminActor?.email ||
            req.admin?.email ||
            req.adminEmail ||
            "an admin";
        const out = await (0, analyticsAlerts_1.sendTestAnalyticsEmail)(String(actor));
        res.json(out);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=adminAnalytics.js.map