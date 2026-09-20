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
// ─────────────────────────────────────────────────────────────────────────────
//  HERE WeGo-exact search helpers
//
//  HERE WeGo drives its search box with TWO HERE APIs, and so do we:
//    • Autosuggest (/v1/autosuggest) — the typeahead dropdown: places,
//      addresses, building entrances, plus the category / chain "quick search"
//      rows ("Restaurants", "STARBUCKS") and the "did you mean" terms.
//    • Discover    (/v1/discover)    — the submitted full-text search: the
//      canonical place records (malls, markets, airports, taxi ranks …).
//
//  We call BOTH and keep HERE's own relevance order (never re-sorted, never
//  radius-trimmed) so a far-away canonical place such as "Fourways Farmers
//  Market" always stays visible. `sort=distance` is opt-in for callers that
//  explicitly want closest-first.
// ─────────────────────────────────────────────────────────────────────────────
type HereItem = {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  resultType: string;
  id?: string;
  href?: string;
  distance?: number;
  categories: string[];
  primaryCategory?: string;
  highlights?: any;
};

// Maps a raw HERE item (Autosuggest and Discover share the same shape) into the
// exact payload the rider app renders — title, label, position, distance badge,
// category icon, bold-match highlights and the follow-up `href`.
function mapHereItem(item: any, fallback: string): HereItem {
  return {
    name: item?.title || item?.address?.label || fallback,
    address: item?.address?.label || item?.title || "",
    lat: Number.isFinite(item?.position?.lat) ? item.position.lat : undefined,
    lng: Number.isFinite(item?.position?.lng) ? item.position.lng : undefined,
    resultType: item?.resultType || "place",
    id: item?.id,
    href: item?.href,
    // Straight-line metres from `at`, exactly the number WeGo shows as a badge.
    distance: Number.isFinite(item?.distance) ? item.distance : undefined,
    categories: (item?.categories || []).map((c: any) => c.name).filter(Boolean),
    primaryCategory: (item?.categories || []).find((c: any) => c.primary)?.name,
    highlights: item?.highlights || null,
  };
}

// Stable identity so the same place returned by BOTH endpoints is listed once.
function hereItemKey(it: HereItem): string {
  if (it.id) return `id:${it.id}`;
  const coords =
    Number.isFinite(it.lat) && Number.isFinite(it.lng)
      ? `${Number(it.lat).toFixed(4)},${Number(it.lng).toFixed(4)}`
      : "";
  return `nm:${it.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${coords}`;
}

// Shared GET helper — a HERE hiccup must never break the rider's search.
async function hereJson(url: string): Promise<any | null> {
  return fetch(url, { headers: { "User-Agent": "VuraRiderServer/1.0" } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

// Closest-first. Only used when the caller asks for `sort=distance`; items with
// no coordinate (category/chain rows) always sink to the bottom.
function sortByStraightLineDistance(items: HereItem[]): HereItem[] {
  return items
    .map((it, index) => ({ it, index }))
    .sort((a, b) => {
      const da = Number.isFinite(a.it.distance) ? (a.it.distance as number) : Number.POSITIVE_INFINITY;
      const db = Number.isFinite(b.it.distance) ? (b.it.distance as number) : Number.POSITIVE_INFINITY;
      return da === db ? a.index - b.index : da - db;
    })
    .map((x) => x.it);
}

// GET /api/search/geocode?q=..&lat=..&lng=..&limit=..&sort=distance
// HERE WeGo-exact search: Autosuggest ranking + Discover canonical top-up,
// with OpenStreetMap (Nominatim) as the silent last-resort fallback.

router.get("/geocode", requireAuth, async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const limit = Math.max(1, Math.min(15, parseInt((req.query.limit as string) || "10", 10)));
  const wantsDistance = String(req.query.sort || "").toLowerCase() === "distance";
  const hasAt = Number.isFinite(lat) && Number.isFinite(lng);
  if (!q) { res.json({ provider: "here", items: [], queryTerms: [] }); return; }

  try {
    const HERE_KEY = process.env.HERE_API_KEY || "";
    if (HERE_KEY) {
      const shared = new URLSearchParams({ q, limit: "15", lang: "eng" });
      if (hasAt) shared.set("at", `${lat},${lng}`);
      const suggestParams = new URLSearchParams(shared);
      suggestParams.set("termsLimit", "5");
      const hereKey = encodeURIComponent(HERE_KEY);

      // Autosuggest + Discover in parallel — WeGo's typeahead plus its
      // submitted-search index, so no canonical place is ever missed.
      const [suggest, discover] = await Promise.all([
        hereJson(`https://autosuggest.search.hereapi.com/v1/autosuggest?${suggestParams.toString()}&apiKey=${hereKey}`),
        hereJson(`https://discover.search.hereapi.com/v1/discover?${shared.toString()}&apiKey=${hereKey}`),
      ]);

      const items: HereItem[] = [];
      const seen = new Set<string>();
      const add = (raw: any) => {
        const mapped = mapHereItem(raw, q);
        if (!mapped.name) return;
        const dedupeKey = hereItemKey(mapped);
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        items.push(mapped);
      };

      // 1) Autosuggest first — HERE's own ranking, exactly as WeGo lists it.
      (suggest?.items || []).forEach(add);
      // 2) Then any canonical Discover place Autosuggest did not return.
      (discover?.items || []).forEach(add);

      if (items.length > 0) {
        const ordered = wantsDistance ? sortByStraightLineDistance(items) : items;
        res.json({
          provider: "here",
          sort: wantsDistance ? "distance" : "relevance",
          items: ordered.slice(0, limit),
          queryTerms: (suggest?.queryTerms || [])
            .map((t: any) => (typeof t === "string" ? t : t?.term))
            .filter(Boolean),
        });
        return;
      }
      console.warn("[search] HERE returned nothing, falling back to OSM");
    }

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

    const items = (Array.isArray(raw) ? raw : []).map((item: any) => ({
      name: String(item.display_name || q).split(",")[0],
      address: String(item.display_name || "").split(",").slice(1).join(",").trim(),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      resultType: "address",
    })).slice(0, limit);

    res.json({ provider: "nominatim", items, queryTerms: [] });
  } catch (err: any) {
    console.error("Search geocode error:", err.message);
    res.status(502).json({ error: "Search failed. Please try again." });
  }
});

// GET /api/search/discover?q=..&lat=..&lng=..&limit=..
// Full-text place/category/chain search — the follow-up endpoint WeGo uses when
// a rider taps a "restaurants"/"Starbucks"-style suggestion row.
router.get("/discover", requireAuth, async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const limit = Math.max(1, Math.min(15, parseInt((req.query.limit as string) || "10", 10)));
  const wantsDistance = String(req.query.sort || "").toLowerCase() === "distance";
  const hasAt = Number.isFinite(lat) && Number.isFinite(lng);
  if (!q) { res.json({ provider: "here", items: [], queryTerms: [] }); return; }

  try {
    const HERE_KEY = process.env.HERE_API_KEY || "";
    if (!HERE_KEY) {
      console.warn("[search] HERE_API_KEY missing — discover returned empty");
      res.json({ provider: "here", items: [], queryTerms: [] });
      return;
    }

    const shared = new URLSearchParams({ q, limit: "15", lang: "eng" });
    if (hasAt) shared.set("at", `${lat},${lng}`);
    const hereKey = encodeURIComponent(HERE_KEY);

    const [discover, suggest] = await Promise.all([
      hereJson(`https://discover.search.hereapi.com/v1/discover?${shared.toString()}&apiKey=${hereKey}`),
      hereJson(`https://autosuggest.search.hereapi.com/v1/autosuggest?${shared.toString()}&termsLimit=5&apiKey=${hereKey}`),
    ]);

    const items: HereItem[] = [];
    const seen = new Set<string>();
    const add = (raw: any) => {
      const mapped = mapHereItem(raw, q);
      if (!mapped.name) return;
      const dedupeKey = hereItemKey(mapped);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      items.push(mapped);
    };

    // A submitted search (WeGo's follow-up tap) is Discover-led…
    (discover?.items || []).forEach(add);
    // …with Autosuggest filling the gaps (category/chain rows, entrances).
    (suggest?.items || []).forEach(add);

    const ordered = wantsDistance ? sortByStraightLineDistance(items) : items;
    res.json({
      provider: "here",
      sort: wantsDistance ? "distance" : "relevance",
      items: ordered.slice(0, limit),
      queryTerms: [],
    });
  } catch (err: any) {
    console.error("Discover search error:", err.message);
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
    // ── HERE Maps reverse geocoding (primary) ──
    const HERE_KEY = process.env.HERE_API_KEY || "";
    if (HERE_KEY) {
      const here: any = await fetch(
        `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&limit=1&lang=eng&apiKey=${encodeURIComponent(HERE_KEY)}`,
        { headers: { "User-Agent": "VuraRiderServer/1.0" } }
      )
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