"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_THRESHOLDS = exports.TIER_RANK = void 0;
exports.tierDisplayName = tierDisplayName;
exports.loadThresholds = loadThresholds;
exports.evaluateTier = evaluateTier;
exports.sastTodayIso = sastTodayIso;
exports.addDaysIso = addDaysIso;
exports.daysUntilIso = daysUntilIso;
exports.computeTierStatus = computeTierStatus;
exports.setTierEmitTarget = setTierEmitTarget;
exports.recalculatePerformanceTiers = recalculatePerformanceTiers;
exports.runNightlyIfDue = runNightlyIfDue;
exports.startPerformanceTierScheduler = startPerformanceTierScheduler;
exports.stopPerformanceTierScheduler = stopPerformanceTierScheduler;
exports.breakTierTies = breakTierTies;
// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3 — PERFORMANCE TIER: nightly recalc, grace, history, pushes, and
// the equal-ETA matching tie-break.
//
// WHAT DECIDES A TIER (approved Module 3 spec):
//   • points       — COMPLETED rides inside the rolling window (1 per ride,
//                    v1 scoring; peak-hours multipliers are a later knob)
//   • rating_avg   — window AVG(ratings.score), falling back to the lifetime
//                    driver_profiles.rating_avg when the window has none
//   • accept %     — accepted / received offers (0 received => 0%)
//   • cancel %     — driver cancels / (completed + driver cancels)
//                    (nothing to cancel against => 0%)
// A driver qualifies for the HIGHEST tier whose ALL FOUR criteria are met;
// otherwise Bronze — the floor. Bronze's own row is display + commission data,
// not a gate.
//
// WINDOW: rolling performance_tier_window_days (90 default), re-anchored every
// recalc; the window written to driver_tiers is [today − N days, today] in
// SAST, INCLUSIVE on the start edge (events exactly at window_start count).
//
// CADENCE: nightly 02:00 SAST (performance_tier_recalc_hour_sast) with boot
// catch-up — if the server was down at 02:00, the first tick after boot runs
// it — and one performance_tier_runs row per SAST day so a double tick cannot
// run it twice. Manual trigger: POST /api/admin/performance-tiers/run.
//
// GRACE: a driver who stops qualifying KEEPS their tier for
// performance_tier_grace_days (7 default), flagged at_risk with ONE push; if
// still under-qualified when the grace window expires they are demoted
// (history + push). Promotions are immediate (history + push).
//
// SAFETY RULES (hard constraints):
//   • Everything is inert while performance_tier_enabled is false (the seed).
//   • Commission percentages are DISPLAY data only — this module never writes
//     fares, platform_fee or payments; it cannot move money.
//   • No new driver status: driver_profiles.status is never written here.
//   • findCandidatesHaversine (the legacy matching SQL) is untouched: the
//     tie-break lives in breakTierTies(), called only by the H3 path, only
//     when the flag is on, and it fails OPEN to the old order.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const config_1 = require("./config");
const notify_1 = require("./notify");
const trace_1 = require("./trace");
/** Ordering for "highest tier met" and the matching tie-break. */
exports.TIER_RANK = {
    bronze: 1,
    silver: 2,
    gold: 3,
    platinum: 4,
};
const TIER_DISPLAY = {
    bronze: "Bronze",
    silver: "Silver",
    gold: "Gold",
    platinum: "Platinum",
};
/** Canonical tier key -> the name the driver app displays. */
function tierDisplayName(tier) {
    return TIER_DISPLAY[tier] ?? "Bronze";
}
/** Migration 003's seed, as code — the fail-to-defaults when the table is absent. */
exports.DEFAULT_THRESHOLDS = [
    { tier: "bronze", display_name: "Bronze", rank: 1, min_points: 0, min_rating: 4.0, min_accept_percent: 0, max_cancel_percent: 20, commission_percent: 25 },
    { tier: "silver", display_name: "Silver", rank: 2, min_points: 150, min_rating: 4.6, min_accept_percent: 60, max_cancel_percent: 10, commission_percent: 22 },
    { tier: "gold", display_name: "Gold", rank: 3, min_points: 400, min_rating: 4.75, min_accept_percent: 70, max_cancel_percent: 6, commission_percent: 20 },
    { tier: "platinum", display_name: "Platinum", rank: 4, min_points: 800, min_rating: 4.85, min_accept_percent: 80, max_cancel_percent: 4, commission_percent: 18 },
];
/** Thresholds live in SQL (ops tunes with an UPDATE, no deploy); fall back to the seed. */
async function loadThresholds() {
    try {
        const rows = await (0, database_1.query)(`SELECT tier, display_name, rank, min_points, min_rating,
              min_accept_percent, max_cancel_percent, commission_percent
         FROM performance_tier_thresholds ORDER BY rank ASC`);
        if (!rows || rows.length === 0)
            return exports.DEFAULT_THRESHOLDS.map((t) => ({ ...t }));
        return rows.map((r) => ({
            tier: String(r.tier),
            display_name: String(r.display_name),
            rank: Number(r.rank),
            min_points: Number(r.min_points),
            min_rating: Number(r.min_rating),
            min_accept_percent: Number(r.min_accept_percent),
            max_cancel_percent: Number(r.max_cancel_percent),
            commission_percent: Number(r.commission_percent),
        }));
    }
    catch {
        // Before 003 runs (or after rollback) the table does not exist: thresholds
        // come from the code seed and the feature stays governed by the flag.
        return exports.DEFAULT_THRESHOLDS.map((t) => ({ ...t }));
    }
}
/**
 * PURE ALL-criteria rule: the HIGHEST tier whose points/rating/accept/cancel
 * are ALL met, else bronze (the floor). Unit-tested at every boundary.
 */
function evaluateTier(m, thresholds = exports.DEFAULT_THRESHOLDS) {
    const byRankDesc = [...thresholds].sort((a, b) => b.rank - a.rank);
    for (const t of byRankDesc) {
        if (m.points >= t.min_points &&
            m.rating_avg >= t.min_rating &&
            m.accept_percent >= t.min_accept_percent &&
            m.cancel_percent <= t.max_cancel_percent) {
            return t.tier;
        }
    }
    return "bronze";
}
/**
 * SAST calendar day as YYYY-MM-DD computed in JS. Africa/Johannesburg is
 * UTC+2 with NO DST since 1970, so the fixed offset is exact; SQL-side
 * equivalents use `now() AT TIME ZONE 'Africa/Johannesburg'` — same answer.
 */
function sastTodayIso(nowMs = Date.now()) {
    return new Date(nowMs + 2 * 3_600_000).toISOString().slice(0, 10);
}
/** ISO date + N days (pure date arithmetic; 'YYYY-MM-DD' parses as UTC midnight). */
function addDaysIso(isoDate, days) {
    const t = Date.parse(`${isoDate}T00:00:00Z`);
    if (!Number.isFinite(t))
        return isoDate;
    return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
/** Whole days from `todayIso` (SAST) until `isoDate`; negative = already past. */
function daysUntilIso(isoDate, todayIso = sastTodayIso()) {
    const a = Date.parse(`${isoDate}T00:00:00Z`);
    const b = Date.parse(`${todayIso}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b))
        return null;
    return Math.round((a - b) / 86_400_000);
}
/**
 * One round trip per driver: every window metric as of `windowStartIso`.
 *
 * Column notes (verified against the schema):
 *   • rides.completed_at / cancelled_at exist; COALESCE to created_at so a
 *     legacy row missing the timestamp still lands in SOME window.
 *   • rides.cancelled_by stores the cancelling user's id (the socket handlers
 *     write the actor's users.id) — the 'driver' literal covers any other path.
 *   • rating falls back to the lifetime driver_profiles.rating_avg when the
 *     window holds no ratings, so a fresh-but-loved driver is not zeroed.
 */
async function metricsFor(driverId, windowStartIso) {
    const rows = await (0, database_1.query)(`SELECT
       (SELECT COUNT(*) FROM rides
         WHERE driver_id = $1 AND status = 'completed'
           AND COALESCE(completed_at, created_at) >= $2)::int AS rides_completed,
       (SELECT COUNT(*) FROM rides
         WHERE driver_id = $1
           AND (cancelled_by = $1::text OR cancelled_by = 'driver')
           AND COALESCE(cancelled_at, created_at) >= $2)::int AS driver_cancels,
       (SELECT COUNT(*) FROM ride_offers
         WHERE driver_id = $1 AND created_at >= $2)::int AS offers_received,
       (SELECT COUNT(*) FROM ride_offers
         WHERE driver_id = $1 AND status = 'accepted' AND created_at >= $2)::int AS offers_accepted,
       (SELECT COUNT(*) FROM ride_offers
         WHERE driver_id = $1 AND status = 'expired' AND created_at >= $2)::int AS offers_timedout,
       COALESCE(
         (SELECT ROUND(AVG(rt.score)::numeric, 2) FROM ratings rt
           WHERE rt.driver_id = $1 AND rt.created_at >= $2),
         (SELECT rating_avg FROM driver_profiles WHERE user_id = $1),
         0)::float AS rating_avg`, [driverId, windowStartIso]);
    const r = rows?.[0] ?? {};
    const rides = Number(r.rides_completed ?? 0);
    const cancels = Number(r.driver_cancels ?? 0);
    const received = Number(r.offers_received ?? 0);
    const accepted = Number(r.offers_accepted ?? 0);
    const denom = rides + cancels;
    return {
        points: rides, // v1 scoring: one point per completed ride in the window
        rides_completed: rides,
        driver_cancels: cancels,
        offers_received: received,
        offers_accepted: accepted,
        offers_timedout: Number(r.offers_timedout ?? 0),
        accept_percent: received > 0 ? Math.round((accepted / received) * 10_000) / 100 : 0,
        cancel_percent: denom > 0 ? Math.round((cancels / denom) * 10_000) / 100 : 0,
        rating_avg: Math.round(Number(r.rating_avg ?? 0) * 100) / 100,
    };
}
function disabledStatus() {
    return {
        enabled: false,
        tier: null, display_name: null,
        points: null, rating_avg: null, accept_percent: null, cancel_percent: null,
        rides_completed: null, offers_received: null, offers_accepted: null,
        offers_timedout: null, driver_cancels: null, commission_percent: null,
        at_risk: false, demote_after: null, days_left: null,
        window_start: null, window_end: null,
        next_tier: null, missing: [], updated_at: null,
    };
}
/**
 * The read-only status the REST GET and the `driver:tier:status` socket event
 * both return. Two gates, one answer: `enabled:false` covers flag-off AND
 * outside-rollout — the app must not distinguish those reasons (same contract
 * as Module 2's destination banner, which reports paused for both causes).
 */
async function computeTierStatus(driverId) {
    const cfg = await (0, config_1.getPerformanceTierConfig)();
    if (!cfg.performance_tier_enabled)
        return disabledStatus();
    const wanted = String(driverId).toLowerCase();
    if (!cfg.performance_tier_rollout_driver_ids.some((id) => id.toLowerCase() === wanted)) {
        return disabledStatus();
    }
    const thresholds = await loadThresholds();
    const row = await (0, database_1.queryOne)(`SELECT tier, points, rating_avg, accept_percent, cancel_percent,
            rides_completed, offers_received, offers_accepted, offers_timedout,
            driver_cancels, window_start, window_end,
            at_risk, demote_after, last_eval_at
       FROM driver_tiers WHERE driver_id = $1`, [driverId]).catch(() => null);
    const current = String(row?.tier ?? "bronze") || "bronze";
    const currentRank = exports.TIER_RANK[current] ?? 1;
    const thFor = (t) => thresholds.find((x) => x.tier === t);
    const next = [...thresholds]
        .sort((a, b) => a.rank - b.rank)
        .find((t) => t.rank > currentRank) ?? null;
    // Gap list for `next_tier`: one string per unmet criterion, [] when the
    // driver already qualifies (or there is no next tier).
    const missing = [];
    if (next && row) {
        const pts = Number(row.points ?? 0);
        const rating = Number(row.rating_avg ?? 0);
        const accept = Number(row.accept_percent ?? 0);
        const cancel = Number(row.cancel_percent ?? 0);
        if (pts < next.min_points)
            missing.push(`points ${pts}/${next.min_points}`);
        if (rating < next.min_rating)
            missing.push(`rating ${rating.toFixed(2)}/${next.min_rating}`);
        if (accept < next.min_accept_percent)
            missing.push(`accept ${accept}%/${next.min_accept_percent}%`);
        if (cancel > next.max_cancel_percent)
            missing.push(`cancel ${cancel}%/≤${next.max_cancel_percent}%`);
    }
    const demoteAfter = row?.demote_after != null ? String(row.demote_after).slice(0, 10) : null;
    return {
        enabled: true,
        tier: current,
        display_name: tierDisplayName(current),
        points: Number(row?.points ?? 0),
        rating_avg: Number(row?.rating_avg ?? 0),
        accept_percent: Number(row?.accept_percent ?? 0),
        cancel_percent: Number(row?.cancel_percent ?? 0),
        rides_completed: Number(row?.rides_completed ?? 0),
        offers_received: Number(row?.offers_received ?? 0),
        offers_accepted: Number(row?.offers_accepted ?? 0),
        offers_timedout: Number(row?.offers_timedout ?? 0),
        driver_cancels: Number(row?.driver_cancels ?? 0),
        commission_percent: Number(thFor(current)?.commission_percent ?? 0),
        at_risk: !!row?.at_risk,
        demote_after: demoteAfter,
        days_left: row?.at_risk && demoteAfter ? daysUntilIso(demoteAfter) : null,
        window_start: row?.window_start != null ? String(row.window_start).slice(0, 10) : null,
        window_end: row?.window_end != null ? String(row.window_end).slice(0, 10) : null,
        next_tier: next
            ? {
                tier: next.tier,
                display_name: next.display_name,
                min_points: next.min_points,
                min_rating: Number(next.min_rating),
                min_accept_percent: Number(next.min_accept_percent),
                max_cancel_percent: Number(next.max_cancel_percent),
            }
            : null,
        missing,
        updated_at: row?.last_eval_at ? new Date(row.last_eval_at).toISOString() : null,
    };
}
/** Set by the scheduler; manual triggers reuse it so pushes still reach apps. */
let emitIo = null;
function setTierEmitTarget(io) {
    emitIo = io;
}
/** Promotion/demotion/at-risk: one push + one live socket event (best-effort). */
function notifyTierChange(kind, c, newTier, prevTier, demoteAfter, io) {
    const name = tierDisplayName(newTier);
    const prevName = tierDisplayName(prevTier);
    const msg = kind === "promotion"
        ? { type: "tier_promotion", title: `You're now ${name}!`, body: "Open your Tier screen to see what changed." }
        : kind === "demotion"
            ? { type: "tier_demotion", title: `Your tier is now ${name}`, body: `You held ${prevName} through the grace period. Keep your stats up to climb back.` }
            : { type: "tier_at_risk", title: `${prevName} tier at risk`, body: `Your stats no longer meet ${prevName}. Keep them up until ${demoteAfter ?? "the grace period ends"} to keep the tier.` };
    void (0, notify_1.sendPushToUsers)([c.driver_id], {
        ...msg,
        highPriority: false,
        data: { kind, tier: newTier, previous_tier: prevTier },
    });
    if (c.firebase_uid) {
        io?.to(`user:${c.firebase_uid}`).emit("driver:tier:changed", {
            tier: newTier,
            previous_tier: prevTier,
            at_risk: kind === "at_risk",
            demote_after: demoteAfter,
        });
    }
}
/** Upsert the full metrics snapshot + tier decision for one driver. */
async function upsertDriverTier(driverId, m, tier, windowStart, windowEnd, atRisk, demoteAfter, demotePending) {
    await (0, database_1.execute)(`INSERT INTO driver_tiers
       (driver_id, tier, points, rating_avg, accept_percent, cancel_percent,
        rides_completed, offers_received, offers_accepted, offers_timedout,
        driver_cancels, window_start, window_end,
        at_risk, demote_after, demote_pending_tier, last_eval_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
     ON CONFLICT (driver_id) DO UPDATE SET
       tier = EXCLUDED.tier, points = EXCLUDED.points,
       rating_avg = EXCLUDED.rating_avg, accept_percent = EXCLUDED.accept_percent,
       cancel_percent = EXCLUDED.cancel_percent,
       rides_completed = EXCLUDED.rides_completed,
       offers_received = EXCLUDED.offers_received,
       offers_accepted = EXCLUDED.offers_accepted,
       offers_timedout = EXCLUDED.offers_timedout,
       driver_cancels = EXCLUDED.driver_cancels,
       window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
       at_risk = EXCLUDED.at_risk, demote_after = EXCLUDED.demote_after,
       demote_pending_tier = EXCLUDED.demote_pending_tier,
       last_eval_at = NOW(), updated_at = NOW()`, [
        driverId, tier, m.points, m.rating_avg, m.accept_percent, m.cancel_percent,
        m.rides_completed, m.offers_received, m.offers_accepted, m.offers_timedout,
        m.driver_cancels, windowStart, windowEnd,
        atRisk, demoteAfter, demotePending,
    ]);
}
async function appendTierHistory(driverId, oldTier, newTier, reason, points) {
    await (0, database_1.execute)(`INSERT INTO driver_tier_history (driver_id, old_tier, new_tier, reason, points)
     VALUES ($1, $2, $3, $4, $5)`, [driverId, oldTier, newTier, reason, points]);
}
/** In-process overlap guard (EB is min=max=1; the run ledger is the DB guard). */
let recalcInProgress = false;
/**
 * The nightly/manual recalculation. Inert while the flag is off; the nightly
 * path additionally refuses to run twice per SAST day (partial unique index
 * on performance_tier_runs). Per-driver failures are logged and skipped — one
 * bad row must never abort the fleet.
 */
async function recalculatePerformanceTiers(opts, io) {
    const source = opts.source;
    const base = { ran: false, source, processed: 0, promoted: 0, demoted: 0, at_risk: 0 };
    const emit = io ?? emitIo;
    const cfg = await (0, config_1.getPerformanceTierConfig)();
    if (!cfg.performance_tier_enabled) {
        console.log("[tier] recalc skipped: performance_tier_enabled=false");
        return { ...base, reason: "flag_off" };
    }
    if (recalcInProgress)
        return { ...base, reason: "already_running" };
    recalcInProgress = true;
    let runId = null;
    const result = { ...base };
    try {
        // Run ledger: ON CONFLICT swallows the nightly double-run; manual rows are
        // not day-limited (deliberate operator action, still audited).
        const guard = await (0, database_1.query)(`INSERT INTO performance_tier_runs (run_date, trigger_source)
       VALUES (((now() AT TIME ZONE 'Africa/Johannesburg')::date), $1)
       ON CONFLICT DO NOTHING
       RETURNING id`, [source]).catch(() => []);
        if (source === "nightly" && (!guard || guard.length === 0)) {
            return { ...base, reason: "already_ran_today" };
        }
        runId = guard?.[0]?.id ?? null;
        const thresholds = await loadThresholds();
        const sastToday = sastTodayIso();
        const windowStart = addDaysIso(sastToday, -cfg.performance_tier_window_days);
        const windowEnd = sastToday;
        const graceDeadline = addDaysIso(sastToday, cfg.performance_tier_grace_days);
        // Fleet: drivers with any window activity OR an existing tier row (so an
        // inactive driver still gets re-evaluated for grace demotion).
        const candidates = await (0, database_1.query)(`SELECT u.id AS driver_id, u.firebase_uid
         FROM users u
         JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE EXISTS (SELECT 1 FROM ride_offers ro WHERE ro.driver_id = u.id AND ro.created_at >= $1)
           OR EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = u.id
                       AND COALESCE(r.completed_at, r.cancelled_at, r.created_at) >= $1)
           OR EXISTS (SELECT 1 FROM ratings rt WHERE rt.driver_id = u.id AND rt.created_at >= $1)
           OR EXISTS (SELECT 1 FROM driver_tiers dt WHERE dt.driver_id = u.id)`, [`${windowStart}T00:00:00.000Z`]);
        const prevRows = await (0, database_1.query)(`SELECT * FROM driver_tiers WHERE driver_id = ANY($1::uuid[])`, [candidates.map((c) => c.driver_id)]).catch(() => []);
        const prevBy = new Map((prevRows ?? []).map((r) => [r.driver_id, r]));
        for (const c of candidates) {
            try {
                const m = await metricsFor(c.driver_id, `${windowStart}T00:00:00.000Z`);
                const tier = evaluateTier(m, thresholds);
                const prev = prevBy.get(c.driver_id) ?? null;
                const prevTier = String(prev?.tier ?? "bronze") || "bronze";
                result.processed += 1;
                if (!prev) {
                    // First evaluation: record quietly — no history, no push.
                    await upsertDriverTier(c.driver_id, m, tier, windowStart, windowEnd, false, null, null);
                    continue;
                }
                const newRank = exports.TIER_RANK[tier] ?? 1;
                const prevRank = exports.TIER_RANK[prevTier] ?? 1;
                if (newRank > prevRank) {
                    // Promotion: immediate — grace only protects against LOSS.
                    await upsertDriverTier(c.driver_id, m, tier, windowStart, windowEnd, false, null, null);
                    await appendTierHistory(c.driver_id, prevTier, tier, "promotion", m.points);
                    notifyTierChange("promotion", c, tier, prevTier, null, emit);
                    result.promoted += 1;
                }
                else if (newRank < prevRank) {
                    if (!prev.demote_after) {
                        // Entering grace: keep the tier, flag at risk, ONE push.
                        await upsertDriverTier(c.driver_id, m, prevTier, windowStart, windowEnd, true, graceDeadline, tier);
                        notifyTierChange("at_risk", c, tier, prevTier, graceDeadline, emit);
                        result.at_risk += 1;
                    }
                    else if (sastToday > String(prev.demote_after).slice(0, 10)) {
                        // Grace expired: demote to the CURRENT computed tier (which may be
                        // lower than the first pending target — the honest number).
                        await upsertDriverTier(c.driver_id, m, tier, windowStart, windowEnd, false, null, null);
                        await appendTierHistory(c.driver_id, prevTier, tier, "demotion_grace_expired", m.points);
                        notifyTierChange("demotion", c, tier, prevTier, null, emit);
                        result.demoted += 1;
                    }
                    else {
                        // Still inside grace: refresh metrics; a WORSE pending target is
                        // tracked, the original deadline stands (grace is one window).
                        await upsertDriverTier(c.driver_id, m, prevTier, windowStart, windowEnd, true, String(prev.demote_after).slice(0, 10), tier);
                    }
                }
                else {
                    // Same tier. Recovery out of at-risk is silent; plain metric refresh.
                    await upsertDriverTier(c.driver_id, m, tier, windowStart, windowEnd, false, null, null);
                }
            }
            catch (err) {
                console.warn(`[tier] recalc failed for driver=${c.driver_id}:`, err?.message || err);
            }
        }
        if (runId) {
            await (0, database_1.execute)(`UPDATE performance_tier_runs SET finished_at = NOW(), drivers_processed = $2, status = 'done' WHERE id = $1`, [runId, result.processed]).catch(() => undefined);
        }
        result.ran = true;
        console.log(`[tier] recalc ${source} done: processed=${result.processed} promoted=${result.promoted} demoted=${result.demoted} at_risk=${result.at_risk}`);
        return result;
    }
    catch (err) {
        console.error(`[tier] recalc ${source} FAILED:`, err?.message || err);
        if (runId) {
            await (0, database_1.execute)(`UPDATE performance_tier_runs SET finished_at = NOW(), status = 'failed' WHERE id = $1`, [runId]).catch(() => undefined);
        }
        return { ...base, reason: "error" };
    }
    finally {
        recalcInProgress = false;
    }
}
// ── Nightly scheduler (02:00 SAST, boot catch-up) ────────────────────────────
let schedTimer = null;
/** 60s tick: cheap config+hour check; the run ledger stops double fires. */
const SCHED_TICK_MS = 60_000;
/**
 * Due check + run. Runs when the SAST hour has REACHED the configured hour —
 * that single condition gives both the 02:00 fire and the boot catch-up after
 * a 02:00 downtime; the performance_tier_runs row makes it once-per-day.
 */
async function runNightlyIfDue() {
    try {
        const cfg = await (0, config_1.getPerformanceTierConfig)();
        if (!cfg.performance_tier_enabled)
            return { ran: false, reason: "flag_off" };
        const hourRow = await (0, database_1.queryOne)(`SELECT EXTRACT(HOUR FROM now() AT TIME ZONE 'Africa/Johannesburg')::int AS sast_hour`).catch(() => null);
        const hour = Number(hourRow?.sast_hour ?? -1);
        if (!Number.isFinite(hour) || hour < cfg.performance_tier_recalc_hour_sast) {
            return { ran: false, reason: "not_due" };
        }
        const r = await recalculatePerformanceTiers({ source: "nightly" });
        return { ran: r.ran, reason: r.reason };
    }
    catch (err) {
        console.warn("[tier] nightly check failed:", err?.message || err);
        return { ran: false, reason: "error" };
    }
}
/** Start the 60s tick (idempotent) and remember `io` for tier-change events. */
function startPerformanceTierScheduler(io) {
    if (schedTimer)
        return schedTimer;
    setTierEmitTarget(io);
    schedTimer = setInterval(() => {
        void runNightlyIfDue();
    }, SCHED_TICK_MS);
    return schedTimer;
}
function stopPerformanceTierScheduler() {
    if (schedTimer)
        clearInterval(schedTimer);
    schedTimer = null;
    setTierEmitTarget(null);
}
/**
 * Module 3's one matching change: among candidates with the SAME road ETA,
 * the HIGHER performance tier is offered first. Strictly additive:
 *   • flag off (the seed) → the input is returned untouched (existing tests
 *     and production behave byte-identically);
 *   • flag on but no strict ETA tie exists → untouched, and the driver_tiers
 *     query is never issued (ties are the only case this can change);
 *   • flag on, tie exists, driver_tiers missing/unreadable → fail OPEN to the
 *     input order with one warning (003 not applied is not an outage);
 *   • sort is stable, so equal-tier ties keep pool order, and candidates with
 *     DIFFERENT etas can never swap.
 * Only the H3 path calls this (findCandidatesHaversine never reaches it).
 */
async function breakTierTies(pairs, rideId) {
    if (pairs.length < 2)
        return pairs;
    try {
        const cfg = await (0, config_1.getPerformanceTierConfig)();
        if (!cfg.performance_tier_enabled)
            return pairs;
        const byEta = [...pairs].sort((a, b) => a.eta - b.eta);
        let hasTie = false;
        for (let i = 1; i < byEta.length; i++) {
            if (byEta[i].eta === byEta[i - 1].eta) {
                hasTie = true;
                break;
            }
        }
        if (!hasTie)
            return pairs;
        const rows = await (0, database_1.query)(`SELECT user_id, tier FROM driver_tiers WHERE user_id = ANY($1::uuid[])`, [[...new Set(pairs.map((p) => p.row.id))]]);
        const rankOf = new Map((rows ?? []).map((r) => [r.user_id, exports.TIER_RANK[String(r.tier)] ?? 1]));
        // Missing row = never evaluated = bronze floor (rank 1).
        const rank = (id) => rankOf.get(id) ?? 1;
        const out = [...pairs].sort((a, b) => a.eta - b.eta || rank(b.row.id) - rank(a.row.id));
        (0, trace_1.trace)(rideId, "tier_tiebreak", {
            candidates: pairs.length,
            tier_rows: (rows ?? []).length,
        });
        return out;
    }
    catch (err) {
        console.warn(`[tier] tie-break skipped for ride=${rideId}:`, err?.message || err);
        return pairs;
    }
}
//# sourceMappingURL=performanceTier.js.map