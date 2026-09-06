"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// Upstream routing provider. Point ROUTE_PROVIDER_URL at your own
// self-hosted OSRM/Valhalla instance in production for the best speed.
const UPSTREAM = process.env.ROUTE_PROVIDER_URL?.replace(/\/+$/, "") ||
    "https://router.project-osrm.org";
// Mapbox Directions API (used first when a public token is configured so both
// apps share ONE authoritative route). Falls back to OSRM when unset/failing.
const MAPBOX_TOKEN = process.env.MAPBOX_PUBLIC_TOKEN || "";
const ROUTE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MEMORY_CACHE_MAX = 500;
const UPSTREAM_TIMEOUT_MS = 8000;
// ── In-memory LRU cache (fastest path, survives nothing but serves the
//    hot routes like the repeated pickup→destination lookups) ──
const memoryCache = new Map();
function cacheGet(key) {
    const hit = memoryCache.get(key);
    if (hit) {
        // Refresh recency so it counts as LRU
        memoryCache.delete(key);
        memoryCache.set(key, hit);
    }
    return hit;
}
function cacheSet(key, value) {
    memoryCache.set(key, value);
    if (memoryCache.size > MEMORY_CACHE_MAX) {
        const oldest = memoryCache.keys().next().value;
        if (oldest)
            memoryCache.delete(oldest);
    }
}
// Deduplicate in-flight upstream requests so a stampede of identical
// route lookups only hits the provider once.
const inflight = new Map();
// ── Postgres persistence (survives restarts) ──
let tableEnsured = null;
function ensureTable() {
    if (!tableEnsured) {
        tableEnsured = (0, database_1.execute)(`
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
async function loadFromDb(key) {
    try {
        await ensureTable();
        const row = await (0, database_1.queryOne)(`SELECT coords, distance, duration FROM route_cache
       WHERE cache_key = $1 AND created_at > NOW() - ($2 || ' milliseconds')::interval`, [key, ROUTE_CACHE_TTL_MS]);
        if (row) {
            return { coords: JSON.parse(row.coords), distance: row.distance, duration: row.duration };
        }
    }
    catch (err) {
        console.warn("⚠ route_cache read failed:", err.message);
    }
    return null;
}
async function saveToDb(key, value) {
    try {
        await ensureTable();
        await (0, database_1.execute)(`INSERT INTO route_cache (cache_key, coords, distance, duration)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cache_key) DO UPDATE
         SET coords = EXCLUDED.coords,
             distance = EXCLUDED.distance,
             duration = EXCLUDED.duration,
             created_at = NOW()`, [key, JSON.stringify(value.coords), value.distance, value.duration]);
    }
    catch {
        // Best effort — in-memory cache still covers this request.
    }
}
async function fetchUpstream(points, overview) {
    // Primary: Mapbox Directions — returns the same OSRM-style shape the app
    // parses (geometry.coordinates as [lng,lat], distance, duration).
    if (MAPBOX_TOKEN) {
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${points}.json?` +
                `access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=${overview}&steps=false`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
            try {
                const res = await fetch(url, { headers: { "Accept-Encoding": "gzip" }, signal: controller.signal });
                if (res.ok) {
                    const data = (await res.json());
                    const route = data?.routes?.[0];
                    if (route && Array.isArray(route?.geometry?.coordinates)) {
                        return {
                            coords: route.geometry.coordinates,
                            distance: route.distance ?? 0,
                            duration: route.duration ?? 0,
                        };
                    }
                }
            }
            finally {
                clearTimeout(timer);
            }
        }
        catch {
            // fall through to OSRM
        }
    }
    // Fallback: OSRM
    const url = `${UPSTREAM}/route/v1/driving/${points}?geometries=geojson&overview=${overview}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: { "Accept-Encoding": "gzip" },
            signal: controller.signal,
        });
        if (!res.ok)
            throw new Error(`Upstream routing failed: ${res.status}`);
        const data = (await res.json());
        const route = data?.routes?.[0];
        if (!route)
            return null;
        return {
            coords: (route.geometry?.coordinates ?? []),
            distance: route.distance ?? 0,
            duration: route.duration ?? 0,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
function respond(res, value, cached) {
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
        const points = req.query.points;
        const overview = req.query.overview || "full";
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
                if (!fromUpstream)
                    throw new Error("No route found");
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
    }
    catch (err) {
        console.error("Route error:", err.message);
        if (err.message === "No route found") {
            res.status(404).json({ routes: [] });
            return;
        }
        res.status(502).json({ error: "Routing failed, please try again" });
    }
});
exports.default = router;
//# sourceMappingURL=route.js.map