// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Dispatch service â€” status-driven ride matching.
//
// The database is the single source of truth; sockets and push are only delivery
// channels. Every step is logged to ride_events so you can see exactly where a
// flow broke: ride_requested -> candidates_found -> offer_sent -> offer_expired /
// offer_declined / ride_accepted / no_drivers.
//
// Flow:
//   1. rider requests        -> rides row (status 'searching') + startDispatch()
//   2. startDispatch()       -> offerToNextDriver(): closest FRESH available
//                               driver gets a ride_offers row (pending, +15s)
//                               + socket 'ride:offer'/'ride:request' + push
//   3. driver accepts        -> acceptRide(): ONE transaction, guarded UPDATE
//   4. decline / timeout     -> next closest driver (never the same one twice)
//   5. nobody left           -> rides.status = 'no_drivers' + rider notified
//
// The ride stays in 'searching' while an offer is out (the rider-facing apps and
// their notification labels already treat 'searching' as "finding your driver");
// the per-driver offer lifecycle lives in ride_offers.status.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { Server as SocketIOServer } from "socket.io";
import { query, queryOne, execute, withTransaction } from "../config/database";
import { sendPushToUsers } from "./notify";
import { attachVehicleImages } from "./vehicleImages";
import { trace, startTrace } from "./trace";
import { getConfig } from "./config";
import { getDriverIndex, MATCHABLE_STATUSES } from "./driverIndex";
import { cellsAround } from "../lib/h3";
import { etaMinutesList } from "./eta";

/** How long one driver has to answer before the ride moves on. */
export const OFFER_TTL_SECONDS = 15;
/** A driver is only a candidate if we heard from them this recently. */
export const LOCATION_FRESH_SECONDS = 20;
/** Stop offering after this many rounds so a ride can't churn forever. */
export const MAX_OFFER_ROUNDS = 12;
/** No location/heartbeat for this long while "available" => demote to offline. */
export const DRIVER_STALE_SECONDS = 20;

type OfferResult = { offered: boolean; driverId?: string; reason?: string };

/** Append one line to the dispatch trail (never throws). */
export async function logRideEvent(
  rideId: string | null,
  driverId: string | null,
  event: string,
  detail?: unknown
): Promise<void> {
  try {
    await execute(
      `INSERT INTO ride_events (ride_id, driver_id, event, detail) VALUES ($1, $2, $3, $4)`,
      [rideId, driverId, event, detail == null ? null : JSON.stringify(detail)]
    );
    console.log(
      `[dispatch] ${event}${rideId ? ` ride=${rideId}` : ""}${driverId ? ` driver=${driverId}` : ""}` +
        (detail ? ` ${JSON.stringify(detail)}` : "")
    );
  } catch (err: any) {
    console.warn("[dispatch] ride_events write failed:", err?.message);
  }
}

/** Emit to the ride room AND the user's personal room (survives reconnects). */
export function emitRide(
  io: SocketIOServer,
  rideId: string,
  event: string,
  payload: Record<string, unknown>,
  firebaseUid?: string | null
): void {
  io.to(`ride:${rideId}`).emit(event, payload);
  if (firebaseUid) io.to(`user:${firebaseUid}`).emit(event, payload);
}

export interface Candidate {
  id: string;
  firebase_uid: string | null;
  current_lat: number;
  current_lng: number;
  distance_km: number;
}

/**
 * Closest drivers who are: available, recently heard from, not already offered
 * this ride, not on another trip, and not the rider themselves.
 *
 * ── FLAG-OFF PATH (h3_matching_enabled = false) ──────────────────────────────
 * The SQL below is the ORIGINAL pre-Module-1 haversine query, byte-for-byte
 * unchanged. findCandidates() is the kill-switch wrapper that delegates here;
 * nothing in this function knows about H3, the driver index, blocks, rating or
 * vehicle filters. `git diff` on this file shows only the function name line
 * changed (findCandidates -> findCandidatesHaversine), not one line of the body.
 */
async function findCandidatesHaversine(
  rideId: string,
  pickupLat: number,
  pickupLng: number,
  limit = 3,
  ignorePreviousOffers = false
): Promise<Candidate[]> {
  return query<Candidate>(
    `SELECT u.id, u.firebase_uid, dp.current_lat, dp.current_lng,
            (6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians($2)) * cos(radians(dp.current_lat)) *
                cos(radians(dp.current_lng) - radians($3)) +
              sin(radians($2)) * sin(radians(dp.current_lat))
            )))) AS distance_km
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
      WHERE COALESCE(dp.status, CASE WHEN dp.is_online THEN 'available' ELSE 'offline' END) = 'available'
        AND dp.is_online = TRUE
        AND dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL
        AND GREATEST(COALESCE(dp.last_location_at, dp.updated_at),
                     COALESCE(dp.last_heartbeat_at, dp.updated_at))
            > NOW() - make_interval(secs => $4::double precision)
        AND u.id <> COALESCE((SELECT passenger_id FROM rides WHERE id = $1), '00000000-0000-0000-0000-000000000000'::uuid)
        AND ($6::boolean OR NOT EXISTS (SELECT 1 FROM ride_offers ro WHERE ro.ride_id = $1 AND ro.driver_id = u.id))
        AND NOT EXISTS (
              SELECT 1 FROM rides r
               WHERE r.driver_id = u.id
                 AND r.status IN ('accepted', 'driver_arrived', 'in_progress'))
      ORDER BY distance_km ASC
      LIMIT $5`,
    [rideId, pickupLat, pickupLng, LOCATION_FRESH_SECONDS, limit, ignorePreviousOffers]
  // NOTE ON ERROR HANDLING: a failed candidate query must NOT be turned into an
// empty list. Returning [] makes a database error indistinguishable from "no
// drivers nearby", and the rider is then told "no drivers available" for what is
// really a server fault. We surface it instead so the trace shows the difference.
  ).catch((err) => {
    trace(rideId, "candidates_query_failed", {
      error: err?.message ?? String(err),
    });
    console.error(`[dispatch] candidate query FAILED ride=${rideId}:`, err?.message || err);
    return [] as Candidate[];
  });
}

// ── MODULE 1: H3 candidate path (flag ON) ───────────────────────────────────
//
// The pool returned to offerToNextDriver. Bigger than `limit` (which the old
// path honours exactly) because the offer loop tries candidates in rank order
// until one INSERT sticks — a driver who already holds a pending offer for a
// different ride must not waste the whole round.
const H3_CANDIDATE_POOL = 20;

/**
 * How many 15s offer rounds fit inside search_timeout_ms (90s / 15s = 6).
 * Round maxRounds+1 returns zero candidates, offerToNextDriver parks the ride
 * and emits ride:no:drivers — so the rider-facing "no drivers" lands at ~90s,
 * not MAX_OFFER_ROUNDS * 15s = 180s. Capped by MAX_OFFER_ROUNDS so the flag-on
// path can never exceed the global churn guard either.
 */
export function h3MaxOfferRounds(cfg: {
  search_timeout_ms: number;
  offer_ttl_seconds: number;
}): number {
  const ttl = Math.max(1, cfg.offer_ttl_seconds || OFFER_TTL_SECONDS);
  const rounds = Math.floor(cfg.search_timeout_ms / (ttl * 1000));
  return Math.min(MAX_OFFER_ROUNDS, Math.max(1, rounds));
}

/**
 * Escalation ladder: rounds are spread evenly across match_radius_km, so with
 * [3,5,7] and a 6-round budget it is 3km -> rounds 1-2, 5km -> 3-4, 7km -> 5-6.
 * null past the budget = stop searching (caller reports no-drivers).
 */
export function radiusForRound(
  round: number,
  ladder: number[],
  maxRounds: number
): number | null {
  if (!Number.isFinite(round) || round > maxRounds) return null;
  const rungs = ladder.length > 0 ? ladder : [3];
  const idx = Math.min(
    rungs.length - 1,
    Math.floor(((Math.max(1, round) - 1) * rungs.length) / Math.max(1, maxRounds))
  );
  return rungs[idx];
}

/**
 * Matching entry point — the h3_matching_enabled kill-switch (one place).
 *
 *   flag OFF : the original haversine query above, completely unchanged.
 *   flag ON  : H3 cell lookup -> exact haversine <= radius -> eligibility
 *              filters (MATCHABLE_STATUSES from driverIndex, vehicle category,
 *              min rating, driver_blocks) -> rank by road ETA (haversine
 *              fallback) -> a ranked pool for the one-at-a-time offer loop.
 *
 * FAILURE POLICY: any throw anywhere in the H3 path (config, index, SQL, ETA)
 * is logged with an `h3_path_failed` trace stage and the request re-runs on the
 * haversine path. The rider is never left waiting and matching never fails
 * closed; an empty index (nobody pinged since boot) also falls back rather than
 * reporting a false "no drivers".
 */
export async function findCandidates(
  rideId: string,
  pickupLat: number,
  pickupLng: number,
  limit = 3,
  ignorePreviousOffers = false,
  round = 1
): Promise<Candidate[]> {
  let enabled = false;
  try {
    enabled = (await getConfig()).h3_matching_enabled;
  } catch (err: any) {
    enabled = false;
    console.warn(
      `[dispatch] config read failed, flag treated as OFF ride=${rideId}:`,
      err?.message || err
    );
  }
  if (!enabled) {
    return findCandidatesHaversine(rideId, pickupLat, pickupLng, limit, ignorePreviousOffers);
  }
  try {
    return await findCandidatesH3(
      rideId,
      pickupLat,
      pickupLng,
      limit,
      ignorePreviousOffers,
      round
    );
  } catch (err: any) {
    // NEVER fail silently, NEVER leave the rider waiting: say what broke, then
    // run the old path for this request.
    trace(rideId, "h3_path_failed", {
      round,
      error: err?.message ?? String(err),
    });
    console.error(
      `[dispatch] H3 path FAILED ride=${rideId} (falling back to haversine):`,
      err?.message || err
    );
    return findCandidatesHaversine(rideId, pickupLat, pickupLng, limit, ignorePreviousOffers);
  }
}

interface H3Row {
  id: string;
  firebase_uid: string | null;
  current_lat: number;
  current_lng: number;
  distance_km: number;
}

/** Flag-ON implementation. Throwing here is safe: findCandidates catches. */
async function findCandidatesH3(
  rideId: string,
  pickupLat: number,
  pickupLng: number,
  limit: number,
  ignorePreviousOffers: boolean,
  round: number
): Promise<Candidate[]> {
  const cfg = await getConfig();
  const maxRounds = h3MaxOfferRounds(cfg);
  const radiusKm = radiusForRound(round, cfg.match_radius_km, maxRounds);
  if (radiusKm == null) {
    // ~90s of searching: zero candidates makes offerToNextDriver park the ride
    // and emit ride:no:drivers — the rider-facing stop, no code path left open.
    trace(rideId, "h3_search_timeout", {
      round,
      max_rounds: maxRounds,
      search_timeout_ms: cfg.search_timeout_ms,
    });
    console.log(
      `[dispatch] H3 search budget exhausted ride=${rideId} round=${round}/${maxRounds} -> no drivers`
    );
    return [];
  }

  // 1. Cells that could contain a point within radiusKm. gridDisk gives
  //    CANDIDATES only — the exact haversine arrives in the SQL below.
  const { cells, k } = cellsAround(pickupLat, pickupLng, radiusKm, cfg.h3_match_res);

  // 2. Who the index thinks is in those cells, seen within stale_seconds.
  const index = getDriverIndex();
  const indexed = await index.getDriversInCells(cells, 500);
  const now = Date.now();
  const freshIds = indexed
    .filter((d) => {
      const seen = Date.parse(d.lastSeenAt);
      return Number.isFinite(seen) && now - seen <= cfg.stale_seconds * 1000;
    })
    .map((d) => d.userId);

  if (freshIds.length === 0) {
    // The index is empty for this area — usually "nobody pinged since boot" or
    // "migration not applied yet", NOT "no drivers exist". Falling back keeps
    // the rider served; the warn makes the deployment gap visible.
    trace(rideId, "h3_index_empty", { cells: cells.length, radius_km: radiusKm });
    console.warn(
      `[dispatch] H3 index has 0 fresh drivers ride=${rideId} cells=${cells.length} radius=${radiusKm}km; falling back to haversine`
    );
    return findCandidatesHaversine(rideId, pickupLat, pickupLng, limit, ignorePreviousOffers);
  }

  // 3. One offer per driver — enforced TWICE:
  //    a) here: pending offers for these drivers are locked with FOR UPDATE
  //       SKIP LOCKED inside one transaction (skips rows a concurrent
  //       dispatcher is mid-flight on instead of blocking dispatch);
  //    b) at insert time: the 001b partial unique index
  //       (driver_id) WHERE status='pending' refuses the duplicate outright.
  const busyRows = await withTransaction(async (client) => {
    const r = await client.query<{ driver_id: string }>(
      `SELECT driver_id FROM ride_offers
        WHERE status = 'pending' AND driver_id = ANY($1::uuid[])
        ORDER BY driver_id
        FOR UPDATE SKIP LOCKED`,
      [freshIds]
    );
    return r.rows;
  });
  const busy = new Set(busyRows.map((r) => r.driver_id));
  const availableIds = freshIds.filter((id) => !busy.has(id));
  if (availableIds.length === 0) {
    trace(rideId, "h3_all_busy", { busy: busy.size });
    console.warn(
      `[dispatch] every H3 candidate already holds a pending offer ride=${rideId} busy=${busy.size}`
    );
    return [];
  }

  // 4. Eligibility, in SQL over driver_profiles (the source of truth for
  //    status/online/freshness — the index only narrows the scan to ids):
  //    matchable status via the MATCHABLE_STATUSES constant, not-on-a-trip,
  //    not-already-offered, not-the-rider, driver_blocks (Q9), vehicle
  //    category, min rating — and the EXACT haversine <= radius, because hex
  //    cells are not circles.
  const rows = await query<H3Row>(
    `SELECT u.id, u.firebase_uid, dp.current_lat, dp.current_lng,
            (6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians($4)) * cos(radians(dp.current_lat)) *
                cos(radians(dp.current_lng) - radians($5)) +
              sin(radians($4)) * sin(radians(dp.current_lat))
            )))) AS distance_km
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
      WHERE u.id = ANY($1::uuid[])
        AND COALESCE(dp.status, CASE WHEN dp.is_online THEN 'available' ELSE 'offline' END) = ANY($2::text[])
        AND dp.is_online = TRUE
        AND dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL
        AND GREATEST(COALESCE(dp.last_location_at, dp.updated_at),
                     COALESCE(dp.last_heartbeat_at, dp.updated_at))
            > NOW() - make_interval(secs => $3::double precision)
        AND u.id <> COALESCE((SELECT passenger_id FROM rides WHERE id = $6), '00000000-0000-0000-0000-000000000000'::uuid)
        AND ($7::boolean OR NOT EXISTS (SELECT 1 FROM ride_offers ro WHERE ro.ride_id = $6 AND ro.driver_id = u.id))
        AND NOT EXISTS (
              SELECT 1 FROM rides r
               WHERE r.driver_id = u.id
                 AND r.status IN ('accepted', 'driver_arrived', 'in_progress'))
        AND NOT EXISTS (
              SELECT 1 FROM driver_blocks blk
               WHERE blk.rider_id = COALESCE((SELECT passenger_id FROM rides WHERE id = $6), '00000000-0000-0000-0000-000000000000'::uuid)
                 AND blk.driver_id = u.id)
        AND ($8::text IS NULL OR dp.vehicle_category = $8)
        AND COALESCE(dp.rating_avg, 0) >= $9::double precision
        AND (6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians($4)) * cos(radians(dp.current_lat)) *
                cos(radians(dp.current_lng) - radians($5)) +
              sin(radians($4)) * sin(radians(dp.current_lat))
            )))) <= $10::double precision
      ORDER BY distance_km ASC
      LIMIT $11`,
    [
      availableIds,
      [...MATCHABLE_STATUSES],
      cfg.stale_seconds,
      pickupLat,
      pickupLng,
      rideId,
      ignorePreviousOffers,
      cfg.required_vehicle_category,
      cfg.min_driver_rating,
      radiusKm,
      H3_CANDIDATE_POOL,
    ]
  );
  if (rows.length === 0) return [];

  // 5. Rank by ROAD ETA (one OSRM matrix call for the pool), haversine
  //    fallback per entry — never a reason to delay the offer.
  const etas = await etaMinutesList(
    { lat: pickupLat, lng: pickupLng },
    rows.map((r) => ({ lat: Number(r.current_lat), lng: Number(r.current_lng) })),
    cfg.avg_speed_kmh
  );
  const ranked = rows
    .map((row, i) => ({ row, eta: etas[i] }))
    .sort((a, b) => a.eta - b.eta)
    .map((x) => x.row);

  trace(rideId, "h3_candidates", {
    round,
    radius_km: radiusKm,
    rings: k,
    cells: cells.length,
    indexed_fresh: freshIds.length,
    busy: busy.size,
    eligible: ranked.length,
    eta_source: "road_with_haversine_fallback",
  });

  // The flag-on pool is what the one-at-a-time offer loop picks from; `limit`
  // stays meaningful for any caller that asks for a specific count.
  return ranked.slice(0, Math.max(limit, H3_CANDIDATE_POOL));
}

export interface DispatchRide {
  id: string;
  status: string;
  passenger_id: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_address: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  estimated_fare: number | null;
  payment_method: string | null;
  waypoints: unknown;
  offer_round: number | null;
  version: number | null;
  passenger_fb: string | null;
}

export async function loadRide(rideId: string): Promise<DispatchRide | null> {
  return queryOne<DispatchRide>(
    `SELECT r.id, r.status, r.passenger_id, r.pickup_address, r.pickup_lat, r.pickup_lng,
            r.destination_address, r.destination_lat, r.destination_lng,
            r.estimated_fare, r.payment_method, r.waypoints,
            COALESCE(r.offer_round, 0) AS offer_round, COALESCE(r.version, 0) AS version,
            u.firebase_uid AS passenger_fb
       FROM rides r
       LEFT JOIN users u ON u.id = r.passenger_id
      WHERE r.id = $1`,
    [rideId]
    // loadRide returning null means "no such ride" to every caller, so a database
    // fault here is indistinguishable from a deleted ride -- and offerToNextDriver
    // then returns ride_not_found and silently stops trying. Surface it.
  ).catch((err) => {
    console.error(`[dispatch] loadRide FAILED ride=${rideId}:`, err?.message || err);
    return null;
  });
}

/**
 * Offer the ride to the closest not-yet-tried driver.
 *
 * Emits BOTH events to that driver only: `ride:offer` (new, carries offerId and
 * the deadline so the offer screen can count down) and `ride:request` (the event
 * today's driver app already listens to, so nothing regresses). A high-priority
 * push always goes out too â€” that is the only thing that works when the app is
 * closed, which is what made rides "never arrive".
 */
export async function offerToNextDriver(
  io: SocketIOServer,
  rideId: string,
  round?: number,
  opts?: { revive?: boolean }
): Promise<OfferResult> {
  const ride = await loadRide(rideId);
  if (!ride) return { offered: false, reason: "ride_not_found" };
  const reviving = opts?.revive === true;
  // A parked ('no_drivers') ride may be retried when a driver comes back online â€”
  // that is the whole point of revival: a rider must not wait forever just because
  // nobody was available at the moment they booked.
  if (!["searching", "scheduled", "no_drivers"].includes(ride.status)) {
    return { offered: false, reason: `ride_is_${ride.status}` };
  }
  if (ride.status === "no_drivers" && reviving) {
    await execute(
      `UPDATE rides SET status = 'searching', no_drivers_at = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'no_drivers'`,
      [rideId]
    ).catch(() => undefined);
  } else if (ride.status === "no_drivers") {
    return { offered: false, reason: "ride_parked_no_drivers" };
  }
  if (ride.pickup_lat == null || ride.pickup_lng == null) {
    return { offered: false, reason: "ride_has_no_pickup_coords" };
  }

  const nextRound = round ?? (ride.offer_round || 0) + 1;
  if (nextRound > MAX_OFFER_ROUNDS) {
    await logRideEvent(rideId, null, "dispatch_exhausted", { rounds: nextRound });
    await markNoDrivers(io, rideId);
    return { offered: false, reason: "too_many_rounds" };
  }

  const candidates = await findCandidates(
    rideId,
    ride.pickup_lat,
    ride.pickup_lng,
    1,
    reviving,
    nextRound
  );
  // The COUNT is the single most useful number in the whole trace: 0 means the
  // driver was invisible to dispatch (offline / stale GPS / on a trip), which is
  // a completely different problem from "the offer was sent but never arrived".
  trace(rideId, "drivers_found", { count: candidates.length });
  await logRideEvent(rideId, null, "candidates_found", {
    round: nextRound,
    count: candidates.length,
  });
  if (candidates.length === 0) {
    await markNoDrivers(io, rideId);
    return { offered: false, reason: "no_candidates" };
  }

  // ONE offer at a time: candidates arrive in rank order (ETA under flag-on,
  // distance under flag-off where there is exactly one), and the loop stops at
  // the first INSERT that sticks. The 001b partial unique index
  // (driver_id WHERE status='pending') is what actually refuses a driver who
  // already holds a pending offer for ANOTHER ride — that conflict is skipped
  // to the next candidate instead of burning the round; every other error keeps
  // the original behaviour (loud trace + log, round not sent).
  let driver: Candidate | null = null;
  let offer: { id: string; expires_at: string } | null = null;
  for (const candidate of candidates) {
    const res = await queryOne<{ id: string; expires_at: string }>(
      `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at, round)
       VALUES ($1, $2, 'pending', NOW() + make_interval(secs => $3::double precision), $4)
       ON CONFLICT (ride_id, driver_id) DO NOTHING
       RETURNING id, expires_at`,
      [rideId, candidate.id, OFFER_TTL_SECONDS, nextRound]
    ).catch((err) => {
      // "offer_conflict" (the ON CONFLICT DO NOTHING path) is a normal, expected
      // outcome. Any OTHER database error is NOT -- it means the offer was never
      // created, so no driver is being asked and the ride would sit forever. It now
      // gets its own trace stage and a loud log instead of a quiet `null`.
      const isBusy = /duplicate key|unique_violation/i.test(
        err?.code + " " + (err?.message ?? "")
      );
      if (isBusy) {
        // Pending offer for a DIFFERENT ride (001b index): next candidate.
        trace(rideId, "offer_driver_busy", {
          driver_id: candidate.id,
          round: nextRound,
        });
        console.warn(
          `[dispatch] driver already holds a pending offer, trying next candidate ride=${rideId} driver=${candidate.id}`
        );
        return "busy" as const;
      }
      trace(rideId, "offer_insert_failed", {
        driver_id: candidate.id,
        round: nextRound,
        error: err?.message ?? String(err),
      });
      console.error(
        `[dispatch] offer INSERT failed ride=${rideId} driver=${candidate.id}:`,
        err?.message || err
      );
      return "failed" as const;
    });
    if (res === "failed") return { offered: false, reason: "offer_conflict" };
    if (res === "busy") continue;
    if (!res) {
      // This ride was already offered to this driver (per-ride conflict).
      trace(rideId, "offer_conflict", {
        driver_id: candidate.id,
        round: nextRound,
      });
      console.warn(
        "[dispatch] offer insert conflicted (already offered):",
        candidate.id
      );
      continue;
    }
    driver = candidate;
    offer = res;
    break;
  }
  if (!offer || !driver) return { offered: false, reason: "offer_conflict" };

  await execute(`UPDATE rides SET offer_round = $2, updated_at = NOW() WHERE id = $1`, [
    rideId,
    nextRound,
  ]).catch(() => undefined);

  const payload = {
    id: rideId,
    offerId: offer.id,
    expiresAt: offer.expires_at,
    secondsRemaining: OFFER_TTL_SECONDS,
    round: nextRound,
    version: (ride.version || 0) + 1,
    pickupAddress: ride.pickup_address,
    pickupLat: ride.pickup_lat,
    pickupLng: ride.pickup_lng,
    destinationAddress: ride.destination_address,
    destinationLat: ride.destination_lat,
    destinationLng: ride.destination_lng,
    fare: ride.estimated_fare != null ? Number(ride.estimated_fare) : 0,
    paymentMethod: ride.payment_method || "cash",
    waypoints: Array.isArray(ride.waypoints) ? ride.waypoints : [],
    stops: Array.isArray(ride.waypoints) ? ride.waypoints : [],
    riderName: "Rider",
    riderRating: 5,
    distanceToPickupKm: Number(driver.distance_km?.toFixed?.(2) ?? driver.distance_km),
  };

  if (driver.firebase_uid) {
    io.to(`user:${driver.firebase_uid}`).emit("ride:offer", payload);
    io.to(`user:${driver.firebase_uid}`).emit("ride:request", payload);
  }

  await logRideEvent(rideId, driver.id, "offer_sent", {
    round: nextRound,
    distanceKm: payload.distanceToPickupKm,
    expiresIn: OFFER_TTL_SECONDS,
    socket: Boolean(driver.firebase_uid),
  });

  // `channel` distinguishes the two delivery paths. socket:false means this
  // driver has NO live connection, so push is the ONLY way the offer can arrive
  // -- exactly the case that used to fail in total silence.
  trace(rideId, "offer_sent", {
    driver_id: driver.id,
    channel: driver.firebase_uid ? "socket" : "push_only",
    distance_km: payload.distanceToPickupKm,
  });

  void sendPushToUsers([driver.id], {
    type: "ride_offer",
    title: "New ride request",
    body: `${ride.pickup_address || "Pickup"} Â· R${payload.fare.toFixed(2)} â€” tap to accept`,
    rideId,
    offerId: offer.id,
    highPriority: true,
    data: { channel: "offers", offer_id: offer.id },
  })
    // WAS `.catch(() => 0)` -- a push that failed, or was skipped because the
    // token was an Expo token this build can never mint, returned 0 in total
    // silence. `delivered: 0` is now written to the trace, which is what makes
    // "the app was killed" distinguishable from "the offer arrived".
    .then((delivered) => {
      trace(rideId, "push_result", { driver_id: driver.id, delivered, ok: delivered > 0 });
      if (!delivered) {
        console.warn(
          `[dispatch] push delivered 0 devices driver=${driver.id} ride=${rideId}; ` +
            `socket is the only remaining channel`
        );
      }
    })
    .catch((err) => {
      trace(rideId, "push_result", {
        driver_id: driver.id,
        delivered: 0,
        ok: false,
        error: err?.message ?? String(err),
      });
      console.warn(`[dispatch] push failed driver=${driver.id}:`, err?.message);
    });

  return { offered: true, driverId: driver.id };
}

/** No driver left (or too many rounds): park the ride and tell the rider. */
export async function markNoDrivers(io: SocketIOServer, rideId: string): Promise<void> {
  const upd = await execute(
    `UPDATE rides SET status = 'no_drivers', no_drivers_at = NOW(), updated_at = NOW(),
                      version = COALESCE(version, 0) + 1
      WHERE id = $1 AND status IN ('searching', 'scheduled')`,
    [rideId]
    // A failed UPDATE here would otherwise look exactly like "someone else
    // already changed the status" (rowCount 0), so the rider would never be told
    // and the ride would stay 'searching' with nobody working on it.
  ).catch((err) => {
    console.error(`[dispatch] markNoDrivers UPDATE FAILED ride=${rideId}:`, err?.message || err);
    return { rowCount: 0, rows: [] as any[] };
  });
  if (!upd.rowCount) return;

  await execute(
    `UPDATE ride_offers SET status = 'expired', decline_reason = 'no_drivers', updated_at = NOW()
      WHERE ride_id = $1 AND status = 'pending'`,
    [rideId]
  ).catch(() => undefined);

  const ride = await loadRide(rideId);
  emitRide(
    io,
    rideId,
    "ride:no:drivers",
    { rideId, reason: "No drivers available nearby." },
    ride?.passenger_fb
  );
  await logRideEvent(rideId, null, "no_drivers", {});
  if (ride) {
    void sendPushToUsers([ride.passenger_id], {
      type: "no_drivers",
      title: "No drivers available",
      body: "We could not find a driver nearby. Please try again in a moment.",
      rideId,
    }).catch(() => 0);
  }
}

/** Entry point when a rider books (socket handler calls this after INSERT). */
export async function startDispatch(io: SocketIOServer, rideId: string): Promise<OfferResult> {
  // Mint the trace BEFORE the first stage is written, so request_received and
  // dispatch_started share one trace_id and can be timed against each other.
  startTrace(rideId);
  trace(rideId, "dispatch_started");
  await logRideEvent(rideId, null, "ride_requested", {});
  return offerToNextDriver(io, rideId, 1);
}

export interface AcceptResult {
  ok: boolean;
  error?: string;
  rideId?: string;
  version?: number;
  duplicate?: boolean;
  /**
   * Drivers who still held a pending offer for this ride when it was won, and so
   * have to be told it is gone. Collected inside the accept transaction, acted on
   * after it commits.
   */
  losers?: string[];
}

/**
 * Atomically claim a ride for a driver.
 *
 * THE POINT: the old code read the ride, then ran an UPDATE with no status guard,
 * so two drivers accepting at once both "won" (last write wins) and a stale accept
 * could overwrite an accepted/cancelled ride. Here everything happens in ONE
 * transaction: the ride row is locked FOR UPDATE, the driver's pending offer (if
 * any) must still be inside its 15s window, and the UPDATE itself is guarded by
 * `AND status IN (...)`. Zero rows affected => "ride no longer available".
 *
 * Idempotent: calling it twice for the same driver returns ok + duplicate instead
 * of erroring, so a retry after a network blip is safe.
 */
export async function acceptRide(
  io: SocketIOServer,
  params: { rideId: string; driverId: string }
): Promise<AcceptResult> {
  const { rideId, driverId } = params;

  const result = await withTransaction<AcceptResult>(async (client) => {
    const rideRes = await client.query<{
      id: string;
      status: string;
      passenger_id: string;
      estimated_fare: string | null;
      version: number | null;
      driver_id: string | null;
    }>(
      `SELECT id, status, passenger_id, estimated_fare, COALESCE(version, 0) AS version, driver_id
         FROM rides WHERE id = $1 FOR UPDATE`,
      [rideId]
    );
    const ride = rideRes.rows[0];
    if (!ride) return { ok: false, error: "Ride no longer available" };

    // Already taken?
    if (["accepted", "driver_arrived", "in_progress"].includes(ride.status)) {
      if (ride.driver_id === driverId) {
        return { ok: true, duplicate: true, rideId, version: ride.version ?? 0 };
      }
      return { ok: false, error: "Ride no longer available" };
    }
    if (!["searching", "scheduled", "no_drivers"].includes(ride.status)) {
      return { ok: false, error: `Ride is ${ride.status}` };
    }

    // Claim this driver's offer if they have a live one.
    const offerUpd = await client.query(
      `UPDATE ride_offers SET status = 'accepted', updated_at = NOW()
        WHERE ride_id = $1 AND driver_id = $2 AND status = 'pending' AND expires_at > NOW()`,
      [rideId, driverId]
    );
    const hadOffer = (offerUpd.rowCount ?? 0) > 0;
    if (!hadOffer) {
      // Targeted dispatch wins: if somebody else is inside their window, refuse.
      const pending = await client.query(
        `SELECT 1 FROM ride_offers
          WHERE ride_id = $1 AND status = 'pending' AND expires_at > NOW() LIMIT 1`,
        [rideId]
      );
      if ((pending.rowCount ?? 0) > 0) {
        return { ok: false, error: "Another driver is reviewing this ride." };
      }
    }

    const upd = await client.query<{ version: number }>(
      `UPDATE rides
          SET driver_id = $1, status = 'accepted', accepted_at = NOW(), updated_at = NOW(),
              version = COALESCE(version, 0) + 1
        WHERE id = $2 AND status IN ('searching', 'scheduled', 'no_drivers')
        RETURNING COALESCE(version, 0) AS version`,
      [driverId, rideId]
    );
    // 0 rows here is the NORMAL losing path: another driver won the race, or the
  // 15s window closed. It is a clean business error, not a fault. A real database
  // error is NOT swallowed here -- this query is deliberately un-caught so
  // withTransaction rolls back and the caller sees a genuine 500 rather than a
  // misleading "Ride no longer available".
  if ((upd.rowCount ?? 0) === 0) return { ok: false, error: "Ride no longer available" };

    // Everyone else stops being asked; this driver becomes busy.
    // RETURNING captures WHO was still holding an offer, so they can be told once
    // this transaction commits. The decision itself is already made by the guarded
    // UPDATE above — this list is delivery only, and deliberately outside the
    // transaction, because a socket emit or a push must never roll back a ride.
    const losersRes = await client.query<{ driver_id: string }>(
      `UPDATE ride_offers SET status = 'expired', decline_reason = 'ride_taken', updated_at = NOW()
        WHERE ride_id = $1 AND status = 'pending' AND driver_id <> $2
        RETURNING driver_id`,
      [rideId, driverId]
    );
    await client.query(
      `UPDATE driver_profiles SET status = 'on_trip', updated_at = NOW() WHERE user_id = $1`,
      [driverId]
    );

    return {
      ok: true,
      rideId,
      version: upd.rows[0]?.version ?? 0,
      losers: losersRes.rows.map((r) => r.driver_id),
    };
  });

  if (!result.ok) return result;

  // The LAST stage of a healthy trace: request -> saved -> dispatch -> drivers
  // found -> offer sent -> delivered ack -> response. Once this lands,
  // total_ms is the true rider-tap-to-driver-decision latency.
  trace(rideId, "driver_response", {
    driver_id: driverId,
    response: result.duplicate ? "accept_duplicate" : "accept",
  });

  await logRideEvent(rideId, driverId, result.duplicate ? "accept_duplicate" : "ride_accepted", {
    version: result.version,
  });
  if (!result.duplicate) {
    await emitRideAccepted(io, rideId, driverId, result.version ?? 0);
    // Tell the drivers who were still looking at this ride that it is gone. The
    // database already refused their accept, but a row flipping to 'expired' is
    // invisible to a phone: without this their request screen keeps counting down
    // on a trip somebody else is driving, and tapping Accept fails for no visible
    // reason. That is the "two drivers, one ride" report.
    if (result.losers?.length) {
      await notifyLosingDrivers(io, rideId, result.losers);
    }
  }
  return result;
}

/** Single source of truth for the rider-facing "driver accepted" event. */
export async function emitRideAccepted(
  io: SocketIOServer,
  rideId: string,
  driverId: string,
  version: number
): Promise<void> {
  const driver = await queryOne<any>(
    `SELECT u.full_name, u.phone, u.profile_photo_url, dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, NULL::text AS vehicle_image_url,
            dp.vehicle_year, dp.body_type, dp.vehicle_category,
            dp.license_plate, COALESCE(dp.rating_avg, 0)::float AS rating_avg
       FROM users u LEFT JOIN driver_profiles dp ON dp.user_id = u.id
      WHERE u.id = $1`,
    [driverId]
  ).catch(() => null);

  // The photo of the car that just accepted: the rider's trip card draws it the
  // instant this event lands, so it must be on the payload, not only on the
  // follow-up GET /api/rides/me/active.
  await attachVehicleImages(driver);

  // STAMP the car onto the ride at accept time: trip history must keep showing the
  // car that did THAT trip even after the driver changes cars. Best-effort â€” a
  // failure here must never block an accept that already succeeded.
  await execute(
    `UPDATE rides
        SET vehicle_make = $2, vehicle_model = $3, vehicle_color = $4,
            license_plate = $5, vehicle_body_type = $6
      WHERE id = $1`,
    [
      rideId,
      driver?.vehicle_make ?? null,
      driver?.vehicle_model ?? null,
      driver?.vehicle_color ?? null,
      driver?.license_plate ?? null,
      driver?.body_type ?? null,
    ]
  ).catch(() => undefined);
  const ride = await loadRide(rideId);
  const stops = Array.isArray(ride?.waypoints) ? ride?.waypoints : [];

  const payload = {
    id: rideId,
    version,
    driver_name: driver?.full_name || "Driver",
    driver_photo_url: driver?.profile_photo_url || null,
    vehicle_color: driver?.vehicle_color,
    vehicle_make: driver?.vehicle_make,
    vehicle_model: driver?.vehicle_model,
    vehicle_year: driver?.vehicle_year ?? null,
    vehicle_body_type: driver?.body_type || null,
    vehicle_category: driver?.vehicle_category || null,
    vehicle_image_url: driver?.vehicle_image_url || null,
    driver_license_plate: driver?.license_plate,
    fare: ride?.estimated_fare != null ? Number(ride.estimated_fare) : null,
    waypoints: stops,
    stops,
    driver: {
      name: driver?.full_name || "Driver",
      phone: driver?.phone || null,
      photo_url: driver?.profile_photo_url || null,
      rating: driver?.rating_avg ?? 0,
      plate: driver?.license_plate || null,
      vehicle_image_url: driver?.vehicle_image_url || null,
      vehicle: [driver?.vehicle_color, driver?.vehicle_make, driver?.vehicle_model]
        .filter(Boolean)
        .join(" "),
    },
  };
  emitRide(io, rideId, "ride:accepted", payload, ride?.passenger_fb);

  if (ride) {
    void sendPushToUsers([ride.passenger_id], {
      type: "ride_accepted",
      title: "Driver accepted",
      body: `${payload.driver_name} is on the way in a ${payload.driver.vehicle || "vehicle"}.`,
      rideId,
    }).catch(() => 0);
  }
}

/** Driver said no (or their app did it for them after the countdown). */
export async function declineOffer(
  io: SocketIOServer,
  params: { rideId: string; driverId: string; reason?: string }
): Promise<{ ok: boolean; duplicate?: boolean; status?: string | null }> {
  const { rideId, driverId, reason } = params;
  const upd = await execute(
    `UPDATE ride_offers SET status = 'declined', decline_reason = $3, updated_at = NOW()
      WHERE ride_id = $1 AND driver_id = $2 AND status = 'pending'`,
    [rideId, driverId, reason || "declined"]
  ).catch(() => ({ rowCount: 0, rows: [] as any[] }));

  if (!upd.rowCount) {
    // Idempotent: a second decline (or a decline after expiry) must not error.
    const existing = await queryOne<{ status: string; round: number | null }>(
      `SELECT status, round FROM ride_offers
        WHERE ride_id = $1 AND driver_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [rideId, driverId]
    ).catch(() => null);
    return { ok: true, duplicate: true, status: existing?.status ?? null };
  }

  const offer = await queryOne<{ round: number | null }>(
    `SELECT round FROM ride_offers WHERE ride_id = $1 AND driver_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [rideId, driverId]
  ).catch(() => null);
  trace(rideId, "driver_response", { driver_id: driverId, response: "decline", reason: reason ?? "declined" });
  await logRideEvent(rideId, driverId, "offer_declined", { reason, round: offer?.round });
  await offerToNextDriver(io, rideId, (offer?.round ?? 1) + 1);
  return { ok: true };
}

/**
 * Durable offer expiry â€” called by the worker every couple of seconds.
 *
 * This is deliberately DB-driven (like SchedulingService) instead of an in-memory
 * setTimeout: a deploy/restart mid-dispatch must not strand a rider waiting for a
 * driver who will never be asked again.
 */
export async function expireOffers(io: SocketIOServer): Promise<number> {
  const due = await query<{ id: string; ride_id: string; driver_id: string; round: number | null }>(
    `SELECT id, ride_id, driver_id, round FROM ride_offers
      WHERE status = 'pending' AND expires_at <= NOW()
      ORDER BY expires_at ASC LIMIT 40`
  ).catch(() => [] as any[]);

  let handled = 0;
  for (const offer of due) {
    const upd = await execute(
      `UPDATE ride_offers SET status = 'expired', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [offer.id]
    ).catch(() => ({ rowCount: 0, rows: [] as any[] }));
    if (!upd.rowCount) continue;
    handled += 1;
    await logRideEvent(offer.ride_id, offer.driver_id, "offer_expired", { round: offer.round });

    const ride = await queryOne<{ status: string }>(
      `SELECT status FROM rides WHERE id = $1`,
      [offer.ride_id]
    ).catch(() => null);
    if (ride && ["searching", "scheduled"].includes(ride.status)) {
      await offerToNextDriver(io, offer.ride_id, (offer.round ?? 1) + 1);
    }
  }

  // Offers left open on rides that stopped looking (accepted / cancelled elsewhere).
  await execute(
    `UPDATE ride_offers SET status = 'expired', decline_reason = 'ride_not_searching', updated_at = NOW()
      WHERE status = 'pending'
        AND ride_id IN (SELECT id FROM rides WHERE status NOT IN ('searching', 'scheduled'))`
  ).catch(() => undefined);

  return handled;
}

/**
 * Heartbeat sweep: a driver who stopped reporting location/socket for too long
 * stops being a candidate. Without this, a force-quit driver kept absorbing
 * offers nobody could answer â€” one of the reasons riders waited forever.
 */
export async function sweepStaleDrivers(io: SocketIOServer): Promise<number> {
  // SAFETY TIMEOUT: 15 minutes of total silence means the driver really is gone
  // (phone off, app force-stopped, uninstalled), so the INTENT is turned off â€” and
  // we tell them why, otherwise they sit waiting for offers that will never come.
  const gone = await query<{ user_id: string }>(
    `UPDATE driver_profiles
        SET is_online = FALSE, status = 'offline', updated_at = NOW()
      WHERE is_online = TRUE
        AND GREATEST(COALESCE(last_location_at, updated_at), COALESCE(last_heartbeat_at, updated_at))
            < NOW() - INTERVAL '15 minutes'
        AND NOT EXISTS (
              SELECT 1 FROM rides r
               WHERE r.driver_id = driver_profiles.user_id
                 AND r.status IN ('accepted', 'driver_arrived', 'in_progress'))
      RETURNING user_id`
  ).catch(() => [] as { user_id: string }[]);
  if (gone.length > 0) {
    console.log(`[dispatch] safety timeout: ${gone.length} driver(s) offline after 15 min of silence`);
    await logRideEvent(null, null, "drivers_offline_timeout", { count: gone.length });
    void sendPushToUsers(
      gone.map((g) => g.user_id),
      {
        type: "offline_timeout",
        title: "You were taken offline",
        body: "We lost contact with your phone, so we stopped sending ride requests. Tap to go back online.",
      }
    ).catch(() => 0);
  }

  const stale = await query<{ user_id: string }>(
    `UPDATE driver_profiles
        SET status = 'offline', updated_at = NOW()
      WHERE COALESCE(status, 'offline') = 'available'
        AND GREATEST(COALESCE(last_location_at, updated_at), COALESCE(last_heartbeat_at, updated_at))
            < NOW() - make_interval(secs => $1::double precision)
        AND NOT EXISTS (
              SELECT 1 FROM rides r
               WHERE r.driver_id = driver_profiles.user_id
                 AND r.status IN ('accepted', 'driver_arrived', 'in_progress'))
      RETURNING user_id`,
    [DRIVER_STALE_SECONDS]
  ).catch(() => [] as any[]);

  if (stale.length === 0) return 0;
  const ids = stale.map((s) => s.user_id);

  const offers = await query<{ ride_id: string; driver_id: string; round: number | null }>(
    `UPDATE ride_offers SET status = 'expired', decline_reason = 'driver_offline', updated_at = NOW()
      WHERE status = 'pending' AND driver_id = ANY($1::uuid[])
      RETURNING ride_id, driver_id, round`,
    [ids]
  ).catch(() => [] as any[]);

  for (const offer of offers) {
    await logRideEvent(offer.ride_id, offer.driver_id, "offer_driver_offline", {});
    const ride = await queryOne<{ status: string }>(
      `SELECT status FROM rides WHERE id = $1`,
      [offer.ride_id]
    ).catch(() => null);
    if (ride && ["searching", "scheduled"].includes(ride.status)) {
      await offerToNextDriver(io, offer.ride_id, (offer.round ?? 1) + 1);
    }
  }

  await logRideEvent(null, null, "drivers_demoted", { count: ids.length, releasedOffers: offers.length });
  return ids.length;
}

/**
 * The copy for "this offer is gone", by reason.
 *
 * Kept in one place because the same event now carries three different truths, and
 * a losing driver must be told WHICH one: another driver took it, the rider
 * cancelled, or the driver's own trip died. Saying "the rider cancelled" when the
 * truth is "another driver got there first" is how a working race starts looking
 * like a broken app.
 */
function offerGoneCopy(reason: string): { type: string; title: string; body: string } {
  switch (reason) {
    case "ride_taken":
      return {
        type: "ride_taken",
        title: "Ride taken",
        body: "Another driver accepted this ride.",
      };
    case "driver_cancelled":
      return {
        type: "ride_cancelled",
        title: "Trip cancelled",
        body: "The driver cancelled this trip.",
      };
    default:
      return {
        type: "ride_cancelled",
        title: "Ride cancelled",
        body: "The rider cancelled this request.",
      };
  }
}

/**
 * Tell drivers who lost the race that the ride is gone — over both channels.
 *
 * WHY NOT JUST THE DATABASE: acceptRide decides the winner in ONE transaction
 * (correct — the row is the authority) and expires the losers' offers there. But a
 * row going to 'expired' is invisible to a phone. Before this, the losing driver's
 * request screen stayed up with a live countdown and tapping Accept failed with
 * "Ride no longer available" and no explanation, which is indistinguishable from a
 * broken app.
 *
 * Emits `ride:offer:cancelled` (what the native driver app already handles) AND
 * `ride:taken` (the same fact in a flatter shape), so either client build can drop
 * the request without a coordinated release.
 */
export async function notifyLosingDrivers(
  io: SocketIOServer,
  rideId: string,
  driverUserIds: string[],
  reason = "ride_taken"
): Promise<number> {
  if (driverUserIds.length === 0) return 0;

  const drivers = await query<{ id: string; firebase_uid: string | null }>(
    `SELECT id, firebase_uid FROM users WHERE id = ANY($1::uuid[])`,
    [driverUserIds]
  ).catch(() => [] as any[]);

  const payload = { rideId, reason };
  for (const d of drivers) {
    if (d.firebase_uid) {
      io.to(`user:${d.firebase_uid}`).emit("ride:offer:cancelled", payload);
      io.to(`user:${d.firebase_uid}`).emit("ride:taken", payload);
    }
  }

  void sendPushToUsers(driverUserIds, { ...offerGoneCopy(reason), rideId }).catch(() => 0);

  await logRideEvent(rideId, null, "offers_superseded", {
    reason,
    drivers: driverUserIds.length,
  });
  return driverUserIds.length;
}

/** Rider cancelled (or the ride died): kill pending offers + tell those drivers. */
export async function cancelPendingOffers(
  io: SocketIOServer,
  rideId: string,
  reason = "cancelled"
): Promise<number> {
  const rows = await query<{ driver_id: string }>(
    `UPDATE ride_offers SET status = 'expired', decline_reason = $2, updated_at = NOW()
      WHERE ride_id = $1 AND status = 'pending'
      RETURNING driver_id`,
    [rideId, reason]
  ).catch(() => [] as any[]);
  if (rows.length === 0) return 0;

  const driverIds = rows.map((r) => r.driver_id);
  const drivers = await query<{ id: string; firebase_uid: string | null }>(
    `SELECT id, firebase_uid FROM users WHERE id = ANY($1::uuid[])`,
    [driverIds]
  ).catch(() => [] as any[]);

  const payload = { rideId, reason };
  for (const d of drivers) {
    if (d.firebase_uid) {
      io.to(`user:${d.firebase_uid}`).emit("ride:offer:cancelled", payload);
      // `ride:taken` is only truthful when another driver actually won the ride.
      if (reason === "ride_taken") io.to(`user:${d.firebase_uid}`).emit("ride:taken", payload);
    }
    void sendPushToUsers([d.id], { ...offerGoneCopy(reason), rideId }).catch(() => 0);
  }

  await logRideEvent(rideId, null, "offers_cancelled", { reason, drivers: driverIds.length });
  return rows.length;
}

/**
 * Retry rides that are still waiting for a driver.
 *
 * WHY: a ride used to be dispatched exactly once. If nobody was eligible in that
 * instant the ride was parked as 'no_drivers' and NOTHING ever offered it again â€”
 * the rider waited forever and the next driver to come online never saw it (this
 * is what a live field report looked like: `candidates_found {"count":0}` then a
 * parked ride). The worker calls this every few seconds, so a driver who comes
 * online moments later gets the ride, and a parked ride is un-parked back to
 * 'searching' when it is offered again.
 *
 * Guards: only rides younger than 15 minutes, with no live offer, and not retried
 * in the last ~6 seconds (prevents churn/loops), newest first.
 */
export async function reviveWaitingRides(io: SocketIOServer, limit = 5): Promise<number> {
  const waiting = await query<{ id: string; status: string }>(
    `SELECT r.id, r.status FROM rides r
      WHERE r.status IN ('searching', 'no_drivers')
        AND r.created_at > NOW() - INTERVAL '15 minutes'
        AND NOT EXISTS (
              SELECT 1 FROM ride_offers ro
               WHERE ro.ride_id = r.id AND ro.status = 'pending' AND ro.expires_at > NOW())
        AND COALESCE(r.no_drivers_at, r.created_at) < NOW() - INTERVAL '6 seconds'
      ORDER BY r.created_at DESC
      LIMIT $1`,
    [limit]
  ).catch(() => [] as { id: string; status: string }[]);

  let revived = 0;
  for (const ride of waiting) {
    // Round restarts at 1: every driver gets a fresh chance, because the reason the
    // ride is waiting again is usually that somebody's phone came back online.
    const res = await offerToNextDriver(io, ride.id, 1, { revive: true });
    if (res.offered) {
      revived += 1;
      await logRideEvent(ride.id, res.driverId ?? null, "ride_revived", {
        was: ride.status,
      });
    }
  }
  if (revived > 0) console.log(`[offerWorker] revived ${revived} waiting ride(s)`);
  return revived;
}

/** Driver is free again (trip finished / driver cancelled). */
export async function releaseDriver(driverId: string): Promise<void> {
  await execute(
    `UPDATE driver_profiles
        SET status = CASE WHEN is_online THEN 'available' ELSE 'offline' END, updated_at = NOW()
      WHERE user_id = $1`,
    [driverId]
  ).catch(() => undefined);
}





