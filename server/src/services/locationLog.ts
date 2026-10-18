// ─────────────────────────────────────────────────────────────────────────────
// LOCATION LOG — persists the driver's ping ONLY while their ride is active
// (the caller has already confirmed active status), for anomaly detection and
// the admin live map's travelled-path. Privacy: rows are purged after
// safety_config.location_retention_days by the daily janitor.
// ─────────────────────────────────────────────────────────────────────────────
import { execute, queryOne } from "../config/database";
import { ensureSafetyTables, getSafetySettings } from "./safetyConfig";

/**
 * Record one point of the active trip. Fire-and-forget at the call site —
 * a history failure must never break a GPS ping the rider's map relies on.
 */
export async function logRidePoint(
  rideId: string,
  driverId: string,
  lat: number,
  lng: number
): Promise<void> {
  await ensureSafetyTables();
  await execute(
    `INSERT INTO ride_location_points (ride_id, driver_id, lat, lng, recorded_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [rideId, driverId, lat, lng]
  );
}

/** Recent path for one ride (admin map + anomaly review). */
export async function ridePath(
  rideId: string,
  limit = 2000
): Promise<Array<{ lat: number; lng: number; recorded_at: string }>> {
  await ensureSafetyTables();
  const { query } = await import("../config/database");
  return query(
    `SELECT lat, lng, recorded_at FROM ride_location_points
      WHERE ride_id = $1 ORDER BY recorded_at ASC LIMIT $2`,
    [rideId, limit]
  );
}

/**
 * Delete points past the retention window. Returns the number of rows
 * removed. Runs from the safety worker (daily) — one quiet query.
 */
export async function purgeOldLocations(): Promise<number> {
  try {
    await ensureSafetyTables();
    const s = await getSafetySettings();
    const r = await execute(
      `DELETE FROM ride_location_points
        WHERE recorded_at < NOW() - make_interval(days => $1::int)`,
      [s.location_retention_days]
    );
    return r.rowCount ?? 0;
  } catch {
    return 0;
  }
}

/** Last known point for a ride (check-in/SOS payload enrichment). */
export async function lastRidePoint(
  rideId: string
): Promise<{ lat: number; lng: number; recorded_at: string } | null> {
  try {
    await ensureSafetyTables();
    return await queryOne(
      `SELECT lat, lng, recorded_at FROM ride_location_points
        WHERE ride_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [rideId]
    );
  } catch {
    return null;
  }
}
