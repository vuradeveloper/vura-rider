"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
// Ensure table exists
async function ensureTable() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS recent_searches (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      name VARCHAR(255) NOT NULL,
      address TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
// GET /api/searches — Get recent searches
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTable();
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ searches: [] });
            return;
        }
        const searches = await (0, database_1.query)("SELECT id, name, address AS addr, lat, lng, created_at FROM recent_searches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20", [user.id]);
        res.json({ searches });
    }
    catch (err) {
        console.error("Get searches error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/searches — Save a search
router.post("/", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureTable();
        const firebaseUid = req.userId;
        const { name, address, lat, lng } = req.body;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        await (0, database_1.execute)(`INSERT INTO recent_searches (user_id, name, address, lat, lng) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, name) DO UPDATE SET address = EXCLUDED.address, lat = EXCLUDED.lat, lng = EXCLUDED.lng, created_at = NOW()`, [user.id, name, address, lat, lng]);
        res.status(201).json({ success: true });
    }
    catch (err) {
        if (err.code === "42P01") {
            res.status(201).json({ success: true });
            return;
        }
        console.error("Save search error:", err);
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/searches — Clear searches
router.delete("/", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ success: true });
            return;
        }
        await (0, database_1.execute)("DELETE FROM recent_searches WHERE user_id = $1", [user.id]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Clear searches error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── Mapbox-backed place search ──
// GET /api/search?q=...&lat=...&lng=...&limit=8
// Returns Google/Mapbox-quality place autocomplete (finds malls, landmarks,
// businesses — not just roads). The Mapbox public token lives on the server,
// never in the app. Falls back to OSM search if Mapbox is unset/unreachable.
const MAPBOX_TOKEN = process.env.MAPBOX_PUBLIC_TOKEN || "";
const MAPBOX_API = "https://api.mapbox.com";
router.get("/geocode", auth_1.requireAuth, async (req, res) => {
    const q = String(req.query.q || "").trim();
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit = Math.min(10, parseInt(req.query.limit || "6", 10));
    if (!q) {
        res.json({ features: [] });
        return;
    }
    try {
        // Prefer Mapbox when a token exists.
        if (MAPBOX_TOKEN) {
            const proximity = Number.isFinite(lat) && Number.isFinite(lng)
                ? `&proximity=${lng},${lat}`
                : "";
            const url = `${MAPBOX_API}/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}` +
                `&limit=${limit}&country=za${proximity}&types=poi,address,locality,district,place`;
            const upstream = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
            if (!upstream.ok)
                throw new Error(`Mapbox geocode failed: ${upstream.status}`);
            const data = (await upstream.json());
            const features = (data?.features || []).map((f) => ({
                name: f.text || f.place_name?.split(",")[0] || q,
                address: String(f.place_name || "").split(",").slice(1).join(",").trim(),
                lat: Number(f.center?.[1]),
                lng: Number(f.center?.[0]),
                type: f.place_type?.[0] || "place",
            }));
            res.json({ provider: "mapbox", results: features });
            return;
        }
        // Fallback: OSM Nominatim (current behavior).
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&q=${encodeURIComponent(q)}` +
            (Number.isFinite(lat) && Number.isFinite(lng) ? `&lat=${lat}&lon=${lng}` : "");
        const upstream = await fetch(url, { headers: { "User-Agent": "VuraRiderServer/1.0" } });
        const data = (await upstream.json());
        const results = (Array.isArray(data) ? data : []).map((item) => ({
            name: String(item.display_name || q).split(",")[0],
            address: String(item.display_name || "").split(",").slice(1).join(",").trim(),
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            type: "osm",
        }));
        res.json({ provider: "nominatim", results });
    }
    catch (err) {
        console.error("Search geocode error:", err.message);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
});
// GET /api/search/reverse?lat=..&lng=..
// Reverse-geocodes a coordinate to a human address (Mapbox-first, OSM fallback).
router.get("/reverse", auth_1.requireAuth, async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        res.status(400).json({ error: "lat and lng are required" });
        return;
    }
    try {
        if (MAPBOX_TOKEN) {
            const url = `${MAPBOX_API}/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}` +
                `&limit=1&types=poi,address,locality,district,place`;
            const upstream = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
            if (upstream.ok) {
                const data = (await upstream.json());
                const f = data?.features?.[0];
                if (f?.place_name) {
                    res.json({ provider: "mapbox", name: f.text || f.place_name.split(",")[0], address: f.place_name });
                    return;
                }
            }
        }
        // Fallback: OSM reverse.
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
        const upstream = await fetch(url, { headers: { "User-Agent": "VuraRiderServer/1.0" } });
        const d = (await upstream.json());
        res.json({
            provider: "nominatim",
            name: d?.display_name?.split(",")[0] || "Current location",
            address: d?.display_name || "Current location",
        });
    }
    catch (err) {
        console.error("Reverse geocode error:", err.message);
        res.status(502).json({ error: "Could not get address" });
    }
});
exports.default = router;
//# sourceMappingURL=search.js.map