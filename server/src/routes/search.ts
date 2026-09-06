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

// ── Mapbox-backed place search ──
// GET /api/search?q=...&lat=...&lng=...&limit=8
// Returns Google/Mapbox-quality place autocomplete (finds malls, landmarks,
// businesses — not just roads). The Mapbox public token lives on the server,
// never in the app. Falls back to OSM search if Mapbox is unset/unreachable.
const MAPBOX_TOKEN = process.env.MAPBOX_PUBLIC_TOKEN || "";
const MAPBOX_API = "https://api.mapbox.com";

router.get("/geocode", requireAuth, async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const limit = Math.min(10, parseInt(req.query.limit as string || "6", 10));
  if (!q) { res.json({ features: [] }); return; }

  try {
    const proximity =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `&proximity=${lng},${lat}`
        : "";

    // Fetch Mapbox (when a token exists) AND OSM Nominatim in parallel, then
    // merge + score them so the best real place wins.
    // (Mapbox alone often misses SA place/POI names like "Campus Square",
    // returning only fuzzy street-name matches — OSM fills that gap.)
    const [mapboxData, osmData] = await Promise.all([
      MAPBOX_TOKEN
        ? fetch(
            `${MAPBOX_API}/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}` +
              `&limit=${Math.min(10, limit + 4)}&country=za${proximity}&types=poi,address,locality,district,place`,
            { headers: { "Accept-Encoding": "gzip" } }
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=${Math.max(limit, 12)}&q=${encodeURIComponent(q)}` +
          (Number.isFinite(lat) && Number.isFinite(lng) ? `&lat=${lat}&lon=${lng}` : ""),
        { headers: { "User-Agent": "VuraRiderServer/1.0" } }
      )
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]);

    const tokens = q
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    // Score: full-query prefix best, then ALL tokens present, then ANY token,
    // then proximity bonus so local SA places outrank overseas look-alikes.
    const haversineKm = (a: number, b: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
      const R = 6371;
      const dLat = ((a - lat) * Math.PI) / 180;
      const dLng = ((b - lng) * Math.PI) / 180;
      const s1 = Math.sin(dLat / 2) ** 2;
      const s2 =
        Math.sin(dLng / 2) ** 2 *
        Math.cos((lat * Math.PI) / 180) *
        Math.cos((a * Math.PI) / 180);
      return 2 * R * Math.asin(Math.sqrt(s1 + s2));
    };

    const scoreResult = (name: string, addr: string, rlat?: number, rlng?: number): number => {
      const hay = `${name} ${addr}`.toLowerCase();
      if (!hay) return 0;
      const ql = q.toLowerCase();
      let s = 0;
      if (hay.startsWith(ql)) s += 5;
      if (hay.includes(ql)) s += 4;
      const all = tokens.length > 0 && tokens.every((t) => hay.includes(t));
      const any = tokens.some((t) => hay.includes(t));
      if (all) s += 3;
      else if (any) s += 1;
      // Everything else equal, being close to the user tips the ranking.
      if (rlat != null && rlng != null) {
        const dist = haversineKm(rlat, rlng);
        if (dist < 50) s += 6; // same city
        else if (dist < 250) s += 4;
        else if (dist < 900) s += 2; // same country-ish
        else if (dist < 3000) s += 1; // same continent
      }
      return s;
    };

    const merged = new Map<string, any>();
    const add = (item: any) => {
      if (item.lat == null || item.lng == null) return;
      const key = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
      const s = scoreResult(item.name, item.address, item.lat, item.lng);
      const existing = merged.get(key);
      if (!existing || existing._score < s) merged.set(key, { ...item, _score: s });
    };

    const mbData = mapboxData as { features?: any[] } | null;
    const mapboxFeatures = (Array.isArray(mbData?.features) ? mbData!.features : []).map(
      (f: any) => ({
        name: f.text || f.place_name?.split(",")[0] || q,
        address: String(f.place_name || "").split(",").slice(1).join(",").trim(),
        lat: Number(f.center?.[1]),
        lng: Number(f.center?.[0]),
        type: f.place_type?.[0] || "place",
      })
    );
    mapboxFeatures.forEach(add);

    const osmResults = (Array.isArray(osmData) ? osmData : []).map((item: any) => ({
      name: String(item.display_name || q).split(",")[0],
      address: String(item.display_name || "").split(",").slice(1).join(",").trim(),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: "osm",
    }));
    osmResults.forEach(add);

    const results = Array.from(merged.values())
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...rest }: any) => rest);

    res.json({ provider: MAPBOX_TOKEN ? "mapbox+osm" : "nominatim", results });
  } catch (err: any) {
    console.error("Search geocode error:", err.message);
    res.status(502).json({ error: "Search failed. Please try again." });
  }
});

// GET /api/search/reverse?lat=..&lng=..
// Reverse-geocodes a coordinate to a human address (Mapbox-first, OSM fallback).
router.get("/reverse", requireAuth, async (req: AuthRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  try {
    if (MAPBOX_TOKEN) {
      const url =
        `${MAPBOX_API}/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}` +
        `&limit=1&types=poi,address,locality,district,place`;
      const upstream = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
      if (upstream.ok) {
        const data = (await upstream.json()) as any;
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