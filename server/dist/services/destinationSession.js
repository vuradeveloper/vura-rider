"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESTINATION_ERROR_HTTP_STATUS = void 0;
exports.activateDestination = activateDestination;
exports.clearDestination = clearDestination;
exports.getDestinationStatus = getDestinationStatus;
exports.noteDestinationTripCompleted = noteDestinationTripCompleted;
exports.classifyDestinationEnd = classifyDestinationEnd;
exports.onDriverPingPosition = onDriverPingPosition;
exports.sweepDestinationSessionsOnce = sweepDestinationSessionsOnce;
// ─────────────────────────────────────────────────────────────────────────────
// DESTINATION SESSION SERVICE — activate / change / cancel / status (§8.1):
//   • max 2 activations per driver per day, bucketed 00:00 SAST
//     (destination_sessions.sast_day — the timezone lives in SQL, never JS)
//   • activation only while online and NOT on a trip
//   • reject activation inside 1 km: "You're already close"
//   • changing destination mid-mode = a NEW use (old end_reason='changed')
//   • cancelling pushes the driver the reason (fixture L7b)
//   • a non-overlapping sweep auto-ends arrived/offline/idle-timeout sessions
//     (fixtures L7a/L7c/L7d) and pushes the reason; the idle clock
//     (destination_max_minutes_without_trip, default 180 min) RESETS on every
//     completed trip via noteDestinationTripCompleted, which also bumps the
//     session's trips_completed
//   • state lives in the database → survives crash/reconnect
// Every activation/termination is also written to destination_events (audit).
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const config_1 = require("./config");
const h3_1 = require("../lib/h3");
const notify_1 = require("./notify");
const metrics_1 = require("./metrics");
/**
 * Service error → HTTP status (REST transport contract, §8.1/f). Lives HERE,
 * next to the code union, so routes/drivers.ts cannot drift: the unit test
 * asserts this record covers every ActivateErrorCode exactly once. State
 * conflicts are 409s, daily quota is 429, flag-off is 403.
 */
exports.DESTINATION_ERROR_HTTP_STATUS = {
    disabled: 403,
    invalid_coordinates: 400,
    not_found: 404,
    not_online: 409,
    on_trip: 409,
    already_close: 409,
    daily_limit: 429,
    internal: 500,
};
const fail = (error, message) => ({
    ok: false,
    error,
    message,
});
async function loadActive(driverId) {
    const rows = await (0, database_1.query)(`SELECT id, label, lat, lng, destination_expires_at AS expires_at
       FROM destination_sessions
      WHERE driver_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`, [driverId]);
    return rows[0] ?? null;
}
/** Count + SAST day from ONE query: the daily bucket is computed by the DB. */
async function usageToday(driverId) {
    const rows = await (0, database_1.query)(`SELECT COUNT(*)::int AS n,
            to_char(now() AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS sast_day
       FROM destination_sessions
      WHERE driver_id = $1
        AND sast_day = (now() AT TIME ZONE 'Africa/Johannesburg')::date`, [driverId]);
    return { uses: Number(rows[0]?.n ?? 0), sastDay: String(rows[0]?.sast_day ?? "") };
}
async function logEvent(driverId, event, detail) {
    await (0, database_1.execute)(`INSERT INTO destination_events (driver_id, event, detail) VALUES ($1, $2, $3)`, [driverId, event, JSON.stringify(detail)]).catch((err) => console.warn(`[destination] event log failed (${event}):`, err?.message));
}
/** Shown while `paused` (status endpoint) — the same cause as the
 *  `feature_disabled` end reason, without the "ended" tail (not ended yet). */
const PAUSE_REASON = "Destination mode is turned off or no longer enabled for your account.";
async function buildStatus(driverId, cfg, active) {
    const { uses, sastDay } = await usageToday(driverId);
    const paused = !!active &&
        (!cfg.destination_matching_enabled ||
            !cfg.destination_rollout_driver_ids.includes(driverId));
    return {
        active: !!active,
        label: active?.label ?? null,
        lat: active ? Number(active.lat) : null,
        lng: active ? Number(active.lng) : null,
        uses_today: uses,
        max_uses: cfg.destination_max_activations_per_day,
        banner: active
            ? `Going to ${active.label} - ${Math.max(uses, 1)} of ${cfg.destination_max_activations_per_day} uses today`
            : null,
        expires_at: active?.expires_at ?? null,
        paused,
        pause_reason: paused ? PAUSE_REASON : null,
        sast_day: sastDay,
    };
}
/**
 * Set (or change) the driver's destination — one session per use.
 * Idempotent for the SAME destination; a different one closes the old session
 * as 'changed' and opens a new one (counts as a new use, §8.1).
 *
 * DOUBLE-ACTIVATION GUARD: the driver app's dual contract can deliver the SAME
 * tap twice — the socket leg plus, when its ack is late (4 s), the REST
 * fallback. The checks inside are read-then-write (loadActive → INSERT), so
 * two CONCURRENT calls could both see "no session" and both spend a daily use.
 * Activations are therefore serialized per driver: the second call waits, then
 * runs against the state the first one committed — identical coordinates hit
 * the idempotent same-destination path (one use, one session, the same answer
 * on both transports); different coordinates are processed as one ordered
 * 'changed'. The sequential late-REST case was already safe via that
 * idempotent path; this closes the concurrent window it creates.
 *
 * In-memory per process: correct for the current single-instance server (REST
 * + socket.io in one Node process). A multi-instance deploy needs a DB-level
 * guard instead (transaction-scoped advisory lock, or a partial unique index
 * on destination_sessions(driver_id) WHERE ended_at IS NULL).
 */
const activationChain = new Map();
function activateDestination(driverId, input) {
    const prev = activationChain.get(driverId) ?? Promise.resolve();
    const next = prev
        .catch(() => undefined) // a failed activation must never poison the chain
        .then(() => activateDestinationOnce(driverId, input));
    const tracked = next.finally(() => {
        if (activationChain.get(driverId) === tracked)
            activationChain.delete(driverId);
    });
    activationChain.set(driverId, tracked);
    return tracked;
}
async function activateDestinationOnce(driverId, input) {
    try {
        const cfg = await (0, config_1.getDestinationConfig)();
        if (!cfg.destination_matching_enabled) {
            return fail("disabled", "Destination mode is turned off");
        }
        // Q12: driver-keyed rollout — same machinery as Module 1. The matcher only
        // filters ALLOWLISTED drivers, so activating from outside the rollout would
        // put a "Looking for trips towards X" banner on a driver whose offers are
        // NOT filtered. `disabled` (403) until they are added — same answer as the
        // flag-off case, no new error code for the app to learn.
        if (!cfg.destination_rollout_driver_ids.includes(driverId)) {
            return fail("disabled", "Destination mode is not enabled for your account yet");
        }
        const lat = Number(input?.lat);
        const lng = Number(input?.lng);
        const label = String(input?.label ?? "").trim();
        if (!label ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180) {
            return fail("invalid_coordinates", "A destination label and valid coordinates are required");
        }
        const profs = await (0, database_1.query)(`SELECT is_online, status, current_lat, current_lng
         FROM driver_profiles WHERE user_id = $1`, [driverId]);
        const prof = profs[0];
        if (!prof)
            return fail("not_found", "Driver profile not found");
        if (!prof.is_online)
            return fail("not_online", "Go online to set a destination");
        if (prof.status !== "available")
            return fail("on_trip", "Finish the current trip first");
        // Q1: reject when already within the radius ("You're already close").
        // No known position ⇒ nothing to prove close — allow (matching itself
        // stays fail-closed on position age).
        if (prof.current_lat != null && prof.current_lng != null) {
            const d = (0, h3_1.haversineKm)(Number(prof.current_lat), Number(prof.current_lng), lat, lng);
            if (d <= cfg.destination_reject_radius_km) {
                return fail("already_close", "You're already close");
            }
        }
        const { uses, sastDay } = await usageToday(driverId);
        if (uses >= cfg.destination_max_activations_per_day) {
            return fail("daily_limit", `Daily limit reached — ${cfg.destination_max_activations_per_day} uses today (${sastDay})`);
        }
        const active = await loadActive(driverId);
        if (active &&
            active.label === label &&
            Math.abs(Number(active.lat) - lat) < 1e-6 &&
            Math.abs(Number(active.lng) - lng) < 1e-6) {
            // Same destination again → idempotent, no extra use burned.
            return { ok: true, status: await buildStatus(driverId, cfg, active) };
        }
        if (active) {
            // §8.1: changing destination mid-mode = a NEW use.
            const closed = await (0, database_1.execute)(`UPDATE destination_sessions SET ended_at = NOW(), end_reason = 'changed'
          WHERE id = $1 AND ended_at IS NULL`, [active.id]);
            if (closed?.rowCount)
                await logEvent(driverId, "ended", { reason: "changed", to: label });
        }
        await (0, database_1.execute)(`UPDATE driver_profiles
          SET destination_lat = $1, destination_lng = $2, destination_label = $3,
              destination_set_at = NOW(),
              destination_expires_at = NOW() + make_interval(mins => $4::double precision),
              updated_at = NOW()
        WHERE user_id = $5`, [lat, lng, label, cfg.destination_max_minutes_without_trip, driverId]);
        await (0, database_1.execute)(`INSERT INTO destination_sessions (driver_id, lat, lng, label, destination_expires_at)
       VALUES ($1, $2, $3, $4, NOW() + make_interval(mins => $5::double precision)) RETURNING id`, [driverId, lat, lng, label, cfg.destination_max_minutes_without_trip]);
        await logEvent(driverId, "activated", { label, lat, lng, uses_today: uses + 1 });
        (0, metrics_1.bump)("destination_activated");
        // Build the status from what we just wrote (not a re-read): the label must
        // be the NEW one even though the session row was inserted microseconds ago.
        return {
            ok: true,
            status: await buildStatus(driverId, cfg, {
                id: "(new)",
                label,
                lat,
                lng,
                expires_at: new Date(Date.now() + cfg.destination_max_minutes_without_trip * 60_000).toISOString(),
            }),
        };
    }
    catch (err) {
        console.warn("[destination] activate failed:", err?.message || err);
        return fail("internal", "Destination service error — try again");
    }
}
/** Turn the mode off (fixture L7b: the driver gets a push stating why). Idempotent. */
async function clearDestination(driverId) {
    try {
        const cfg = await (0, config_1.getDestinationConfig)();
        let active = await loadActive(driverId);
        if (active) {
            const closed = await (0, database_1.execute)(`UPDATE destination_sessions SET ended_at = NOW(), end_reason = 'cancelled'
          WHERE id = $1 AND ended_at IS NULL`, [active.id]);
            if (closed?.rowCount) {
                await (0, database_1.execute)(`UPDATE driver_profiles
              SET destination_lat = NULL, destination_lng = NULL, destination_label = NULL,
                  destination_set_at = NULL, destination_expires_at = NULL, updated_at = NOW()
            WHERE user_id = $1`, [driverId]).catch(() => undefined);
                await logEvent(driverId, "ended", { reason: "cancelled" });
                void (0, notify_1.sendPushToUsers)([driverId], {
                    type: "destination_mode_ended",
                    title: "Destination mode cancelled",
                    body: "You turned destination mode off.",
                    highPriority: true,
                    data: { reason: "cancelled" },
                }).catch(() => undefined);
                active = null; // WE closed it — status below must say so (rowCount = proof)
            }
        }
        return { ok: true, status: await buildStatus(driverId, cfg, active) };
    }
    catch (err) {
        console.warn("[destination] clear failed:", err?.message || err);
        const cfg = await (0, config_1.getDestinationConfig)(true);
        return { ok: true, status: await buildStatus(driverId, cfg, null) };
    }
}
/** Banner/status for the driver app (DB-persisted — survives reconnects). */
async function getDestinationStatus(driverId) {
    const cfg = await (0, config_1.getDestinationConfig)();
    return buildStatus(driverId, cfg, await loadActive(driverId));
}
/**
 * A COMPLETED trip (driver:ride:complete) does two things to the active
 * session, both row-guarded by `ended_at IS NULL`:
 *   1. trips_completed += 1  — the audit counter on the session row;
 *   2. the idle timer resets to NOW() + destination_max_minutes_without_trip
 *      on BOTH the session row (the sweep reads this one) and driver_profiles
 *      (the banner/status read this one).
 * Returns true only if an active session was touched. Fire-and-forget from the
 * socket handler: destination bookkeeping must never block or fail a ride.
 * A driver with no active session gets nothing — a completed trip does NOT
 * start a session or burn a daily use.
 */
async function noteDestinationTripCompleted(driverId, rideId) {
    try {
        const cfg = await (0, config_1.getDestinationConfig)();
        const updated = await (0, database_1.execute)(`UPDATE destination_sessions
          SET trips_completed = trips_completed + 1,
              destination_expires_at = NOW() + make_interval(mins => $3::double precision)
        WHERE driver_id = $1 AND ended_at IS NULL`, [driverId, rideId, cfg.destination_max_minutes_without_trip]);
        if (!updated?.rowCount)
            return false;
        await (0, database_1.execute)(`UPDATE driver_profiles
          SET destination_expires_at = NOW() + make_interval(mins => $2::double precision),
              updated_at = NOW()
        WHERE user_id = $1 AND destination_lat IS NOT NULL`, [driverId, cfg.destination_max_minutes_without_trip]).catch(() => undefined);
        await logEvent(driverId, "trip_completed", {
            ride_id: rideId,
            trips_completed_reset_minutes: cfg.destination_max_minutes_without_trip,
        });
        return true;
    }
    catch (err) {
        console.warn("[destination] trip-completed hook failed:", err?.message || err);
        return false;
    }
}
/**
 * One active session → the reason it must end, or null to keep it running.
 * Exported for unit tests: the precedence order and the freshness guard on the
 * arrival check are the two subtle bits.
 *
 * L7a (arrived) is only trusted with a GPS fix younger than
 * `max_position_age_seconds` (Module 1's position-age config): a phone parked
 * at the drop-off an hour ago has not "arrived", and ending on a stale
 * coordinate is how a working mode dies while the app sits in a pocket.
 */
function classifyDestinationEnd(row, destCfg, mainCfg) {
    // 4h-fix4: the ops action beats everything. Flag turned off, or the driver
    // removed from the rollout mid-session ⇒ end as 'feature_disabled' — checked
    // FIRST and needing NO fresh data, so a disabled feature can never be masked
    // by an arrival/offline/timeout signal (and a stale row cannot keep a
    // disabled mode alive until the timeout).
    if (!destCfg.destination_matching_enabled ||
        !destCfg.destination_rollout_driver_ids.includes(row.driver_id)) {
        return "feature_disabled";
    }
    if (row.current_lat != null &&
        row.current_lng != null &&
        row.last_location_at != null &&
        Date.now() - new Date(row.last_location_at).getTime() <=
            mainCfg.max_position_age_seconds * 1000 &&
        (0, h3_1.haversineKm)(row.current_lat, row.current_lng, row.lat, row.lng) <=
            destCfg.destination_arrival_radius_km) {
        return "arrived";
    }
    // L7c (revised): END only on an EXPLICIT offline action — driver:online=false
    // or the 15-min safety timeout, both set is_online=false — or when no
    // heartbeat/location has arrived for destination_offline_grace_seconds
    // (default 300 s). A short socket drop only demotes status to 'offline'
    // while is_online stays true; ending there would kill a working session and
    // burn a daily use on a tunnel. Null timestamps (pathological row) fail
    // OPEN: never 'offline' on missing data — arrival/timeout still end it.
    if (row.is_online === false)
        return "offline";
    const lastSeenMs = Math.max(row.last_location_at ? new Date(row.last_location_at).getTime() : 0, row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0);
    if (lastSeenMs > 0 &&
        Date.now() - lastSeenMs > destCfg.destination_offline_grace_seconds * 1000) {
        return "offline";
    }
    // L7d: the 3h clock written at activation. A NULL expiry (row written before
    // 002 ran) never times out — failing OPEN so a legacy row is never mass-ended.
    if (row.expires_at != null && new Date(row.expires_at).getTime() <= Date.now()) {
        return "timeout_3h";
    }
    return null;
}
const END_COPY = {
    arrived: "You've arrived at your destination, so destination mode ended.",
    offline: "You went offline, so destination mode ended.",
    timeout_3h: "Your 3 hour destination mode limit was reached.",
    feature_disabled: `${PAUSE_REASON} Your session has ended.`,
};
let sweeping = false;
/**
 * THE one way a session ends from server code (sweep, ping arrival, …):
 * row-guarded close + profile wipe + audit + counter + socket + push, in that
 * order, and ONLY for the caller whose `ended_at IS NULL` UPDATE won the row
 * (rowCount proof). Two racers (sweep vs ping) can both try; exactly one does
 * the side effects — one arrival, one push, one counter, one daily use.
 */
async function closeSession(io, row, reason, via, pushBody) {
    const closed = await (0, database_1.execute)(`UPDATE destination_sessions
        SET ended_at = NOW(), end_reason = $2
      WHERE id = $1 AND ended_at IS NULL`, [row.id, reason]);
    if (!closed?.rowCount)
        return false; // someone else closed it first — their win
    await (0, database_1.execute)(`UPDATE driver_profiles
        SET destination_lat = NULL, destination_lng = NULL, destination_label = NULL,
            destination_set_at = NULL, destination_expires_at = NULL, updated_at = NOW()
      WHERE user_id = $1`, [row.driver_id]).catch(() => undefined);
    await logEvent(row.driver_id, "ended", { reason, via, to: row.label });
    (0, metrics_1.bump)("destination_ended");
    console.log(`[destination] ${via} ended session ${row.id} driver=${row.driver_id} reason=${reason}`);
    if (row.firebase_uid) {
        io.to(`user:${row.firebase_uid}`).emit("driver:destination:ended", { reason });
    }
    void (0, notify_1.sendPushToUsers)([row.driver_id], {
        type: "destination_mode_ended",
        title: "Destination mode ended",
        body: pushBody ?? END_COPY[reason],
        highPriority: true,
        data: { reason },
    }).catch(() => undefined);
    return true;
}
/**
 * Arrival check on EVERY driver GPS ping (§8.1 L7a) — the sweep stays as the
 * backup. The socket handler only calls this when the profile row it just
 * UPDATEd still carries a destination (destination_lat IS NOT NULL), so the
 * extra indexed query (idx_destination_sessions_active) hits only drivers with
 * an active session — never the whole fleet.
 *
 * The ping itself is a fresh GPS fix, so no position-age guard is needed here
 * (unlike the sweep, which reads stored coordinates).
 */
async function onDriverPingPosition(io, driverId, lat, lng) {
    const rows = await (0, database_1.query)(`SELECT ds.id, ds.driver_id, ds.lat, ds.lng, ds.label, u.firebase_uid
       FROM destination_sessions ds
       JOIN users u ON u.id = ds.driver_id
      WHERE ds.driver_id = $1 AND ds.ended_at IS NULL
      LIMIT 1`, [driverId]);
    const row = rows[0];
    if (!row)
        return false; // stale destination flag on the profile — nothing to end
    const cfg = await (0, config_1.getDestinationConfig)();
    if ((0, h3_1.haversineKm)(lat, lng, Number(row.lat), Number(row.lng)) >
        cfg.destination_arrival_radius_km) {
        return false; // still driving towards it
    }
    return closeSession(io, row, "arrived", "ping");
}
/**
 * Close every session that has hit an end condition. Returns how many were
 * ended by THIS run (0 also when a run was skipped by the guard).
 */
async function sweepDestinationSessionsOnce(io) {
    if (sweeping)
        return 0; // a run is already in flight — never overlap
    sweeping = true;
    try {
        const destCfg = await (0, config_1.getDestinationConfig)();
        const mainCfg = await (0, config_1.getConfig)();
        const rows = await (0, database_1.query)(`SELECT ds.id, ds.driver_id, ds.lat, ds.lng, ds.label,
              ds.destination_expires_at AS expires_at,
              dp.current_lat, dp.current_lng, dp.last_location_at,
              dp.last_heartbeat_at,
              dp.is_online, COALESCE(dp.status, 'offline') AS status,
              u.firebase_uid
         FROM destination_sessions ds
         JOIN driver_profiles dp ON dp.user_id = ds.driver_id
         JOIN users u ON u.id = ds.driver_id
        WHERE ds.ended_at IS NULL`);
        let ended = 0;
        for (const row of rows) {
            const reason = classifyDestinationEnd(row, destCfg, mainCfg);
            if (!reason)
                continue;
            if (await closeSession(io, row, reason, "sweep"))
                ended += 1;
        }
        return ended;
    }
    catch (err) {
        // Never let a sweep failure kill the worker loop.
        console.warn("[destination] sweep failed:", err?.message || err);
        return 0;
    }
    finally {
        sweeping = false;
    }
}
//# sourceMappingURL=destinationSession.js.map