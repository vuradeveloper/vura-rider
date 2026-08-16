import { getApiUrl } from "./config";
import type { Waypoint } from "./types";

export type LatLngPoint = { latitude: number; longitude: number };

export interface RouteMeta {
  distanceM: number;
  durationS: number;
}

// Converts [lat, lng] to OSRM's "lng,lat" string.
function toCoord(p: [number, number]): string {
  return `${p[1]},${p[0]}`;
}

function parseCoords(data: any): LatLngPoint[] {
  const coords = data?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords)) return [];
  return coords.map((c: any) => ({ latitude: c[1], longitude: c[0] }));
}

function parseMeta(data: any): RouteMeta {
  const route = data?.routes?.[0];
  return { distanceM: route?.distance ?? 0, durationS: route?.duration ?? 0 };
}

// Fetches a driving route through the app's own server (which caches),
// instead of hitting the public OSRM API directly from the phone. Falls back
// to the public OSRM server when the app's routing proxy is unreachable, so
// roaming demo cars still turn along real streets instead of straight lines.
export async function fetchRoute(
  start: [number, number],
  end: [number, number],
  waypoints: Waypoint[] = []
): Promise<LatLngPoint[]> {
  const result = await fetchRouteWithMeta(start, end, waypoints);
  if (result?.route && result.route.length > 0) return result.route;
  return fetchRouteFromOsrm(start, end, waypoints);
}

async function fetchRouteFromOsrm(
  start: [number, number],
  end: [number, number],
  waypoints: Waypoint[] = []
): Promise<LatLngPoint[]> {
  try {
    const valid = waypoints.filter((w) => w.lat && w.lng);
    const points = [start, ...valid.map((w) => [w.lat, w.lng] as [number, number]), end]
      .map(toCoord)
      .join(";");
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${points}?geometries=geojson&overview=full`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return parseCoords(data);
  } catch {
    return [];
  }
}

export async function fetchRouteWithMeta(
  start: [number, number],
  end: [number, number],
  waypoints: Waypoint[] = []
): Promise<{ route: LatLngPoint[] } & RouteMeta | null> {
  const valid = waypoints.filter((w) => w.lat && w.lng);
  const points = [start, ...valid.map((w) => [w.lat, w.lng] as [number, number]), end]
    .map(toCoord)
    .join(";");

  try {
    const res = await fetch(
      `${getApiUrl("/api/route")}?points=${encodeURIComponent(points)}&overview=full`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { route: parseCoords(data), ...parseMeta(data) };
  } catch {
    return null;
  }
}
