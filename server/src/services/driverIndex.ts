// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DRIVER INDEX â€” where every online driver is, in one H3 cell.
//
// WHY AN INTERFACE
//
// The original design stored per-cell driver sets in Redis
// (cell:{h3index} -> driver_ids) and used SET NX for the one-offer lock. There
// is no Redis on this stack (offerWorker.ts documents "no BullMQ/Redis on
// Elastic Beanstalk"), so this module implements the same contract in Postgres.
//
// Everything above this interface -- matching, filters, ranking, dispatch -- is
// written against DriverIndex only. Swapping in a Redis implementation later
// (cell:{h3} as a SET, driver:{id} as a HASH, with key TTLs doing the eviction)
// touches this file alone.
//
// WHY ONE ROW PER DRIVER RATHER THAN ONE ROW PER (driver, cell)
//
// A per-cell row would need cleanup as drivers cross boundaries: find every row
// for this driver, delete all but the newest. At a 4s heartbeat that is heavy
// write amplification, plus rows to sweep when an app is force-quit. Keying on
// user_id makes "where is this driver" a single index lookup and makes the
// upsert idempotent, which matters because a dropped connection replays the last
// position.
//
// THE FRESHNESS RULE
//
// last_seen_at is written by every position update and is the ONLY thing that
// decides whether a driver is still here. The threshold lives in app_config
// (stale_seconds), NOT here, because it must change when the app's heartbeat
// changes without a deploy.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { query, queryOne, execute } from "../config/database";
import { toCell, DEFAULT_MATCH_RES, DEFAULT_HEATMAP_RES } from "../lib/h3";
import { getConfig } from "./config";

export interface DriverPosition {
  userId: string;
  lat: number;
  lng: number;
  heading?: number | null;
  status: string;
  tier?: string | null;
}

export interface IndexedDriver extends DriverPosition {
  cell: string;
  lastSeenAt: string;
}

/**
 * The contract a Redis implementation would also satisfy.
 * Callers depend on this, never on the SQL behind it.
 */
export interface DriverIndex {
  upsert(p: DriverPosition): Promise<IndexedDriver | null>;
  getDriver(userId: string): Promise<IndexedDriver | null>;
  getDriversInCells(cells: string[], limit?: number): Promise<IndexedDriver[]>;
  remove(userId: string): Promise<boolean>;
  evictStale(olderThanSeconds?: number): Promise<number>;
  /** Refresh liveness WITHOUT a new position — used by driver:heartbeat. */
  touch(userId: string, status?: string | null): Promise<boolean>;
  countFresh(olderThanSeconds?: number): Promise<number>;
}

/**
 * THE single definition of "matchable" (Q8).
 *
 * The database stores 'available' and that value is NOT being renamed. Matching
 * used to inline `COALESCE(dp.status, ...) = 'available'` in several places,
 * which is how the semantics drift apart. Everything now resolves through here,
 * so there is exactly one place that decides who can be offered a ride.
 *
 * Module 2's destination mode deliberately does NOT add a status (restatement
 * Q3, CHANGED): the driver stays 'available' and gets destination ATTRIBUTES
 * instead — the destinationFit predicate in dispatch.ts restricts who they
 * match. Should a genuine new availability status ever arrive, it is added
 * HERE and nowhere else.
 */
export const MATCHABLE_STATUSES = ["available"] as const;

export function isMatchableStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (MATCHABLE_STATUSES as readonly string[]).includes(status);
}

// â”€â”€ Postgres implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class PostgresDriverIndex implements DriverIndex {
  /**
   * Record a driver's current position.
   *
   * A single upsert, so a replayed or duplicated socket message is harmless.
   * Both cells are computed here rather than by the caller: cell_res7 exists
   * purely so the Phase 2 heatmap is a GROUP BY rather than a rewrite later.
   */
  async upsert(p: DriverPosition): Promise<IndexedDriver | null> {
    if (!p?.userId) return null;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const cfg = await getConfig();
    const cell = toCell(lat, lng, cfg.h3_match_res || DEFAULT_MATCH_RES);
    const cell7 = toCell(lat, lng, cfg.h3_heatmap_res || DEFAULT_HEATMAP_RES);

    // ON CONFLICT (user_id) DO UPDATE IS the cell migration: a driver moving to
    // a new cell overwrites the single row they own, so they can never be left
    // behind in the cell they just left. That is why this table is keyed on
    // user_id alone.
    await execute(
      `INSERT INTO driver_cells
         (user_id, cell_res8, cell_res7, lat, lng, heading, status, tier, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         cell_res8    = EXCLUDED.cell_res8,
         cell_res7    = EXCLUDED.cell_res7,
         lat          = EXCLUDED.lat,
         lng          = EXCLUDED.lng,
         heading      = EXCLUDED.heading,
         status       = EXCLUDED.status,
         tier         = EXCLUDED.tier,
         last_seen_at = NOW()`,
      [p.userId, cell, cell7, lat, lng, p.heading ?? null, p.status, p.tier ?? null]
    ).catch(() => {
      // Never let a location write break a socket handler. Swallowed deliberately:
      // this is a write-through index of driver_profiles, which is updated
      // separately and remains authoritative. A missing table (migration not yet
      // run) must not take matching down.
      return { rowCount: 0, rows: [] };
    });

    return {
      userId: p.userId, lat, lng, heading: p.heading ?? null,
      status: p.status, tier: p.tier ?? null, cell,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async getDriver(userId: string): Promise<IndexedDriver | null> {
    const row = await queryOne<any>(
      `SELECT user_id, cell_res8, lat, lng, heading, status, tier, last_seen_at
         FROM driver_cells WHERE user_id = $1`,
      [userId]
    );
    if (!row) return null;
    return {
      userId: row.user_id, lat: Number(row.lat), lng: Number(row.lng),
      heading: row.heading, status: row.status, tier: row.tier,
      cell: row.cell_res8, lastSeenAt: row.last_seen_at,
    };
  }

  /**
   * Every driver in the given cells. Returns CANDIDATES ONLY: gridDisk gives hex
   * cells, not a distance guarantee, so the caller must still filter by exact
   * haversine and by freshness.
   *
   * Ordering is left to the caller -- matching ranks by ETA, not by cell.
   */
  async getDriversInCells(cells: string[], limit = 500): Promise<IndexedDriver[]> {
    if (!cells.length) return [];
    const rows = await query<any>(
      `SELECT user_id, cell_res8, lat, lng, heading, status, tier, last_seen_at
         FROM driver_cells
        WHERE cell_res8 = ANY($1::text[])
        LIMIT $2`,
      [cells, limit]
    );
    return (rows || []).map((r) => ({
      userId: r.user_id, lat: Number(r.lat), lng: Number(r.lng),
      heading: r.heading, status: r.status, tier: r.tier,
      cell: r.cell_res8, lastSeenAt: r.last_seen_at,
    }));
  }

  /** Take a driver out of the index: going offline, or starting a trip. */
  async remove(userId: string): Promise<boolean> {
    const r = await execute(`DELETE FROM driver_cells WHERE user_id = $1`, [userId])
      .catch(() => ({ rowCount: 0, rows: [] as any[] }));
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Drop drivers who have gone quiet past the configured threshold.
   *
   * No default bound at the call site: the threshold is read from app_config here
   * so there is exactly one source of truth. 40s today, because the shipped app
   * pushes GPS every 15s (Q7); it becomes 20s after the 4s heartbeat APK with no
   * code change.
   */
  async evictStale(olderThanSeconds?: number): Promise<number> {
    const cfg = await getConfig();
    const seconds = olderThanSeconds ?? cfg.stale_seconds;
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    const r = await execute(
      `DELETE FROM driver_cells WHERE last_seen_at < NOW() - make_interval(secs => $1::double precision)`,
      [seconds]
    ).catch(() => ({ rowCount: 0, rows: [] as any[] }));
    return r.rowCount ?? 0;
  }

  /**
   * Refresh `last_seen_at` (optionally mirroring status) without moving the
   * driver. THE MODULE 1 FIX: `driver:heartbeat` only updated
   * driver_profiles, so a stationary driver whose app heartbeats but stops
   * sending GPS (parked, background, battery saver) went cold in
   * driver_cells after `stale_seconds` and dropped out of H3 matching —
   * while the eligibility SQL over driver_profiles would still have
   * accepted them. Heartbeats now touch the index row too. Position and
   * cell are untouched: the next driver:location ping overwrites them.
   * A missing row (driver never sent GPS) is a no-op — nothing to keep
   * fresh, and upsert will create it on the first ping.
   */
  async touch(userId: string, status?: string | null): Promise<boolean> {
    if (!userId) return false;
    const r = await execute(
      `UPDATE driver_cells SET last_seen_at = NOW(), status = COALESCE($2, status)
        WHERE user_id = $1`,
      [userId, status ?? null]
    ).catch(() => ({ rowCount: 0, rows: [] as any[] }));
    return (r.rowCount ?? 0) > 0;
  }

  async countFresh(olderThanSeconds?: number): Promise<number> {
    const cfg = await getConfig();
    const seconds = olderThanSeconds ?? cfg.stale_seconds;
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM driver_cells
        WHERE last_seen_at >= NOW() - make_interval(secs => $1::double precision)`,
      [seconds]
    ).catch(() => ({ n: 0 }));
    return row?.n ?? 0;
  }
}

export const driverIndex: DriverIndex = new PostgresDriverIndex();

/** Test seam: swap the implementation (a Redis-backed one, or a fake). */
let activeIndex: DriverIndex = new PostgresDriverIndex();
export function getDriverIndex(): DriverIndex {
  return activeIndex;
}
export function setDriverIndex(impl: DriverIndex): void {
  activeIndex = impl;
}
