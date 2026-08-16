import { Router, Response } from "express";
import { queryOne, execute } from "../config/database";

const router = Router();

// Upstream routing provider. Point ROUTE_PROVIDER_URL at your own
// self-hosted OSRM/Valhalla instance in production for the best speed.
const UPSTREAM =
  process.env.ROUTE_PROVIDER_URL?.replace(/\/+$/, "") ||
  "https://router.project-osrm.org";

const ROUTE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MEMORY_CACHE_MAX = 500;
const UPSTREAM_TIMEOUT_MS = 8000;

// ── In-memory LRU cache (fastest path, survives nothing but serves the
//    hot routes like the repeated pickup→destination lookups) ──
const memoryCache = new Map<
  string,
  { coords: number[][]; distance: number; duration: number }
>();

function cacheGet(key: string) {
  const hit = memoryCache.get(key);
  if (hit) {
    // Refresh recency so it counts as LRU
    memoryCache.delete(key);
    memoryCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: { coords: number[][]; distance: number; duration: number }) {
  memoryCache.set(key, value);
  if (memoryCache.size > MEMORY_CACHE_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
}

// Deduplicate in-flight upstream requests so a stampede of identical
// route lookups only hits the provider once.
const inflight = new Map<string, Promise<any>>();

// ── Postgres persistence (survives restarts) ──
let tableEnsured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableEnsured) {
    tableEnsured = execute(`
      CREATE TABLE IF NOT EXISTS route_cache (
        cache_key TEXT PRIMARY KEY,
        coords JSONB NOT NULL,
        distance DOUBLE PRECISION DEFAULT 0,
        duration DOUBLE PRECISION DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).then(() => undefined).catch((err) => {
      console.warn("⚠ route_cache table init failed (routing still works in-memory):", err.message);
      tableEnsured = null;
    });
  }
  return tableEnsured;
}

async function loadFromDb(key: string) {
  try {
    await ensureTable();
    const row = await queryOne<{ coords: string; distance: number; duration: number }>(
      `SELECT coords, distance, duration FROM route_cache
       WHERE cache_key = $1 AND created_at > NOW() - ($2 || ' milliseconds')::interval`,
      [key, ROUTE_CACHE_TTL_MS]
    );
    if (row) {
      return { coords: JSON.parse(row.coords) as number[][], distance: row.distance, duration: row.duration };
    }
  } catch (err: any) {
    console.warn("⚠ route_cache read failed:", err.message);
  }
  return null;
}

async function saveToDb(key: string, value: { coords: number[][]; distance: number; duration: number }) {
  try {
    await ensureTable();
    await execute(
      `INSERT INTO route_cache (cache_key, coords, distance, duration)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cache_key) DO UPDATE
         SET coords = EXCLUDED.coords,
             distance = EXCLUDED.distance,
             duration = EXCLUDED.duration,
             created_at = NOW()`,
      [key, JSON.stringify(value.coords), value.distance, value.duration]
    );
  } catch {
    // Best effort — in-memory cache still covers this request.
  }
}

async function fetchUpstream(points: string, overview: string) {
  const url = `${UPSTREAM}/route/v1/driving/${points}?geometries=geojson&overview=${overview}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "Accept-Encoding": "gzip" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Upstream routing failed: ${res.status}`);
    const data = (await res.json()) as { routes?: Array<{ geometry?: { coordinates?: number[][] }; distance?: number; duration?: number }> };
    const route = data?.routes?.[0];
    if (!route) return null;
    return {
      coords: (route.geometry?.coordinates ?? []) as number[][],
      distance: route.distance ?? 0,
      duration: route.duration ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

function respond(res: Response, value: { coords: number[][]; distance: number; duration: number }, cached: boolean) {
  res.json({
    cached,
    routes: [
      {
        geometry: { coordinates: value.coords },
        distance: value.distance,
        duration: value.duration,
      },
    ],
  });
}

// GET /api/route?points=lng,lat;lng,lat&overview=full
// Returns the same OSRM-style shape the app already parses, served from
// memory → Postgres → upstream, so repeat calls are instant.
router.get("/", async (req, res) => {
  try {
    const points = req.query.points as string | undefined;
    const overview = (req.query.overview as string) || "full";
    if (!points || !/^[-\d.,;]+$/.test(points)) {
      res.status(400).json({ error: "points must be in 'lng,lat;lng,lat' format" });
      return;
    }

    const key = `${points}|${overview}`;

    // 1. In-memory cache
    const mem = cacheGet(key);
    if (mem) {
      respond(res, mem, true);
      return;
    }

    // 2. Deduplicate in-flight upstream calls
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        const fromDb = await loadFromDb(key);
        if (fromDb) {
          cacheSet(key, fromDb);
          return fromDb;
        }
        const fromUpstream = await fetchUpstream(points, overview);
        if (!fromUpstream) throw new Error("No route found");
        cacheSet(key, fromUpstream);
        saveToDb(key, fromUpstream); // async, best-effort
        return fromUpstream;
      })().finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, pending);
    }

    const value = await pending;
    respond(res, value, false);
  } catch (err: any) {
    console.error("Route error:", err.message);
    if (err.message === "No route found") {
      res.status(404).json({ routes: [] });
      return;
    }
    res.status(502).json({ error: "Routing failed, please try again" });
  }
});

export default router;
