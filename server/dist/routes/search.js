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
// ── OpenStreetMap (Nominatim) place search ──
// GET /api/search/geocode?q=...&lat=...&lng=...&limit=6
// Free, keyless place autocomplete from OpenStreetMap.
router.get("/geocode", auth_1.requireAuth, async (req, res) => {
    const q = String(req.query.q || "").trim();
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit = Math.min(10, parseInt(req.query.limit || "8", 10));
    if (!q) {
        res.json({ provider: "here", items: [], queryTerms: [] });
        return;
    }
    try {
        // ── HERE Maps Autosuggest — the EXACT engine HERE WeGo uses ──
        // Pass through everything WeGo's UI reads: title, id, resultType,
        // address.label, position, distance (straight-line metres from `at`),
        // categories, highlights, and `href` for chain/category follow-ups.
        // HERE's item ORDER (most-relevant first) is preserved verbatim.
        const HERE_KEY = process.env.HERE_API_KEY || "";
        if (HERE_KEY) {
            const hereParams = new URLSearchParams({
                q,
                limit: String(Math.max(limit, 10)),
                lang: "eng",
                termsLimit: "5",
            });
            if (Number.isFinite(lat) && Number.isFinite(lng))
                hereParams.set("at", `${lat},${lng}`);
            const here = await fetch(`https://autosuggest.search.hereapi.com/v1/autosuggest?${hereParams.toString()}&apiKey=${encodeURIComponent(HERE_KEY)}`, { headers: { "User-Agent": "VuraRiderServer/1.0" } })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
            if (here?.items?.length) {
                const items = here.items
                    .map((item) => ({
                    name: item.title || item.address?.label || q,
                    address: item.address?.label || item.title || "",
                    lat: item.position?.lat,
                    lng: item.position?.lng,
                    resultType: item.resultType || "place",
                    id: item.id,
                    href: item.href,
                    distance: Number.isFinite(item.distance) ? item.distance : undefined,
                    categories: (item.categories || []).map((c) => c.name).filter(Boolean),
                    primaryCategory: (item.categories || []).find((c) => c.primary)?.name,
                    highlights: item.highlights,
                }))
                    .slice(0, limit);
                res.json({
                    provider: "here",
                    items,
                    queryTerms: Array.isArray(here.queryTerms)
                        ? here.queryTerms.map((qt) => (typeof qt === "string" ? qt : qt?.term)).filter(Boolean)
                        : [],
                });
                return;
            }
            console.warn("[search] HERE returned nothing, falling back to OSM");
        }
        const base = (process.env.NOMINATIM_URL?.replace(/\/+$/, "") ||
            "https://nominatim.openstreetmap.org");
        const raw = (await fetch(`${base}/search?format=json&limit=${Math.max(limit, 12)}&q=${encodeURIComponent(q)}` +
            (Number.isFinite(lat) && Number.isFinite(lng) ? `&lat=${lat}&lon=${lng}` : ""), { headers: { "User-Agent": "VuraRiderServer/1.0" } })
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => []));
        const items = (Array.isArray(raw) ? raw : []).map((item) => ({
            name: String(item.display_name || q).split(",")[0],
            address: String(item.display_name || "").split(",").slice(1).join(",").trim(),
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            resultType: "address",
        })).slice(0, limit);
        res.json({ provider: "nominatim", items, queryTerms: [] });
    }
    catch (err) {
        console.error("Search geocode error:", err.message);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
});
// GET /api/search/discover?q=..&lat=..&lng=..&limit=..
// Full-text place/category/chain search — the follow-up endpoint WeGo uses when
// a rider taps a "restaurants"/"Starbucks"-style suggestion row.
router.get("/discover", auth_1.requireAuth, async (req, res) => {
    const q = String(req.query.q || "").trim();
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit = Math.min(15, parseInt(req.query.limit || "10", 10));
    if (!q) {
        res.json({ provider: "here", items: [], queryTerms: [] });
        return;
    }
    try {
        const HERE_KEY = process.env.HERE_API_KEY || "";
        const params = new URLSearchParams({
            q,
            limit: String(Math.max(limit, 12)),
            lang: "eng",
        });
        if (Number.isFinite(lat) && Number.isFinite(lng))
            params.set("at", `${lat},${lng}`);
        const here = await fetch(`https://discover.search.hereapi.com/v1/discover?${params.toString()}&apiKey=${encodeURIComponent(HERE_KEY)}`, { headers: { "User-Agent": "VuraRiderServer/1.0" } })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
        const items = (here?.items || [])
            .map((item) => ({
            name: item.title || item.address?.label || q,
            address: item.address?.label || item.title || "",
            lat: item.position?.lat,
            lng: item.position?.lng,
            resultType: item.resultType || "place",
            id: item.id,
            href: item.href,
            distance: Number.isFinite(item.distance) ? item.distance : undefined,
            categories: (item.categories || []).map((c) => c.name).filter(Boolean),
            primaryCategory: (item.categories || []).find((c) => c.primary)?.name,
            highlights: item.highlights,
        }))
            .slice(0, limit);
        res.json({ provider: "here", items, queryTerms: [] });
    }
    catch (err) {
        console.error("Discover search error:", err.message);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
});
// GET /api/search/reverse?lat=..&lng=..
// Reverse-geocodes a coordinate to a human address via OSM Nominatim.
router.get("/reverse", auth_1.requireAuth, async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        res.status(400).json({ error: "lat and lng are required" });
        return;
    }
    try {
        // ── HERE Maps reverse geocoding (primary) ──
        const HERE_KEY = process.env.HERE_API_KEY || "";
        if (HERE_KEY) {
            const here = await fetch(`https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&limit=1&lang=eng&apiKey=${encodeURIComponent(HERE_KEY)}`, { headers: { "User-Agent": "VuraRiderServer/1.0" } })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
            if (here?.items?.length) {
                const item = here.items[0];
                const addr = item?.address?.label || item?.title || "Current location";
                res.json({
                    provider: "here",
                    name: String(addr).split(",")[0],
                    address: addr,
                });
                return;
            }
            console.warn("[search] HERE reverse empty, falling back to OSM");
        }
        const base = (process.env.NOMINATIM_URL?.replace(/\/+$/, "") ||
            "https://nominatim.openstreetmap.org");
        const url = `${base}/reverse?format=json&lat=${lat}&lon=${lng}`;
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
// ─────────────────────────────────────────────────────────────────────────────
//  Community Places — user-added places ("drop a pin + name it") so new
//  buildings / student accommodation that aren't in any map database become
//  searchable by EVERY rider. This is the "Wikipedia for our map" layer.
// ─────────────────────────────────────────────────────────────────────────────
async function ensureCommunityTable() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS community_places (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      address TEXT,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      created_by UUID REFERENCES users(id),
      uses_count INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (name, lat, lng)
    )
  `);
}
// GET /api/search/community?q=..&lat=..&lng=.. — community places (local-first).
router.get("/community", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureCommunityTable();
        const q = String(req.query.q || "").trim().toLowerCase();
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const limit = Math.min(20, parseInt(req.query.limit || "10", 10));
        let rows = [];
        if (q.length >= 2) {
            rows = await (0, database_1.query)(`SELECT name, address, lat, lng, uses_count
         FROM community_places
         WHERE lower(name) LIKE $1 OR lower(address) LIKE $1
         ORDER BY uses_count DESC, created_at DESC
         LIMIT $2`, [`%${q}%`, limit]);
        }
        else {
            // No query: return most-used community places (for the "Popular near you" strip).
            rows = await (0, database_1.query)(`SELECT name, address, lat, lng, uses_count
         FROM community_places
         ORDER BY uses_count DESC, created_at DESC
         LIMIT $2`, [limit]);
        }
        // If we have a location, sort by distance so local places rank first.
        if (Number.isFinite(lat) && Number.isFinite(lng) && rows.length > 1) {
            rows = [...rows].sort((a, b) => {
                const da = Math.hypot(a.lat - lat, a.lng - lng);
                const db = Math.hypot(b.lat - lat, b.lng - lng);
                return da - db;
            });
        }
        res.json({ provider: "community", results: rows });
    }
    catch (err) {
        console.error("Community search error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/search/community — rider names a dropped pin; upsert by (name, lat, lng).
router.post("/community", auth_1.requireAuth, async (req, res) => {
    try {
        await ensureCommunityTable();
        const { name, address, lat, lng } = req.body;
        const cleanName = String(name || "").trim().slice(0, 255);
        if (!cleanName || !Number.isFinite(parseFloat(lat)) || !Number.isFinite(parseFloat(lng))) {
            res.status(400).json({ error: "name, lat and lng are required" });
            return;
        }
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        await (0, database_1.execute)(`INSERT INTO community_places (name, address, lat, lng, created_by, uses_count)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (name, lat, lng) DO UPDATE
         SET address = EXCLUDED.address, uses_count = community_places.uses_count + 1`, [cleanName, String(address || "").slice(0, 500), parseFloat(lat), parseFloat(lng), user?.id]);
        res.status(201).json({ success: true, name: cleanName });
    }
    catch (err) {
        if (err.code === "42P01") {
            res.status(201).json({ success: true });
            return;
        }
        console.error("Save community place error:", err);
        res.status(400).json({ error: err.message });
    }
});
//# sourceMappingURL=search.js.map