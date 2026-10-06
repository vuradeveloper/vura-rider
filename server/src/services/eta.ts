// ─────────────────────────────────────────────────────────────────────────────
// ROAD ETA — rank candidates by drive time, not straight-line distance.
//
// WHY: a driver 2.5km away across a highway interchange can be further in TIME
// than a driver 3km away on the same road. Matching ranks by road ETA so the
// rider waits less; haversine-over-avg-speed is the FALLBACK, not the plan.
//
// HOW: ONE OSRM /table (matrix) request for the pickup and every candidate in
// the pool — a single HTTP call regardless of candidate count — with a short
// timeout so a slow provider cannot stall dispatch. Any failure (timeout, 5xx,
// malformed body, no network, Node without fetch) silently degrades to
// haversine / avg_speed_kmh, which is always available and needs no network.
//
// The provider URL comes from the same ROUTE_PROVIDER_URL the /api/route
// proxy uses (self-hosted OSRM/Valhalla in production, the public OSRM demo
// otherwise). Tests drive setRoadEtaImpl() so NO network call ever happens
// under vitest.
// ─────────────────────────────────────────────────────────────────────────────

import { haversineKm } from "../lib/h3";

export type LatLon = { lat: number; lng: number };

/**
 * Road-ETA provider: returns minutes per target (null = unknown for that one).
 * Injectable so tests can pin ranking without a network.
 */
export type RoadEtaImpl = (
  pickup: LatLon,
  targets: LatLon[]
) => Promise<(number | null)[]>;

const UPSTREAM =
  process.env.ROUTE_PROVIDER_URL?.replace(/\/+$/, "") ||
  "https://router.project-osrm.org";

/** Dispatch ranks candidates; it must never wait on a routing provider. */
const TABLE_TIMEOUT_MS = 700;

let impl: RoadEtaImpl | null | undefined = undefined;

/** Test seam: replace the provider (null = haversine-only, no network). */
export function setRoadEtaImpl(fn: RoadEtaImpl | null): void {
  impl = fn;
}

/** Test seam: back to the default OSRM provider. */
export function resetRoadEtaImpl(): void {
  impl = undefined;
}

/** Straight-line minutes at the configured average city speed. */
export function haversineEtaMinutes(
  pickup: LatLon,
  target: LatLon,
  avgSpeedKmh: number
): number {
  const speed = Number.isFinite(avgSpeedKmh) && avgSpeedKmh > 0 ? avgSpeedKmh : 40;
  return (haversineKm(pickup.lat, pickup.lng, target.lat, target.lng) / speed) * 60;
}

/** OSRM table (distance-matrix) call: ONE request for the whole pool. */
async function osrmTableMinutes(
  pickup: LatLon,
  targets: LatLon[]
): Promise<(number | null)[]> {
  const g = globalThis as any;
  if (typeof g.fetch !== "function") throw new Error("fetch unavailable");
  const coords = [pickup, ...targets]
    .map((p) => `${Number(p.lng)},${Number(p.lat)}`)
    .join(";");
  const url = `${UPSTREAM}/table/v1/driving/${coords}?sources=0`;
  const signal =
    typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function"
      ? (AbortSignal as any).timeout(TABLE_TIMEOUT_MS)
      : undefined;
  const res = await g.fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const body = await res.json();
  const row = body?.durations?.[0];
  if (!Array.isArray(row)) throw new Error("OSRM: no durations");
  return targets.map((_, i) =>
    typeof row[i + 1] === "number" && Number.isFinite(row[i + 1]) ? row[i + 1] : null
  );
}

/**
 * Minutes-to-pickup for every target, road ETA first, haversine fallback
 * per-entry (one slow target does not demote the rest).
 */
export async function etaMinutesList(
  pickup: LatLon,
  targets: LatLon[],
  avgSpeedKmh: number
): Promise<number[]> {
  const fallback = targets.map((t) => haversineEtaMinutes(pickup, t, avgSpeedKmh));
  if (targets.length === 0) return [];
  const active = impl === undefined ? osrmTableMinutes : impl;
  if (!active) return fallback;
  try {
    const got = await active(pickup, targets);
    return got.map((v, i) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback[i]
    );
  } catch {
    return fallback;
  }
}
