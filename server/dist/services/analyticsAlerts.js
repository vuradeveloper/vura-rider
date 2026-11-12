"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alertRecipients = alertRecipients;
exports.buildAlerts = buildAlerts;
exports.listAlerts = listAlerts;
exports.sendAlertEmail = sendAlertEmail;
exports.runAnalyticsScan = runAnalyticsScan;
exports.sendTestAnalyticsEmail = sendTestAnalyticsEmail;
exports.startAnalyticsAlertWorker = startAnalyticsAlertWorker;
// ─────────────────────────────────────────────────────────────────────────────
// Analytics alerts — the Control Room talks back.
//
// Every 30 minutes the server compares the last 24 hours (and 7 days) with the
// window before it. When something moves enough to matter — money up, money
// down, cancellations spiking, no-driver requests climbing, disputes piling up,
// payments failing — it writes an alert and emails it to the operations inbox:
//
//     info@ridevura.com, ridevura@gmail.com   (configurable)
//
// Each email answers three questions:
//   1. WHAT changed (metric, value, previous value, delta)
//   2. WHERE it changed (the zone with the most damage/upside)
//   3. WHAT to do about it (a concrete decision)
//
// Alerts are deduplicated per kind per day, so a running server cannot spam.
// Every write and every email attempt is stored in analytics_alerts, which the
// admin Control Room → Alerts page reads back.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const adminInvite_1 = require("./adminInvite");
const DEFAULTS = "info@ridevura.com,ridevura@gmail.com";
function alertRecipients() {
    const raw = (process.env.ANALYTICS_ALERTS_TO || DEFAULTS)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return raw.length ? raw : DEFAULTS.split(",");
}
async function ensureTable() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS analytics_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dedupe_key TEXT NOT NULL,
      kind VARCHAR(60) NOT NULL,
      severity VARCHAR(10) NOT NULL,
      title TEXT NOT NULL,
      metric TEXT NOT NULL,
      value TEXT NOT NULL,
      previous TEXT NOT NULL,
      delta TEXT NOT NULL,
      place TEXT NOT NULL,
      decision TEXT NOT NULL,
      email_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      email_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (dedupe_key)
    )
  `).catch(() => undefined);
    await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS idx_analytics_alerts_created ON analytics_alerts(created_at DESC)`).catch(() => undefined);
}
async function windowStats(since, until) {
    const r = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS rides,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            COUNT(*) FILTER (WHERE status = 'no_drivers')::int AS no_drivers,
            COALESCE(SUM(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0)) FILTER (WHERE status = 'completed'), 0) AS gmv,
            COALESCE(SUM(platform_fee) FILTER (WHERE status = 'completed'), 0) AS commission
       FROM rides
      WHERE created_at >= NOW() - $1::interval AND created_at < NOW() - $2::interval`, [since, until]).catch(() => null);
    const p = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS payments,
            COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))::int AS failed_payments
       FROM payments
      WHERE created_at >= NOW() - $1::interval AND created_at < NOW() - $2::interval`, [since, until]).catch(() => null);
    const d = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS disputes_open
       FROM disputes
      WHERE status IN ('open','in_review')
        AND created_at >= NOW() - $1::interval AND created_at < NOW() - $2::interval`, [since, until]).catch(() => null);
    return {
        rides: Number(r?.rides || 0),
        completed: Number(r?.completed || 0),
        cancelled: Number(r?.cancelled || 0),
        no_drivers: Number(r?.no_drivers || 0),
        gmv: Number(r?.gmv || 0),
        commission: Number(r?.commission || 0),
        failed_payments: Number(p?.failed_payments || 0),
        payments: Number(p?.payments || 0),
        disputes_open: Number(d?.disputes_open || 0),
    };
}
/** The zone where the change is concentrated (or the whole city). */
async function worstZone(since, kind) {
    const status = kind === "cancel" ? "cancelled" : "no_drivers";
    const row = await (0, database_1.queryOne)(`SELECT COALESCE(NULLIF(SPLIT_PART(COALESCE(pickup_address, ''), ',', 1), ''), 'Unknown') AS area,
            COUNT(*)::int AS n
       FROM rides
      WHERE status = $1 AND created_at >= NOW() - $2::interval
      GROUP BY 1 ORDER BY n DESC LIMIT 1`, [status, since]).catch(() => null);
    return row?.area && row.n > 0 ? row.area : "Johannesburg (all areas)";
}
function pctChange(current, previous) {
    if (!previous)
        return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
}
const money = (n) => "R" + new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(Math.round(n));
/** Build the alert candidates for the current moment. */
async function buildAlerts() {
    const now = await windowStats("24 hours", "0 seconds");
    const prev = await windowStats("48 hours", "24 hours");
    const week = await windowStats("7 days", "0 seconds");
    const prevWeek = await windowStats("14 days", "7 days");
    const today = new Date().toISOString().slice(0, 10);
    const out = [];
    const push = (c, key) => out.push({ ...c, dedupe: `${key}:${today}` });
    // ── Money ───────────────────────────────────────────────────────────────
    const gmvDelta = pctChange(now.gmv, prev.gmv);
    if (Math.abs(gmvDelta) >= 15 && (now.gmv > 0 || prev.gmv > 0)) {
        push({
            kind: "gmv",
            severity: gmvDelta >= 0 ? "good" : "bad",
            title: `Gross bookings ${gmvDelta >= 0 ? "up" : "down"} ${Math.abs(gmvDelta)}% in 24h`,
            metric: "Gross bookings (24h)",
            value: money(now.gmv),
            previous: money(prev.gmv),
            delta: `${gmvDelta >= 0 ? "+" : ""}${gmvDelta}%`,
            place: "Johannesburg",
            decision: gmvDelta >= 0
                ? "Demand is running hot. Make sure enough drivers are staged tonight so the extra requests do not turn into no-driver losses."
                : "Bookings fell. Check driver supply and any promo or pricing change before the evening peak; consider a targeted rider push.",
        }, "gmv");
    }
    // ── Completion ──────────────────────────────────────────────────────────
    const settledNow = now.completed + now.cancelled + now.no_drivers;
    const settledPrev = prev.completed + prev.cancelled + prev.no_drivers;
    const completionNow = settledNow ? (now.completed / settledNow) * 100 : 0;
    const completionPrev = settledPrev ? (prev.completed / settledPrev) * 100 : 0;
    if (settledNow >= 10 && Math.abs(completionNow - completionPrev) >= 5) {
        const worse = completionNow < completionPrev;
        push({
            kind: "completion",
            severity: worse ? (completionNow < 70 ? "bad" : "warn") : "good",
            title: `Completion rate ${worse ? "dropped" : "improved"} to ${completionNow.toFixed(1)}%`,
            metric: "Completion (24h)",
            value: `${completionNow.toFixed(1)}%`,
            previous: `${completionPrev.toFixed(1)}%`,
            delta: `${(completionNow - completionPrev).toFixed(1)} pts`,
            place: await worstZone("24 hours", "cancel"),
            decision: worse
                ? "Look at the zone above: late cancellations and no-driver requests usually mean supply is thin at the wrong hour."
                : "Keep the current staging pattern; it is converting more requests into completed trips.",
        }, "completion");
    }
    // ── Cancellations ───────────────────────────────────────────────────────
    const cancelNow = settledNow ? (now.cancelled / settledNow) * 100 : 0;
    const cancelPrev = settledPrev ? (prev.cancelled / settledPrev) * 100 : 0;
    if (settledNow >= 10 && Math.abs(cancelNow - cancelPrev) >= 3) {
        const worse = cancelNow > cancelPrev;
        push({
            kind: "cancellations",
            severity: worse ? (cancelNow > 15 ? "bad" : "warn") : "good",
            title: `Cancellations ${worse ? "up" : "down"} to ${cancelNow.toFixed(1)}%`,
            metric: "Cancellation rate (24h)",
            value: `${cancelNow.toFixed(1)}%`,
            previous: `${cancelPrev.toFixed(1)}%`,
            delta: `${(cancelNow - cancelPrev).toFixed(1)} pts`,
            place: worse ? await worstZone("24 hours", "cancel") : "Johannesburg",
            decision: worse
                ? "Check pickup accuracy and driver ETA in that area. If riders are cancelling after 2 minutes, the driver is arriving too late."
                : "Cancellation behaviour improved. Keep the pickup pins and ETA honest.",
        }, "cancellations");
    }
    // ── No-driver requests ──────────────────────────────────────────────────
    const noDriverDelta = pctChange(now.no_drivers, prev.no_drivers);
    if (now.no_drivers >= 5 && noDriverDelta >= 25) {
        push({
            kind: "no_drivers",
            severity: now.no_drivers >= 25 ? "bad" : "warn",
            title: `${now.no_drivers} requests had no driver in 24h`,
            metric: "Unmatched requests (24h)",
            value: String(now.no_drivers),
            previous: String(prev.no_drivers),
            delta: `+${noDriverDelta}%`,
            place: await worstZone("24 hours", "no_driver"),
            decision: "These are lost sales. Stage drivers in that area before the peak, or widen the dispatch radius for that zone.",
        }, "no_drivers");
    }
    // ── Payments ────────────────────────────────────────────────────────────
    const failRate = now.payments ? (now.failed_payments / now.payments) * 100 : 0;
    if (now.payments >= 10 && (failRate >= 8 || now.failed_payments >= 15)) {
        push({
            kind: "payments",
            severity: failRate >= 12 ? "bad" : "warn",
            title: `Payment failures at ${failRate.toFixed(1)}%`,
            metric: "Failed payments (24h)",
            value: `${now.failed_payments} of ${now.payments}`,
            previous: `${prev.failed_payments} of ${prev.payments}`,
            delta: `${failRate.toFixed(1)}%`,
            place: "Paystack / card rail",
            decision: "Check the Paystack dashboard for declines and webhook delivery, then review Reports → refunds for any rider stuck in card_pending.",
        }, "payments");
    }
    // ── Disputes ────────────────────────────────────────────────────────────
    if (now.disputes_open >= 5) {
        push({
            kind: "disputes",
            severity: now.disputes_open >= 12 ? "bad" : "warn",
            title: `${now.disputes_open} support cases opened in 24h`,
            metric: "Open disputes (24h)",
            value: String(now.disputes_open),
            previous: String(prev.disputes_open),
            delta: `${now.disputes_open - prev.disputes_open >= 0 ? "+" : ""}${now.disputes_open - prev.disputes_open}`,
            place: "Support queue",
            decision: "Open Reports & refunds and clear the queue before it ages. Recurring reasons should become a product fix, not a reply.",
        }, "disputes");
    }
    // ── 7-day view (one weekly signal, not noise) ───────────────────────────
    const weekGmv = pctChange(week.gmv, prevWeek.gmv);
    if (Math.abs(weekGmv) >= 20 && (week.gmv > 0 || prevWeek.gmv > 0)) {
        push({
            kind: "gmv_week",
            severity: weekGmv >= 0 ? "good" : "bad",
            title: `Weekly gross bookings ${weekGmv >= 0 ? "up" : "down"} ${Math.abs(weekGmv)}%`,
            metric: "Gross bookings (7d)",
            value: money(week.gmv),
            previous: money(prevWeek.gmv),
            delta: `${weekGmv >= 0 ? "+" : ""}${weekGmv}%`,
            place: "Johannesburg",
            decision: weekGmv >= 0
                ? "The week is trending up. Protect it: keep the Friday/Saturday supply plan and do not change pricing mid-week."
                : "The week is behind. Review the promo calendar and driver incentives; small supply gaps compound over seven days.",
        }, "gmv_week");
    }
    return out;
}
function emailHtml(a) {
    const color = a.severity === "good" ? "#137333" : a.severity === "warn" ? "#B26A00" : "#C5221F";
    const bg = a.severity === "good" ? "#E6F4EA" : a.severity === "warn" ? "#FFF7E6" : "#FEF3F2";
    const label = a.severity === "good" ? "GOOD NEWS" : a.severity === "warn" ? "WATCH" : "ACTION NEEDED";
    return `<!doctype html><html><body style="margin:0;background:#F4F1EC;font-family:Arial,Helvetica,sans-serif;color:#0B0B0C">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1EC;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E6E1DA">
        <tr><td style="background:#0B0B0C;padding:18px 24px">
          <span style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-.02em">VURA</span>
          <span style="color:#E1251B;font-size:10px;font-weight:800;letter-spacing:.22em;margin-left:10px">CONTROL ROOM</span>
        </td></tr>
        <tr><td style="padding:24px">
          <p style="margin:0 0 10px;font-size:10px;font-weight:800;letter-spacing:.18em;color:${color}">${label}</p>
          <h1 style="margin:0 0 6px;font-size:22px;line-height:1.25">${escape(a.title)}</h1>
          <p style="margin:0;color:#6B6560;font-size:12px">${new Date().toLocaleString("en-ZA")} · ${escape(a.place)}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:${bg};border:1px solid ${color}22">
            <tr>
              <td style="padding:12px 14px;font-size:11px;color:#6B6560">${escape(a.metric)}</td>
              <td style="padding:12px 14px;font-size:18px;font-weight:800;text-align:right">${escape(a.value)}</td>
            </tr>
            <tr>
              <td style="padding:0 14px 12px;font-size:11px;color:#6B6560">Previous</td>
              <td style="padding:0 14px 12px;font-size:12px;text-align:right;color:#6B6560">${escape(a.previous)}</td>
            </tr>
            <tr>
              <td style="padding:0 14px 12px;font-size:11px;color:#6B6560">Change</td>
              <td style="padding:0 14px 12px;font-size:13px;font-weight:800;text-align:right;color:${color}">${escape(a.delta)}</td>
            </tr>
          </table>

          <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:.16em;color:#8A837D">WHERE</p>
          <p style="margin:0 0 14px;font-size:14px;font-weight:700">${escape(a.place)}</p>

          <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:.16em;color:#8A837D">DECISION</p>
          <p style="margin:0 0 18px;font-size:13px;line-height:1.55;color:#2C2A28">${escape(a.decision)}</p>

          <a href="https://vura-admin-backoffice.pages.dev/#analytics" style="display:inline-block;background:#E1251B;color:#ffffff;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;padding:12px 18px">OPEN THE CONTROL ROOM</a>
        </td></tr>
        <tr><td style="padding:14px 24px;background:#FAF8F5;border-top:1px solid #E6E1DA;color:#8A837D;font-size:10px">
          Vura · Johannesburg · automated analytics alert. Change the recipients with ANALYTICS_ALERTS_TO.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
function escape(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
async function listAlerts(limit = 60) {
    await ensureTable();
    return (0, database_1.query)(`SELECT id, kind, severity, title, metric, value, previous, delta, place, decision,
            email_status, created_at
       FROM analytics_alerts ORDER BY created_at DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 200)]).catch(() => []);
}
async function sendAlertEmail(candidate) {
    const to = alertRecipients();
    const subject = `[Vura ${candidate.severity === "good" ? "▲" : candidate.severity === "warn" ? "!" : "▼"}] ${candidate.title}`;
    return (0, adminInvite_1.sendResendEmail)({ to: to.join(","), subject, html: emailHtml(candidate) });
}
/**
 * Run one scan. Safe to call repeatedly; dedupe is per kind per day.
 * Returns the alerts that were newly created.
 */
async function runAnalyticsScan(options = {}) {
    await ensureTable();
    const candidates = await buildAlerts();
    const created = [];
    for (const c of candidates) {
        const row = await (0, database_1.queryOne)(`INSERT INTO analytics_alerts
         (dedupe_key, kind, severity, title, metric, value, previous, delta, place, decision, email_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id, kind, severity, title, metric, value, previous, delta, place, decision, email_status, created_at`, [c.dedupe, c.kind, c.severity, c.title, c.metric, c.value, c.previous, c.delta, c.place, c.decision]).catch(() => null);
        if (!row)
            continue;
        if (options.email !== false) {
            const sent = await sendAlertEmail(c).catch((e) => ({ ok: false, error: String(e) }));
            await (0, database_1.execute)(`UPDATE analytics_alerts SET email_status = $2, email_error = $3 WHERE id = $1`, [row.id, sent.ok ? "sent" : "failed", sent.ok ? null : sent.error || "unknown"]).catch(() => undefined);
            row.email_status = sent.ok ? "sent" : "failed";
        }
        created.push(row);
    }
    return created;
}
/** Send a test email to both inboxes (admin button). */
async function sendTestAnalyticsEmail(actorEmail) {
    const to = alertRecipients();
    const sample = {
        dedupe: "test",
        kind: "test",
        severity: "good",
        title: "Test alert from the Vura Control Room",
        metric: "Alert delivery",
        value: "Working",
        previous: "—",
        delta: "—",
        place: "info@ridevura.com · ridevura@gmail.com",
        decision: `This is a test triggered by ${actorEmail}. If you can read this, analytics alerts are wired correctly.`,
    };
    const res = await (0, adminInvite_1.sendResendEmail)({
        to: to.join(","),
        subject: "[Vura ▲] Test alert from the Control Room",
        html: emailHtml(sample),
    });
    return { ok: res.ok, to, error: res.ok ? undefined : res.error };
}
/** Start the background worker. Interval in minutes via env (0 disables). */
function startAnalyticsAlertWorker() {
    const minutes = Number(process.env.ANALYTICS_ALERT_MINUTES ?? 30);
    if (!Number.isFinite(minutes) || minutes <= 0)
        return () => undefined;
    const every = Math.max(5, minutes) * 60_000;
    const tick = () => {
        void runAnalyticsScan().catch((e) => console.warn("[analytics-alerts] scan failed:", e?.message || e));
    };
    // First scan a minute after boot, so the server is settled.
    const first = setTimeout(tick, 60_000);
    const timer = setInterval(tick, every);
    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}
//# sourceMappingURL=analyticsAlerts.js.map