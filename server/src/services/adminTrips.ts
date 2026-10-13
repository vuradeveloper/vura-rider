// ─────────────────────────────────────────────────────────────────────────────
// adminTrips — ADMIN V2 Phase 3: trip list/detail (read-only — no money
// actions), the live-map snapshot (online drivers + active rides), and the
// support inbox (tickets + replies).
//
// MONEY POSTURE: trips expose fares for DISPLAY only; there is no refund,
// adjust or payout action anywhere in this service or its routes.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute, isMissingRelation } from "../config/database";

/** Trip statuses the console filters on (mirrors rides.status values). */
export const TRIP_STATUSES = [
  "searching",
  "matched",
  "accepted",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export interface TripListOpts {
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Searchable trip list — rider/driver names, no raw contact data (list stays POPIA-light). */
export async function listTrips(opts: TripListOpts): Promise<{ rows: any[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = ["TRUE"];
  if (opts.status) {
    params.push(opts.status);
    where.push(`r.status = $${params.length}::varchar`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`r.created_at >= $${params.length}::timestamptz`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`r.created_at <= $${params.length}::timestamptz`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim().toLowerCase()}%`);
    where.push(
      `(LOWER(COALESCE(ru.full_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(du.full_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(r.pickup_address, '')) LIKE $${params.length}
        OR LOWER(COALESCE(r.destination_address, '')) LIKE $${params.length})`
    );
  }
  const whereSql = where.join(" AND ");
  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM rides r
       LEFT JOIN users ru ON ru.id = r.passenger_id
       LEFT JOIN users du ON du.id = r.driver_id
      WHERE ${whereSql}`,
    params
  );
  params.push(limit, offset);
  const rows = await query(
    `SELECT r.id, r.status, r.pickup_address, r.destination_address,
            r.distance_km, r.duration_mins, r.actual_fare, r.estimated_fare,
            r.payment_method, r.cancelled_by, r.cancel_reason,
            r.created_at, r.completed_at,
            ru.full_name AS rider_name, du.full_name AS driver_name,
            dp.license_plate AS driver_plate
       FROM rides r
       LEFT JOIN users ru ON ru.id = r.passenger_id
       LEFT JOIN users du ON du.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
      WHERE ${whereSql}
      ORDER BY r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total: Number(countRow?.count || 0) };
}

/** One trip: header + dispatch timeline (ride_events) + vehicle snapshot. */
export async function getTrip(rideId: string): Promise<any | null> {
  const trip = await queryOne(
    `SELECT r.*, ru.full_name AS rider_name, ru.email AS rider_email, ru.phone AS rider_phone,
            du.full_name AS driver_name, du.email AS driver_email, du.phone AS driver_phone
       FROM rides r
       LEFT JOIN users ru ON ru.id = r.passenger_id
       LEFT JOIN users du ON du.id = r.driver_id
      WHERE r.id = $1`,
    [rideId]
  );
  if (!trip) return null;
  const events = await query(
    `SELECT event, detail, created_at FROM ride_events
      WHERE ride_id = $1 ORDER BY id ASC LIMIT 500`,
    [rideId]
  );
  return { ...trip, events };
}

/**
 * Live-map snapshot: online drivers (position + vehicle) and active rides.
 * Positions are the last heartbeat from driver_profiles — no new tracking.
 */
export async function getLiveSnapshot(): Promise<{ drivers: any[]; rides: any[] }> {
  const drivers = await query(
    `SELECT dp.user_id AS id, u.full_name, dp.status, dp.current_lat, dp.current_lng,
            dp.last_location_at, dp.vehicle_make, dp.vehicle_model, dp.license_plate,
            dp.lifecycle_status
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
      WHERE dp.is_online = TRUE
      ORDER BY dp.last_location_at DESC NULLS LAST
      LIMIT 300`
  );
  const rides = await query(
    `SELECT r.id, r.status, r.pickup_lat, r.pickup_lng, r.destination_lat, r.destination_lng,
            r.driver_id, r.passenger_id, r.created_at
       FROM rides r
      WHERE r.status IN ('searching','matched','accepted','in_progress')
      ORDER BY r.created_at DESC
      LIMIT 300`
  );
  return { drivers, rides };
}

// ── Support inbox ─────────────────────────────────────────────────────────────

const TICKET_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short human-quotable reference, e.g. "VURA-7K2M4Q" (collision-retried). */
function makeReference(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += TICKET_REF_ALPHABET[Math.floor(Math.random() * TICKET_REF_ALPHABET.length)];
  }
  return `VURA-${s}`;
}

export interface TicketListOpts {
  status?: string;
  priority?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listTickets(opts: TicketListOpts): Promise<{ rows: any[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = ["TRUE"];
  if (opts.status) {
    params.push(opts.status);
    where.push(`t.status = $${params.length}::varchar`);
  }
  if (opts.priority) {
    params.push(opts.priority);
    where.push(`t.priority = $${params.length}::varchar`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim().toLowerCase()}%`);
    where.push(
      `(LOWER(COALESCE(t.subject, '')) LIKE $${params.length}
        OR LOWER(COALESCE(t.rider_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(t.rider_email, '')) LIKE $${params.length}
        OR LOWER(t.reference) LIKE $${params.length})`
    );
  }
  const whereSql = where.join(" AND ");
  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM support_tickets t WHERE ${whereSql}`,
    params
  );
  params.push(limit, offset);
  const rows = await query(
    `SELECT t.id, t.reference, t.subject, t.status, t.priority,
            t.rider_name, t.rider_email, t.rider_phone, t.ride_id,
            t.assignee_email, t.created_at, t.updated_at, t.resolved_at,
            (SELECT COUNT(*)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS messages
       FROM support_tickets t
      WHERE ${whereSql}
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
               t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total: Number(countRow?.count || 0) };
}

export async function getTicket(id: string): Promise<any | null> {
  const ticket = await queryOne(`SELECT * FROM support_tickets WHERE id = $1`, [id]);
  if (!ticket) return null;
  const messages = await query(
    `SELECT id, author_email, is_internal, message, created_at
       FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [id]
  );
  return { ...ticket, messages };
}

/** Create a ticket (reference retried on the astronomically-rare collision). */
export async function createTicket(
  input: {
    subject: string;
    body: string;
    priority?: string;
    rider_id?: string | null;
    driver_id?: string | null;
    rider_name?: string | null;
    rider_email?: string | null;
    rider_phone?: string | null;
    ride_id?: string | null;
  },
  authorEmail: string
): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = makeReference();
    try {
      const row = await queryOne(
        `INSERT INTO support_tickets
           (reference, subject, body, priority, rider_id, driver_id,
            rider_name, rider_email, rider_phone, ride_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          ref,
          input.subject,
          input.body,
          input.priority || "normal",
          input.rider_id || null,
          input.driver_id || null,
          input.rider_name || null,
          input.rider_email || null,
          input.rider_phone || null,
          input.ride_id || null,
        ]
      );
      await execute(
        `INSERT INTO support_ticket_messages (ticket_id, author_email, message)
         VALUES ($1, $2, $3)`,
        [row!.id, authorEmail, input.body]
      );
      return row;
    } catch (err: any) {
      if (err?.code === "23505" && attempt < 4) continue; // reference collision → retry
      throw err;
    }
  }
  throw new Error("Could not allocate a ticket reference");
}

export async function updateTicket(
  id: string,
  patch: { status?: string; priority?: string; assignee_email?: string | null }
): Promise<any | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (patch.status) {
    params.push(patch.status);
    sets.push(`status = $${params.length}::varchar`);
    if (patch.status === "resolved" || patch.status === "closed") {
      sets.push(`resolved_at = COALESCE(resolved_at, NOW())`);
    } else {
      sets.push(`resolved_at = NULL`);
    }
  }
  if (patch.priority) {
    params.push(patch.priority);
    sets.push(`priority = $${params.length}::varchar`);
  }
  if (patch.assignee_email !== undefined) {
    params.push(patch.assignee_email);
    sets.push(`assignee_email = $${params.length}`);
  }
  if (sets.length === 0) return getTicket(id);
  sets.push(`updated_at = NOW()`);
  await execute(`UPDATE support_tickets SET ${sets.join(", ")} WHERE id = $1`, params);
  return getTicket(id);
}

/** Append a reply (or an internal note) to the thread. */
export async function addTicketMessage(
  id: string,
  authorEmail: string,
  message: string,
  isInternal = false
): Promise<void> {
  await execute(
    `INSERT INTO support_ticket_messages (ticket_id, author_email, is_internal, message)
     VALUES ($1, $2, $3, $4)`,
    [id, authorEmail, isInternal, message]
  );
  await execute(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [id]);
}

/** Trip stats for the dashboard tile: counts by status over a window. */
export async function getTripStats(days = 7): Promise<any> {
  try {
    return await queryOne(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE status IN ('searching','matched','accepted','in_progress'))::int AS active,
              COALESCE(AVG(actual_fare) FILTER (WHERE status = 'completed'), 0)::numeric AS avg_fare,
              COALESCE(SUM(distance_km) FILTER (WHERE status = 'completed'), 0)::numeric AS km
         FROM rides
        WHERE created_at >= NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
  } catch (err: any) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}
