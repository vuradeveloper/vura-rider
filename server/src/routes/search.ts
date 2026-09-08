import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// Ensure table exists
async function ensureTable() {
  await execute(`
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
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTable();
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.json({ searches: [] }); return; }

    const searches = await query(
      "SELECT id, name, address AS addr, lat, lng, created_at FROM recent_searches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
      [user.id]
    );
    res.json({ searches });
  } catch (err: any) {
    console.error("Get searches error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches — Save a search
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTable();
    const firebaseUid = req.userId!;
    const { name, address, lat, lng } = req.body;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    await execute(
      `INSERT INTO recent_searches (user_id, name, address, lat, lng) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, name) DO UPDATE SET address = EXCLUDED.address, lat = EXCLUDED.lat, lng = EXCLUDED.lng, created_at = NOW()`,
      [user.id, name, address, lat, lng]
    );
    res.status(201).json({ success: true });
  } catch (err: any) {
    if (err.code === "42P01") { res.status(201).json({ success: true }); return; }
    console.error("Save search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches — Clear searches
router.delete("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.json({ success: true }); return; }
    await execute("DELETE FROM recent_searches WHERE user_id = $1", [user.id]);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Clear searches error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── OpenStreetMap (Nominatim) place search ──
// GET /api/search/geocode?q=...&lat=...&lng=...&limit=6
// Free, keyless place autocomplete from OpenStreetMap.

router.get("/geocode", requireAuth, async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const limit = Math.min(10, parseInt(req.query.limit as string || "6", 10));
  if (!q) { res.json({ results: [] }); return; }

  try {
    const base = (
      process.env.NOMINATIM_URL?.replace(/\/+$/, "") ||
      "https://nominatim.openstreetmap.org"
    );
    const raw = (await fetch(
      `${base}/search?format=json&limit=${Math.max(limit, 12)}&q=${encodeURIComponent(q)}` +
        (Number.isFinite(lat) && Number.isFinite(lng) ? `&lat=${lat}&lon=${lng}` : ""),
      { headers: { "User-Agent": "VuraRiderServer/1.0" } }
    )
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])) as any[];

    const results = (Array.isArray(raw) ? raw : []).map((item: any) => ({
      name: String(item.display_name || q).split(",")[0],
      address: String(item.display_name || "").split(",").slice(1).join(",").trim(),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: "osm",
    })).slice(0, limit);

    res.json({ provider: "nominatim", results });
  } catch (err: any) {
    console.error("Search geocode error:", err.message);
    res.status(502).json({ error: "Search failed. Please try again." });
  }
});

// GET /api/search/reverse?lat=..&lng=..
// Reverse-geocodes a coordinate to a human address via OSM Nominatim.
router.get("/reverse", requireAuth, async (req: AuthRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  try {
    const base = (
      process.env.NOMINATIM_URL?.replace(/\/+$/, "") ||
      "https://nominatim.openstreetmap.org"
    );
    const url = `${base}/reverse?format=json&lat=${lat}&lon=${lng}`;
    const upstream = await fetch(url, { headers: { "User-Agent": "VuraRiderServer/1.0" } });
    const d = (await upstream.json()) as any;
    res.json({
      provider: "nominatim",
      name: d?.display_name?.split(",")[0] || "Current location",
      address: d?.display_name || "Current location",
    });
  } catch (err: any) {
    console.error("Reverse geocode error:", err.message);
    res.status(502).json({ error: "Could not get address" });
  }
});

export default router;

// ─────────────────────────────────────────────────────────────────────────────
//  Community Places — user-added places ("drop a pin + name it") so new
//  buildings / student accommodation that aren't in any map database become
//  searchable by EVERY rider. This is the "Wikipedia for our map" layer.
// ─────────────────────────────────────────────────────────────────────────────
async function ensureCommunityTable() {
  await execute(`
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
router.get("/community", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureCommunityTable();
    const q = String(req.query.q || "").trim().toLowerCase();
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const limit = Math.min(20, parseInt(req.query.limit as string || "10", 10));

    let rows: any[] = [];
    if (q.length >= 2) {
      rows = await query(
        `SELECT name, address, lat, lng, uses_count
         FROM community_places
         WHERE lower(name) LIKE $1 OR lower(address) LIKE $1
         ORDER BY uses_count DESC, created_at DESC
         LIMIT $2`,
        [`%${q}%`, limit]
      );
    } else {
      // No query: return most-used community places (for the "Popular near you" strip).
      rows = await query(
        `SELECT name, address, lat, lng, uses_count
         FROM community_places
         ORDER BY uses_count DESC, created_at DESC
         LIMIT $2`,
        [limit]
      );
    }

    // If we have a location, sort by distance so local places rank first.
    if (Number.isFinite(lat) && Number.isFinite(lng) && rows.length > 1) {
      rows = [...rows].sort((a: any, b: any) => {
        const da = Math.hypot(a.lat - lat, a.lng - lng);
        const db = Math.hypot(b.lat - lat, b.lng - lng);
        return da - db;
      });
    }
    res.json({ provider: "community", results: rows });
  } catch (err: any) {
    console.error("Community search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/search/community — rider names a dropped pin; upsert by (name, lat, lng).
router.post("/community", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureCommunityTable();
    const { name, address, lat, lng } = req.body;
    const cleanName = String(name || "").trim().slice(0, 255);
    if (!cleanName || !Number.isFinite(parseFloat(lat)) || !Number.isFinite(parseFloat(lng))) {
      res.status(400).json({ error: "name, lat and lng are required" });
      return;
    }
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);

    await execute(
      `INSERT INTO community_places (name, address, lat, lng, created_by, uses_count)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (name, lat, lng) DO UPDATE
         SET address = EXCLUDED.address, uses_count = community_places.uses_count + 1`,
      [cleanName, String(address || "").slice(0, 500), parseFloat(lat), parseFloat(lng), user?.id]
    );
    res.status(201).json({ success: true, name: cleanName });
  } catch (err: any) {
    if (err.code === "42P01") { res.status(201).json({ success: true }); return; }
    console.error("Save community place error:", err);
    res.status(400).json({ error: err.message });
  }
});