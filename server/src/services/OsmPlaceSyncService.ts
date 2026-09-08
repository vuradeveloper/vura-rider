import { execute, query } from "../config/database";

// ── OpenStreetMap named-place auto-sync ────────────────────────────────────
// Periodically queries Overpass (the OSM read API) for named places
// (buildings, amenities, shops, landmarks) inside the Johannesburg metro box.
// The FIRST run imports the base list. Afterwards each run only imports places
// that were ADDED or CHANGED since the previous sync (Overpass `changed:`
// filter), so the map "learns" new buildings automatically over time.
// Results are upserted into `community_places` (source='osm') — the SAME table
// the rider search already reads via /api/search/community, so no app changes
// are needed for new buildings to become searchable by name.

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const OVERPASS_TIMEOUT_MS = 20_000;
const MAX_INITIAL_ELEMENTS = 4000;
const MAX_CONCURRENCY = 6; // keep the mirror queue fair

// South Africa — Sandton + JHB CBD box (~20km across). Tight enough that the
// initial import finishes quickly, broad enough to be genuinely useful.
const AREA = { south: -26.16, west: 27.92, north: -25.98, east: 28.16 };

// Trimmed kind list — the highest-value named places. `landmark`/`tourism`/
// `leisure` are sparse in OSM SA and slow; building/amenity/shop cover the
// "name the building" use case.
const KINDS = [
  `nwr["building"]["name"]`,
  `nwr["amenity"]["name"]`,
  `nwr["shop"]["name"]`,
];

const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

let timer: NodeJS.Timeout | null = null;
let syncing = false;
let lastSyncAt: Date | null = null;
let lastError: string | null = null;
let lastAdded = 0;

function milestoneKey() {
  return "osm_places_last_sync";
}

async function ensureTable() {
  // Core table (same schema the app's community search already uses).
  await execute(`CREATE TABLE IF NOT EXISTS community_places (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    created_by UUID REFERENCES users(id),
    uses_count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (name, lat, lng)
  )`).catch(() => {});
  // New columns that mark OSM-sourced rows (keep table backward-compatible).
  await execute(`ALTER TABLE community_places ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'community'`).catch(() => {});
  await execute(`ALTER TABLE community_places ADD COLUMN IF NOT EXISTS osm_id BIGINT`).catch(() => {});
  await execute(`ALTER TABLE community_places ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ`).catch(() => {});
  // Sync milestone storage.
  await execute(`CREATE TABLE IF NOT EXISTS osm_sync_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});
}
async function getLastSync(): Promise<Date | null> {
  try {
    const rows = await query<{ value: string }>(
      "SELECT value FROM osm_sync_state WHERE key = $1",
      [milestoneKey()]
    );
    if (rows.length && rows[0].value) {
      const d = new Date(rows[0].value);
      return isNaN(d.getTime()) ? null : d;
    }
  } catch {}
  return null;
}

async function saveLastSync(d: Date) {
  try {
    await execute(
      `INSERT INTO osm_sync_state (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [milestoneKey(), d.toISOString()]
    );
  } catch {}
}

function elementPoint(e: any): { lat: number; lng: number } | null {
  if (e?.lat != null && e?.lon != null) return { lat: Number(e.lat), lng: Number(e.lon) };
  if (e?.center?.lat != null && e?.center?.lon != null) return { lat: Number(e.center.lat), lng: Number(e.center.lon) };
  return null;
}

function buildQueries(since: Date | null): string[] {
  const { south, west, north, east } = AREA;
  // NOTE: we intentionally do NOT use the Overpass `changed:` filter here —
  // public mirrors time out (504) on it. Instead we re-import the region's
  // named places periodically and rely on the DB upsert (ON CONFLICT DO
  // UPDATE) to add brand-new buildings / update renamed ones automatically.
  // This keeps the map "learning" while staying reliable on free mirrors.
  // Each statement is a bare `nwr[...](box)` (NO union parens — Overpass
  // rejects `( nwr[...](...) )` with a parse error). Tiles keep each query
  // small: 3 kinds x 2x2 tiles = 12 fast queries.
  const TILES = 2;
  const queries: string[] = [];
  for (const kind of KINDS) {
    for (let yi = 0; yi < TILES; yi++) {
      for (let xi = 0; xi < TILES; xi++) {
        const s = south + ((north - south) / TILES) * yi;
        const n = south + ((north - south) / TILES) * (yi + 1);
        const w = west + ((east - west) / TILES) * xi;
        const e = west + ((east - west) / TILES) * (xi + 1);
        queries.push(
          `[out:json][timeout:15];${kind}(${s},${w},${n},${e});out center;`
        );
      }
    }
  }
  return queries;
}
async function overpassFetch(query: string): Promise<any[]> {
  let lastEx: Error | null = null;
  // Two passes over the mirrors with a short backoff between attempts so a
  // transient rate-limit (Overpass throttles rapid repeat queries) doesn't
  // kill the whole sync.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const base of OVERPASS_MIRRORS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
        try {
          const res = await fetch(`${base}?data=${encodeURIComponent(query)}`, {
            headers: { "Accept-Encoding": "gzip", "User-Agent": "VuraRiderServer/1.0" },
            signal: controller.signal,
          });
          if (res.status === 429) {
            // Rate-limited — retry on the next mirror/pass.
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          if (!res.ok) throw new Error(`Overpass ${base} HTTP ${res.status}`);
          const data = (await res.json()) as { elements?: any[] };
          if (Array.isArray(data?.elements) && data.elements.length) return data.elements;
          return [];
        } finally {
          clearTimeout(timer);
        }
      } catch (ex: any) {
        lastEx = ex;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw lastEx || new Error("All Overpass mirrors failed");
}

function cleanName(tags: any): string | null {
  const raw = String(tags?.name || "").trim();
  return raw.length >= 2 ? raw.slice(0, 255) : null;
}

function buildAddress(tags: any): string {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"] || tags["addr:neighbourhood"],
    tags["addr:city"],
    tags["addr:province"] || tags["addr:state"],
  ].filter(Boolean);
  return parts.join(", ").slice(0, 500);
}

// Returns { added: number, total: number } after one full sync pass.
export async function syncOsmPlaces(): Promise<{ added: number; total: number }> {
  if (syncing) return { added: 0, total: 0 };
  syncing = true;
  try {
    await ensureTable();
    const since = await getLastSync();
    const queries = buildQueries(since);
    // Fetch tiles with bounded concurrency (small queries, fair to the
    // public mirrors), merge results, and cap total rows so the very first
    // import stays bounded.
    const settled: PromiseSettledResult<any[]>[] = [];
    let qi = 0;
    const runWorker = async () => {
      while (qi < queries.length) {
        const q = queries[qi++];
        try {
          settled[qi - 1] = { status: "fulfilled", value: await overpassFetch(q) };
        } catch (err: any) {
          settled[qi - 1] = { status: "rejected", reason: err };
        }
      }
    };
    await Promise.allSettled(
      Array.from({ length: Math.min(MAX_CONCURRENCY, queries.length) }, () => runWorker())
    );
    const elements: any[] = [];
    for (const s of settled) {
      if (s?.status === "fulfilled") elements.push(...(s.value as any[]));
    }
    const bounded = elements.slice(0, MAX_INITIAL_ELEMENTS);
    const totalFetched = bounded.length;

    let added = 0;
    for (const el of bounded) {
      const name = cleanName(el?.tags);
      if (!name) continue;
      const pt = elementPoint(el);
      if (!pt) continue;
      const address = buildAddress(el?.tags || {});
      try {
        const r = await execute(
          `INSERT INTO community_places (name, address, lat, lng, source, osm_id, uses_count, changed_at)
           VALUES ($1, $2, $3, $4, 'osm', $5, 1, $6)
           ON CONFLICT (name, lat, lng) DO UPDATE SET
             address = EXCLUDED.address,
             source = 'osm',
             osm_id = EXCLUDED.osm_id,
             changed_at = EXCLUDED.changed_at`,
          [name, address || null, pt.lat, pt.lng, el.id ? Number(el.id) : null, new Date()]
        );
        if (r?.rowCount === 1) added++;
      } catch {
        // skip row conflicts / edge cases
      }
    }

    const now = new Date();
    lastSyncAt = now;
    lastAdded = added;
    lastError = null;
    await saveLastSync(now);

    console.log(`[OSM Places] synced ${totalFetched} elements, added ${added}, lastSync=${now.toISOString()}`);
    return { added, total: totalFetched };
  } catch (err: any) {
    lastError = err?.message || "Overpass sync failed";
    throw err;
  } finally {
    syncing = false;
  }
}

export function startOsmPlaceSync(): NodeJS.Timeout {
  if (timer) return timer;
  // Kick off the first import shortly after boot (let DB pool warm up).
  setTimeout(() => {
    syncOsmPlaces().catch((err) => console.error("[OSM Places] initial sync failed:", err));
  }, 15_000);
  timer = setInterval(() => {
    syncOsmPlaces().catch((err) => console.error("[OSM Places] scheduled sync failed:", err));
  }, SYNC_INTERVAL_MS);
  return timer;
}

export function stopOsmPlaceSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getOsmSyncStatus() {
  return {
    lastSyncAt: lastSyncAt?.toISOString(),
    lastError,
    lastAdded,
    nextSyncInMs: timer ? SYNC_INTERVAL_MS - (Date.now() - (lastSyncAt?.getTime() || Date.now())) : null,
  };
}