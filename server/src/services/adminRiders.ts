// ─────────────────────────────────────────────────────────────────────────────
// adminRiders — ADMIN V2 Phase 2: rider moderation (suspend/ban), internal
// notes, and the `rider_gate` enforcement helper.
//
// MODERATION MODEL: side table keyed on users.id — an absent row is 'active',
// so legacy riders are untouched. Transitions:
//   active ⇄ suspended (optional until) ⇄ banned ; banned → active only
//   (unban is deliberate: there is no accidental un-ban from a wrong button).
// Every transition writes rider_status_history + an admin_audit_log row.
//
// ENFORCEMENT: assertRiderCanBook() is the ONLY gate on ride requests, and it
// is a no-op unless app_config key `rider_gate` has enabled:true (seeded OFF).
// Same posture as driver_gate_enabled: record state now, enforce when ops
// flips the flag.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute, withTransaction } from "../config/database";

export const RIDER_STATUSES = ["active", "suspended", "banned"] as const;
export type RiderStatus = (typeof RIDER_STATUSES)[number];

export function isRiderStatus(v: unknown): v is RiderStatus {
  return typeof v === "string" && (RIDER_STATUSES as readonly string[]).includes(v);
}

/** Legal moderation transitions (server-authoritative). */
export const RIDER_TRANSITIONS: Record<RiderStatus, RiderStatus[]> = {
  active: ["suspended", "banned"],
  suspended: ["active", "banned"],
  banned: ["active"],
};

export function canModerate(from: string, to: string): boolean {
  if (!isRiderStatus(from) || !isRiderStatus(to)) return false;
  return RIDER_TRANSITIONS[from].includes(to);
}

export class RiderModerationError extends Error {
  constructor(
    public code: "not_found" | "illegal_transition" | "reason_required",
    message: string,
    public detail?: unknown
  ) {
    super(message);
  }
}

/**
 * Apply a moderation change. Writes rider_moderation (upsert) +
 * rider_status_history in ONE transaction; the caller writes the audit row.
 * Reason is REQUIRED for suspending/banning (reinstating needs none).
 */
export async function moderateRider(
  riderId: string,
  to: RiderStatus,
  actorEmail: string,
  opts: { reason?: string | null; until?: string | null } = {}
): Promise<{ from: RiderStatus; to: RiderStatus }> {
  const reason = opts.reason?.trim() || null;
  if (to !== "active" && !reason) {
    throw new RiderModerationError("reason_required", "A reason is required to suspend or ban");
  }
  return withTransaction(async (client) => {
    const cur = await client.query(
      `SELECT status FROM rider_moderation WHERE rider_id = $1 FOR UPDATE`,
      [riderId]
    );
    if (cur.rowCount === 0) {
      const rider = await client.query(`SELECT id FROM users WHERE id = $1`, [riderId]);
      if (rider.rowCount === 0) throw new RiderModerationError("not_found", "Rider not found");
    }
    const rawFrom = cur.rows[0] ? String(cur.rows[0].status) : "active";
    const from: RiderStatus = isRiderStatus(rawFrom) ? rawFrom : "active";
    if (from === to) return { from, to };
    if (!canModerate(from, to)) {
      throw new RiderModerationError("illegal_transition", `Cannot go from ${from} to ${to}`, {
        from,
        to,
        allowed: RIDER_TRANSITIONS[from],
      });
    }
    await client.query(
      `INSERT INTO rider_moderation (rider_id, status, reason, until, actor_email, updated_at)
       VALUES ($1, $2::varchar, $3, $4::timestamptz, $5, NOW())
       ON CONFLICT (rider_id) DO UPDATE
         SET status = EXCLUDED.status, reason = EXCLUDED.reason,
             until = EXCLUDED.until, actor_email = EXCLUDED.actor_email,
             updated_at = NOW()`,
      [riderId, to, reason, to === "suspended" ? opts.until || null : null, actorEmail]
    );
    await client.query(
      `INSERT INTO rider_status_history (rider_id, from_status, to_status, reason, actor_email)
       VALUES ($1, $2::varchar, $3::varchar, $4, $5)`,
      [riderId, from, to, reason, actorEmail]
    );
    return { from, to };
  });
}


/**
 * Rider list for the console. POPIA: phones masked at the API edge; search
 * matches name/email/phone. Moderation status is LEFT-JOINed (absent row =
 * active). Includes ride counts so support sees standing at a glance.
 */
export async function listRiders(opts: {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: any[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = [`u.role = 'passenger'`];
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim().toLowerCase()}%`);
    where.push(
      `(LOWER(COALESCE(u.full_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(u.email, '')) LIKE $${params.length})`
    );
  }
  if (opts.status && isRiderStatus(opts.status)) {
    params.push(opts.status);
    where.push(`COALESCE(rm.status, 'active') = $${params.length}::varchar`);
  }
  const whereSql = where.join(" AND ");
  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM users u LEFT JOIN rider_moderation rm ON rm.rider_id = u.id
      WHERE ${whereSql}`,
    params
  );
  params.push(limit, offset);
  const rows = await query(
    `SELECT u.id, u.full_name, u.email,
            CASE WHEN u.phone IS NULL OR u.phone = '' THEN '—'
                 ELSE LEFT(REPLACE(u.phone, ' ', ''), 3) || '***' ||
                      RIGHT(REPLACE(u.phone, ' ', ''), 4) END AS phone,
            u.created_at,
            COALESCE(rm.status, 'active') AS moderation_status,
            rm.reason AS moderation_reason, rm.until AS moderation_until,
            rm.updated_at AS moderation_updated_at,
            COUNT(ri.id) FILTER (WHERE ri.status = 'completed')::int AS rides_completed,
            COUNT(ri.id) FILTER (WHERE ri.status = 'cancelled')::int AS rides_cancelled,
            MAX(ri.completed_at) AS last_ride_at
       FROM users u
       LEFT JOIN rider_moderation rm ON rm.rider_id = u.id
       LEFT JOIN rides ri ON ri.passenger_id = u.id
      WHERE ${whereSql}
      GROUP BY u.id, rm.status, rm.reason, rm.until, rm.updated_at
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total: Number(countRow?.count || 0) };
}

/** One rider: full profile (phone/id NOT masked — reveal is audited), notes, history, stats. */
export async function getRider(riderId: string): Promise<any | null> {
  const rider = await queryOne(
    `SELECT u.id, u.full_name, u.email, u.phone, u.id_number,
            u.profile_photo_url, u.created_at,
            COALESCE(rm.status, 'active') AS moderation_status,
            rm.reason AS moderation_reason, rm.until AS moderation_until,
            rm.actor_email AS moderation_actor, rm.updated_at AS moderation_updated_at
       FROM users u
       LEFT JOIN rider_moderation rm ON rm.rider_id = u.id
      WHERE u.id = $1 AND u.role = 'passenger'`,
    [riderId]
  );
  if (!rider) return null;
  const stats = await queryOne(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            COALESCE(SUM(actual_fare) FILTER (WHERE status = 'completed'), 0)::numeric AS spend,
            MAX(completed_at) AS last_ride_at
       FROM rides WHERE passenger_id = $1`,
    [riderId]
  );
  const notes = await query(
    `SELECT id, note, actor_email, created_at FROM rider_notes
      WHERE rider_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [riderId]
  );
  const history = await query(
    `SELECT from_status, to_status, reason, actor_email, created_at
       FROM rider_status_history WHERE rider_id = $1
      ORDER BY created_at DESC LIMIT 20`,
    [riderId]
  );
  return { ...rider, stats, notes, history };
}

// ── Enforcement ───────────────────────────────────────────────────────────────

let gateCached: { enabled: boolean } | null = null;
let gateCachedAt = 0;
const GATE_CACHE_MS = 10_000;

/**
 * Is the rider gate armed? Reads app_config key `rider_gate` with a 10s cache;
 * a missing/unreadable row is OFF (safe-by-default, same as every other flag).
 */
export async function riderGateEnabled(force = false): Promise<boolean> {
  if (!force && gateCached && Date.now() - gateCachedAt < GATE_CACHE_MS) {
    return gateCached.enabled;
  }
  try {
    const row = await queryOne<{ value: any }>(
      `SELECT value FROM app_config WHERE key = 'rider_gate'`
    );
    gateCached = { enabled: row?.value?.enabled === true };
  } catch {
    gateCached = { enabled: false };
  }
  gateCachedAt = Date.now();
  return gateCached.enabled;
}

/**
 * The ONE booking gate: throws when the gate is armed and the rider is
 * suspended/banned (and any `until` has passed). With the flag OFF — the
 * seed — this is a single cached SELECT that always returns.
 */
export async function assertRiderCanBook(riderId: string): Promise<void> {
  if (!(await riderGateEnabled())) return;
  const row = await queryOne<{ status: string; until: string | null }>(
    `SELECT status, until FROM rider_moderation WHERE rider_id = $1`,
    [riderId]
  );
  if (!row || row.status === "active") return;
  // A suspension with a PAST `until` has expired → the rider books again
  // (state machine keeps the row until an admin actively resets it).
  if (row.status === "suspended" && row.until && new Date(row.until) <= new Date()) return;
  const err: any = new Error(
    row.status === "banned"
      ? "Your account is banned. Contact support."
      : "Your account is suspended. Contact support."
  );
  err.status = 403;
  throw err;
}

/** Add an internal note (write is audited by the route). */
export async function addRiderNote(riderId: string, note: string, actorEmail: string): Promise<void> {
  await execute(`INSERT INTO rider_notes (rider_id, note, actor_email) VALUES ($1, $2, $3)`, [
    riderId,
    note,
    actorEmail,
  ]);
}

