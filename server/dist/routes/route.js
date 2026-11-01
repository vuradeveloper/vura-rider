"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../config/database");
const providerSeams_1 = require("../services/providerSeams");
const router = (0, express_1.Router)();
// Upstream routing provider — env seam (services/providerSeams.ts):
//   ROUTE_PROVIDER_URL set -> that URL (self-hosted OSRM/Valhalla in production)
//   unset + production     -> NO request is ever made: fetchUpstream throws
//                             "Routing provider not configured" and the route
//                             answers 503 — never the public
//                             router.project-osrm.org demo, whose usage policy
//                             bans production traffic.
//   unset + dev            -> the public demo, so local flows keep working.
// Read LAZILY per request (dotenv/import-order safe), never a module const.
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
        legs JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).then(async () => {
            // Existing deployments created the table before turn-by-turn existed.
            await (0, database_1.execute)(`ALTER TABLE route_cache ADD COLUMN IF NOT EXISTS legs JSONB DEFAULT '[]'::jsonb`);
        }).catch((err) => {
            console.warn("⚠ route_cache table init failed (routing still works in-memory):", err.message);
            tableEnsured = null;
        });
    }
    return tableEnsured;
}
async function loadFromDb(key) {
    try {
        await ensureTable();
        const row = await (0, database_1.queryOne)(`SELECT coords, distance, duration, legs FROM route_cache
       WHERE cache_key = $1 AND created_at > NOW() - ($2 || ' milliseconds')::interval`, [key, ROUTE_CACHE_TTL_MS]);
        if (row) {
            // pg returns JSONB as an object, but be tolerant of a stringified column.
            const legs = typeof row.legs === "string" ? JSON.parse(row.legs) : row.legs;
            return {
                coords: JSON.parse(row.coords),
                distance: row.distance,
                duration: row.duration,
                legs: Array.isArray(legs) ? legs : [],
            };
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
        await (0, database_1.execute)(`INSERT INTO route_cache (cache_key, coords, distance, duration, legs)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cache_key) DO UPDATE
         SET coords = EXCLUDED.coords,
             distance = EXCLUDED.distance,
             duration = EXCLUDED.duration,
             legs = EXCLUDED.legs,
             created_at = NOW()`, [key, JSON.stringify(value.coords), value.distance, value.duration, JSON.stringify(value.legs)]);
    }
    catch {
        // Best effort — in-memory cache still covers this request.
    }
}
async function fetchUpstream(points, overview) {
    // OSRM routing provider (free, keyless, same OSRM-style shape the app
    // parses: geometry.coordinates as [lng,lat], distance, duration).
    const seam = (0, providerSeams_1.routeProvider)();
    if (!seam.url) {
        // Production without ROUTE_PROVIDER_URL: honest failure, never the demo.
        throw new Error("Routing provider not configured (set ROUTE_PROVIDER_URL)");
    }
    // steps=true is what makes turn-by-turn possible: OSRM then returns
    // legs[].steps with the street name, manoeuvre type/modifier and distance.
    // continue_straight=false stops OSRM forcing a U-turn/loop at via points:
    // with true (its default) a stop behind the car can add a little loop at the
    // start or end of the line, which looked like a drawing bug on the rider map.
    const url = `${seam.url}/route/v1/driving/${points}?geometries=geojson&overview=${overview}&steps=true&continue_straight=false`;
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
            legs: Array.isArray(route.legs) ? route.legs : [],
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
                // Manoeuvres for the driver HUD (and any rider preview that wants them).
                legs: value.legs,
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
        // `v3nostraight` busts cache rows written before continue_straight=false,
        // so the first request after this deploy returns the clean line instead of
        // waiting out the 7-day TTL.
        const key = `${points}|${overview}|v3nostraight`;
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
        if (typeof err.message === "string" && err.message.startsWith("Routing provider not configured")) {
            // Seam unset in production (see services/providerSeams.ts) — say so.
            res.status(503).json({ error: err.message });
            return;
        }
        res.status(502).json({ error: "Routing failed, please try again" });
    }
});
exports.default = router;
//# sourceMappingURL=route.js.map