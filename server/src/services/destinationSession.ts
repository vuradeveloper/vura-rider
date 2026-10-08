// ─────────────────────────────────────────────────────────────────────────────
// DESTINATION SESSION SERVICE — activate / change / cancel / status (§8.1):
//   • max 2 activations per driver per day, bucketed 00:00 SAST
//     (destination_sessions.sast_day — the timezone lives in SQL, never JS)
//   • activation only while online and NOT on a trip
//   • reject activation inside 1 km: "You're already close"
//   • changing destination mid-mode = a NEW use (old end_reason='changed')
//   • cancelling pushes the driver the reason (fixture L7b)
//   • a non-overlapping sweep auto-ends arrived/offline/3h-timeout sessions
//     (fixtures L7a/L7c/L7d) and pushes the reason
//   • state lives in the database → survives crash/reconnect
// Every activation/termination is also written to destination_events (audit).
// ─────────────────────────────────────────────────────────────────────────────
import { query, execute } from "../config/database";
import { getDestinationConfig, DestinationConfig, getConfig } from "./config";
import { haversineKm } from "../lib/h3";
import { sendPushToUsers } from "./notify";
import { bump } from "./metrics";

export interface DestinationStatus {
  active: boolean;
  label: string | null;
  lat: number | null;
  lng: number | null;
  /** Sessions started today (SAST), including 'changed' ones — Q1/Q6. */
  uses_today: number;
  max_uses: number;
  /** "Going to [place] - 1 of 2 uses today" while active, else null. */
  banner: string | null;
  expires_at: string | null;
  sast_day: string;
}

export type ActivateErrorCode =
  | "disabled"
  | "invalid_coordinates"
  | "not_found"
  | "not_online"
  | "on_trip"
  | "already_close"
  | "daily_limit"
  | "internal";

export type ActivateResult =
  | { ok: true; status: DestinationStatus }
  | { ok: false; error: ActivateErrorCode; message: string };

/**
 * Service error → HTTP status (REST transport contract, §8.1/f). Lives HERE,
 * next to the code union, so routes/drivers.ts cannot drift: the unit test
 * asserts this record covers every ActivateErrorCode exactly once. State
 * conflicts are 409s, daily quota is 429, flag-off is 403.
 */
export const DESTINATION_ERROR_HTTP_STATUS: Record<ActivateErrorCode, number> = {
  disabled: 403,
  invalid_coordinates: 400,
  not_found: 404,
  not_online: 409,
  on_trip: 409,
  already_close: 409,
  daily_limit: 429,
  internal: 500,
};

export interface SetDestinationInput {
  lat: unknown;
  lng: unknown;
  label: unknown;
}

interface ActiveSession {
  id: string;
  label: string;
  lat: number;
  lng: number;
  expires_at: string | null;
}

const fail = (error: ActivateErrorCode, message: string): ActivateResult => ({
  ok: false,
  error,
  message,
});

async function loadActive(driverId: string): Promise<ActiveSession | null> {
  const rows = await query<ActiveSession>(
    `SELECT id, label, lat, lng, destination_expires_at AS expires_at
       FROM destination_sessions
      WHERE driver_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`,
    [driverId]
  );
  return rows[0] ?? null;
}

/** Count + SAST day from ONE query: the daily bucket is computed by the DB. */
async function usageToday(driverId: string): Promise<{ uses: number; sastDay: string }> {
  const rows = await query<{ n: string | number; sast_day: string }>(
    `SELECT COUNT(*)::int AS n,
            to_char(now() AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS sast_day
       FROM destination_sessions
      WHERE driver_id = $1
        AND sast_day = (now() AT TIME ZONE 'Africa/Johannesburg')::date`,
    [driverId]
  );
  return { uses: Number(rows[0]?.n ?? 0), sastDay: String(rows[0]?.sast_day ?? "") };
}

async function logEvent(
  driverId: string,
  event: string,
  detail: Record<string, unknown>
): Promise<void> {
  await execute(
    `INSERT INTO destination_events (driver_id, event, detail) VALUES ($1, $2, $3)`,
    [driverId, event, JSON.stringify(detail)]
  ).catch((err) => console.warn(`[destination] event log failed (${event}):`, err?.message));
}

async function buildStatus(
  driverId: string,
  cfg: DestinationConfig,
  active: ActiveSession | null
): Promise<DestinationStatus> {
  const { uses, sastDay } = await usageToday(driverId);
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
    sast_day: sastDay,
  };
}

/**
 * Set (or change) the driver's destination — one session per use.
 * Idempotent for the SAME destination; a different one closes the old session
 * as 'changed' and opens a new one (counts as a new use, §8.1).
 */
export async function activateDestination(
  driverId: string,
  input: SetDestinationInput
): Promise<ActivateResult> {
  try {
    const cfg = await getDestinationConfig();
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
    if (
      !label ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return fail("invalid_coordinates", "A destination label and valid coordinates are required");
    }

    const profs = await query<{
      is_online: boolean;
      status: string | null;
      current_lat: number | null;
      current_lng: number | null;
    }>(
      `SELECT is_online, status, current_lat, current_lng
         FROM driver_profiles WHERE user_id = $1`,
      [driverId]
    );
    const prof = profs[0];
    if (!prof) return fail("not_found", "Driver profile not found");
    if (!prof.is_online) return fail("not_online", "Go online to set a destination");
    if (prof.status !== "available") return fail("on_trip", "Finish the current trip first");

    // Q1: reject when already within the radius ("You're already close").
    // No known position ⇒ nothing to prove close — allow (matching itself
    // stays fail-closed on position age).
    if (prof.current_lat != null && prof.current_lng != null) {
      const d = haversineKm(Number(prof.current_lat), Number(prof.current_lng), lat, lng);
      if (d <= cfg.destination_reject_radius_km) {
        return fail("already_close", "You're already close");
      }
    }

    const { uses, sastDay } = await usageToday(driverId);
    if (uses >= cfg.destination_max_activations_per_day) {
      return fail(
        "daily_limit",
        `Daily limit reached — ${cfg.destination_max_activations_per_day} uses today (${sastDay})`
      );
    }

    const active = await loadActive(driverId);
    if (
      active &&
      active.label === label &&
      Math.abs(Number(active.lat) - lat) < 1e-6 &&
      Math.abs(Number(active.lng) - lng) < 1e-6
    ) {
      // Same destination again → idempotent, no extra use burned.
      return { ok: true, status: await buildStatus(driverId, cfg, active) };
    }

    if (active) {
      // §8.1: changing destination mid-mode = a NEW use.
      const closed = await execute(
        `UPDATE destination_sessions SET ended_at = NOW(), end_reason = 'changed'
          WHERE id = $1 AND ended_at IS NULL`,
        [active.id]
      );
      if (closed?.rowCount) await logEvent(driverId, "ended", { reason: "changed", to: label });
    }

    await execute(
      `UPDATE driver_profiles
          SET destination_lat = $1, destination_lng = $2, destination_label = $3,
              destination_set_at = NOW(),
              destination_expires_at = NOW() + make_interval(secs => $4::double precision),
              updated_at = NOW()
        WHERE user_id = $5`,
      [lat, lng, label, cfg.destination_timeout_hours * 3600, driverId]
    );
    await execute(
      `INSERT INTO destination_sessions (driver_id, lat, lng, label)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [driverId, lat, lng, label]
    );
    await logEvent(driverId, "activated", { label, lat, lng, uses_today: uses + 1 });
    bump("destination_activated");

    // Build the status from what we just wrote (not a re-read): the label must
    // be the NEW one even though the session row was inserted microseconds ago.
    return {
      ok: true,
      status: await buildStatus(driverId, cfg, {
        id: "(new)",
        label,
        lat,
        lng,
        expires_at: new Date(Date.now() + cfg.destination_timeout_hours * 3_600_000).toISOString(),
      }),
    };
  } catch (err: any) {
    console.warn("[destination] activate failed:", err?.message || err);
    return fail("internal", "Destination service error — try again");
  }
}

/** Turn the mode off (fixture L7b: the driver gets a push stating why). Idempotent. */
export async function clearDestination(
  driverId: string
): Promise<{ ok: true; status: DestinationStatus }> {
  try {
    const cfg = await getDestinationConfig();
    let active = await loadActive(driverId);
    if (active) {
      const closed = await execute(
        `UPDATE destination_sessions SET ended_at = NOW(), end_reason = 'cancelled'
          WHERE id = $1 AND ended_at IS NULL`,
        [active.id]
      );
      if (closed?.rowCount) {
        await execute(
          `UPDATE driver_profiles
              SET destination_lat = NULL, destination_lng = NULL, destination_label = NULL,
                  destination_set_at = NULL, destination_expires_at = NULL, updated_at = NOW()
            WHERE user_id = $1`,
          [driverId]
        ).catch(() => undefined);
        await logEvent(driverId, "ended", { reason: "cancelled" });
        void sendPushToUsers([driverId], {
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
  } catch (err: any) {
    console.warn("[destination] clear failed:", err?.message || err);
    const cfg = await getDestinationConfig(true);
    return { ok: true, status: await buildStatus(driverId, cfg, null) };
  }
}

/** Banner/status for the driver app (DB-persisted — survives reconnects). */
export async function getDestinationStatus(driverId: string): Promise<DestinationStatus> {
  const cfg = await getDestinationConfig();
  return buildStatus(driverId, cfg, await loadActive(driverId));
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-END SWEEP (§8.1 end triggers / fixtures L7a, L7c, L7d)
//
// The session cannot end itself — something must WATCH for arrival, going
// offline and the 3h timeout. This runs from offerWorker's ~30s hygiene slot
// (the same cadence as Module 1's stale-index eviction) and carries its own
// non-overlap guard: if a previous sweep is still running, the second call
// returns 0 instead of racing the first one's UPDATEs.
//
// One row ends for exactly ONE reason: each session is classified once with a
// fixed priority (arrived → offline → timeout_3h) and the close UPDATE carries
// `ended_at IS NULL`, so a concurrent driver-initiated clear wins the row
// first and this sweep skips push/counter/profile-wipe entirely (rowCount proof).
// ────────────────────────────────────────────────────────────────────────────

export type DestinationEndReason = "arrived" | "offline" | "timeout_3h";

/** Structural slice of socket.io's `io.to(room).emit(...)` — tests pass makeIo(). */
export interface DestinationEmitTarget {
  to(room: string): { emit(event: string, payload: unknown): unknown };
}

interface SweepRow {
  id: string;
  driver_id: string;
  lat: number;
  lng: number;
  label: string;
  expires_at: string | Date | null;
  current_lat: number | null;
  current_lng: number | null;
  last_location_at: string | Date | null;
  last_heartbeat_at: string | Date | null;
  is_online: boolean | null;
  status: string;
  firebase_uid: string | null;
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
export function classifyDestinationEnd(
  row: SweepRow,
  destCfg: DestinationConfig,
  mainCfg: { max_position_age_seconds: number }
): DestinationEndReason | null {
  if (
    row.current_lat != null &&
    row.current_lng != null &&
    row.last_location_at != null &&
    Date.now() - new Date(row.last_location_at).getTime() <=
      mainCfg.max_position_age_seconds * 1000 &&
    haversineKm(row.current_lat, row.current_lng, row.lat, row.lng) <=
      destCfg.destination_arrival_radius_km
  ) {
    return "arrived";
  }
  // L7c (revised): END only on an EXPLICIT offline action — driver:online=false
  // or the 15-min safety timeout, both set is_online=false — or when no
  // heartbeat/location has arrived for destination_offline_grace_seconds
  // (default 300 s). A short socket drop only demotes status to 'offline'
  // while is_online stays true; ending there would kill a working session and
  // burn a daily use on a tunnel. Null timestamps (pathological row) fail
  // OPEN: never 'offline' on missing data — arrival/timeout still end it.
  if (row.is_online === false) return "offline";
  const lastSeenMs = Math.max(
    row.last_location_at ? new Date(row.last_location_at).getTime() : 0,
    row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0
  );
  if (
    lastSeenMs > 0 &&
    Date.now() - lastSeenMs > destCfg.destination_offline_grace_seconds * 1000
  ) {
    return "offline";
  }
  // L7d: the 3h clock written at activation. A NULL expiry (row written before
  // 002 ran) never times out — failing OPEN so a legacy row is never mass-ended.
  if (row.expires_at != null && new Date(row.expires_at).getTime() <= Date.now()) {
    return "timeout_3h";
  }
  return null;
}

const END_COPY: Record<DestinationEndReason, string> = {
  arrived: "You've arrived at your destination, so destination mode ended.",
  offline: "You went offline, so destination mode ended.",
  timeout_3h: "Your 3 hour destination mode limit was reached.",
};

let sweeping = false;

/**
 * Close every session that has hit an end condition. Returns how many were
 * ended by THIS run (0 also when a run was skipped by the guard).
 */
export async function sweepDestinationSessionsOnce(
  io: DestinationEmitTarget
): Promise<number> {
  if (sweeping) return 0; // a run is already in flight — never overlap
  sweeping = true;
  try {
    const destCfg = await getDestinationConfig();
    const mainCfg = await getConfig();
    const rows = await query<SweepRow>(
      `SELECT ds.id, ds.driver_id, ds.lat, ds.lng, ds.label,
              ds.destination_expires_at AS expires_at,
              dp.current_lat, dp.current_lng, dp.last_location_at,
              dp.last_heartbeat_at,
              dp.is_online, COALESCE(dp.status, 'offline') AS status,
              u.firebase_uid
         FROM destination_sessions ds
         JOIN driver_profiles dp ON dp.user_id = ds.driver_id
         JOIN users u ON u.id = ds.driver_id
        WHERE ds.ended_at IS NULL`
    );
    let ended = 0;
    for (const row of rows) {
      const reason = classifyDestinationEnd(row, destCfg, mainCfg);
      if (!reason) continue;
      const closed = await execute(
        `UPDATE destination_sessions
            SET ended_at = NOW(), end_reason = $2
          WHERE id = $1 AND ended_at IS NULL`,
        [row.id, reason]
      );
      if (!closed?.rowCount) continue; // someone else closed it first — their win
      await execute(
        `UPDATE driver_profiles
            SET destination_lat = NULL, destination_lng = NULL, destination_label = NULL,
                destination_set_at = NULL, destination_expires_at = NULL, updated_at = NOW()
          WHERE user_id = $1`,
        [row.driver_id]
      ).catch(() => undefined);
      await logEvent(row.driver_id, "ended", { reason, via: "sweep", to: row.label });
      bump("destination_ended");
      ended += 1;
      console.log(
        `[destination] sweep ended session ${row.id} driver=${row.driver_id} reason=${reason}`
      );
      if (row.firebase_uid) {
        io.to(`user:${row.firebase_uid}`).emit("driver:destination:ended", { reason });
      }
      void sendPushToUsers([row.driver_id], {
        type: "destination_mode_ended",
        title: "Destination mode ended",
        body: END_COPY[reason],
        highPriority: true,
        data: { reason },
      }).catch(() => undefined);
    }
    return ended;
  } catch (err: any) {
    // Never let a sweep failure kill the worker loop.
    console.warn("[destination] sweep failed:", err?.message || err);
    return 0;
  } finally {
    sweeping = false;
  }
}

