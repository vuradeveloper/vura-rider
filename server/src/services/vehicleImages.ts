// ─────────────────────────────────────────────────────────────────────────────
// vehicleImages.ts — the vehicle PHOTO cache (CarsXE-backed, but the API key
// lives only here on the server and is never sent to any app).
//
// The whole point of this file is that a CarsXE call happens AT MOST ONCE per
// make|model|generation|colour, ever:
//
//   driver saves a car ─► resolveVehicleImage()  (DB only, 0 calls)
//                       └► nothing approved yet ─► claimVehicleImageFetch()
//                          INSERT … ON CONFLICT (cache_key) DO NOTHING
//                          └─ only the winner queues ONE CarsXE call
//
// After that every driver with the same car is served the cached, approved row —
// including a different model year inside the same generation (a 2019 Picanto
// reuses the 2017-2020 image) and a different colour (fallback, while a colour
// fetch is queued).
//
// Statuses: queued -> pending -> approved | rejected | none_found
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute } from "../config/database";
import { uploadToS3, deleteFromS3 } from "../lib/s3";
import { createHash } from "crypto";

export const CANVAS = { w: 900, h: 560 };
export const MAX_BYTES = 80 * 1024;
const CARSXE_URL = "https://api.carsxe.com/images";
const DEFAULT_MAX_CALLS = 90; // of the 100-call budget; the rest is headroom
const MAX_CANDIDATES = 3; // kept for review (and uploaded)
/**
 * How many candidates are DOWNLOADED and measured, before keeping MAX_CANDIDATES.
 *
 * The text score cannot see a background, and it penalises dealer/classifieds pages
 * by 6 points - which is exactly where clean studio cut-outs usually live. A studio
 * shot can therefore sit 4th-6th in that order. Downloading and measuring costs no
 * API call (the search response is already paid for) and only the winners are
 * uploaded, so examining more than we keep is free and stops the good shot from
 * being filtered out before it is ever looked at.
 */
const MEASURE_CANDIDATES = 6;

/**
 * A key whose search found nothing may be tried again - but only this many times, and
 * only after a cooldown, so one hopeless make|model|colour can never eat the budget.
 * Without a retry the car keeps the SVG icon for ever (a Kia Picanto 2017 search
 * returned zero images, and nothing would ever have asked CarsXE again).
 */
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_COOLDOWN_MINUTES = 10;

export type VehicleImageStatus =
  | "queued"
  | "pending"
  | "approved"
  | "rejected"
  | "none_found";

export interface Candidate {
  url: string; // our own storage (never the CarsXE/third-party link)
  storageKey: string;
  sourceUrl: string; // original link, kept for credits
  contextLink: string; // page it was found on
  width: number;
  height: number;
  bytes: number;
  score: number;
  note: string;
  /** Share of the outer border that was transparent/white in the RAW download (0..1). */
  borderWhite?: number;
  /** studioBonus() of that same measurement: +10 clean ring and corners, -4 busy. */
  studioBonus?: number;
}

export interface VehicleLike {
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  colour?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: number | string | null;
  vehicle_color?: string | null;
}

// ── cache keys ───────────────────────────────────────────────────────────────

/**
 * The "generation" bucket of a model year. 2017, 2018, 2019 and 2020 all land in
 * "2017-2020" (4-year blocks), which is what makes rule 2b work: a 2019 Picanto
 * request reuses the image imported for 2018 with NO api call.
 */
export function generationRange(year?: number | string | null): string {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1950 || y > 2100) return "any";
  const start = Math.floor((y - 1) / 4) * 4 + 1;
  return `${start}-${start + 3}`;
}

const slug = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** lowercase make|model|year_range|colour — the DB's unique key. */
export function vehicleImageCacheKey(v: VehicleLike | null | undefined): string {
  const make = slug(v?.make || v?.vehicle_make);
  const model = slug(v?.model || v?.vehicle_model);
  const colour = slug(v?.colour || v?.vehicle_color);
  const year = v?.year ?? v?.vehicle_year;
  return `${make}|${model}|${generationRange(year)}|${colour}`;
}

/** make | model | colour with the year bucket wildcarded, for fallback matching. */
function keyParts(cacheKey: string) {
  const [make = "", model = "", , colour = ""] = cacheKey.split("|");
  return { make, model, colour };
}

// ── schema ───────────────────────────────────────────────────────────────────

let ensured = false;

export async function ensureVehicleImageTables(): Promise<void> {
  if (ensured) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS vehicle_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key VARCHAR(160) NOT NULL UNIQUE,
      make VARCHAR(60),
      model VARCHAR(80),
      year INTEGER,
      colour VARCHAR(40),
      image_url TEXT,
      storage_key TEXT,
      source_url TEXT,
      context_link TEXT,
      licence_note TEXT,
      width INTEGER,
      height INTEGER,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
      api_calls_used INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ
    )
  `);
  // Retry bookkeeping for keys whose fetch came back with nothing. Added with
  // IF NOT EXISTS so it is safe against a table created by an earlier build.
  await execute(`ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`);
  await execute(`ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`);
  // WHY a fetch produced nothing. Without this the reason only ever reached
  // console.warn, which is invisible in production - that is exactly how a car sat
  // on the SVG icon while the CarsXE log showed "9 results, HTTP 200".
  await execute(`ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS last_error TEXT`);
  await execute(`
    CREATE TABLE IF NOT EXISTS carsxe_usage_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key VARCHAR(160),
      called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      result_count INTEGER,
      http_status INTEGER,
      note TEXT
    )
  `);
  await execute(`CREATE INDEX IF NOT EXISTS vehicle_images_status_idx ON vehicle_images (status)`);
  ensured = true;
}

// ── budget ───────────────────────────────────────────────────────────────────

export function carsxeMaxCalls(): number {
  const n = parseInt(process.env.CARSXE_MAX_CALLS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CALLS;
}

export interface CarsxeBudget {
  used: number;
  max: number;
  left: number;
  blocked: boolean;
}

/** Counts EVERY logged call, including the ones imported from the dashboard. */
export async function carsxeUsage(): Promise<CarsxeBudget> {
  await ensureVehicleImageTables();
  const row = await queryOne<{ used: string }>(
    `SELECT COUNT(*)::text AS used FROM carsxe_usage_log`
  );
  const used = parseInt(row?.used || "0", 10);
  const max = carsxeMaxCalls();
  return { used, max, left: Math.max(0, max - used), blocked: used >= max };
}

/**
 * Records one call. NEVER pass the request URL here — it carries the API key.
 */
export async function logCarsxeCall(
  cacheKey: string,
  resultCount: number | null,
  httpStatus: number | null,
  note: string
): Promise<void> {
  await execute(
    `INSERT INTO carsxe_usage_log (cache_key, result_count, http_status, note)
     VALUES ($1, $2, $3, $4)`,
    [cacheKey, resultCount, httpStatus, note]
  );
}

export interface CarsxeCallRow {
  cache_key: string | null;
  called_at: string;
  result_count: number | null;
  http_status: number | null;
  note: string | null;
}

/**
 * The most recent calls, newest first. This is the answer to "why did that search find
 * nothing?": it shows the result count and the HTTP status of every call, including the
 * fallbacks, without ever exposing the API key (the key only ever travels in the URL).
 */
export async function recentCarsxeCalls(limit = 25): Promise<CarsxeCallRow[]> {
  await ensureVehicleImageTables();
  const n = Math.min(Math.max(1, Math.floor(limit) || 25), 200);
  return query<CarsxeCallRow>(
    `SELECT cache_key, called_at, result_count, http_status, note
       FROM carsxe_usage_log
      ORDER BY called_at DESC, id DESC
      LIMIT ${n}`
  );
}

// ── lookup flow — EVERY function below is a DB read: zero CarsXE calls ────────

export interface ResolvedVehicleImage {
  url: string | null;
  cacheKey: string;
  matched: "exact" | "model-colour" | "model" | "none";
}

/**
 * Fallback order, resolved server-side so every client agrees:
 *   1. approved, exact make+model+generation+colour
 *   2. approved, same make+model+colour, another generation   (the 2019 -> 2018 image)
 *   3. approved, same make+model, another colour              (colour fetch queued meanwhile)
 *   4. none -> the app draws the body-type icon, then the generic car
 */
export async function resolveVehicleImage(v?: VehicleLike | null): Promise<ResolvedVehicleImage> {
  await ensureVehicleImageTables();
  const cacheKey = vehicleImageCacheKey(v);
  const { make, model, colour } = keyParts(cacheKey);
  if (!make || !model) return { url: null, cacheKey, matched: "none" };

  const exact = await queryOne<{ image_url: string }>(
    `SELECT image_url FROM vehicle_images
      WHERE cache_key = $1 AND status = 'approved' AND image_url IS NOT NULL`,
    [cacheKey]
  );
  if (exact?.image_url) return { url: exact.image_url, cacheKey, matched: "exact" };

  if (colour) {
    const sameColour = await queryOne<{ image_url: string }>(
      `SELECT image_url FROM vehicle_images
        WHERE make = $1 AND model = $2 AND colour = $3 AND status = 'approved' AND image_url IS NOT NULL
        ORDER BY approved_at DESC NULLS LAST LIMIT 1`,
      [make, model, colour]
    );
    if (sameColour?.image_url) {
      return { url: sameColour.image_url, cacheKey, matched: "model-colour" };
    }
  }

  const anyColour = await queryOne<{ image_url: string }>(
    `SELECT image_url FROM vehicle_images
      WHERE make = $1 AND model = $2 AND status = 'approved' AND image_url IS NOT NULL
      ORDER BY approved_at DESC NULLS LAST LIMIT 1`,
    [make, model]
  );
  if (anyColour?.image_url) return { url: anyColour.image_url, cacheKey, matched: "model" };

  return { url: null, cacheKey, matched: "none" };
}

/**
 * Returns true ONLY for the caller that won a fetch for this key. Two drivers saving
 * the same car in the same second therefore queue exactly ONE CarsXE call, because the
 * unique constraint on cache_key decides the winner, not application logic.
 *
 * A 'none_found' row may be RETRIED, under three guards, because a search that returns
 * nothing today (Kia Picanto 2017 asked with the colour filter returned zero images)
 * must not leave that car on an SVG icon for ever:
 *   - only when a driver saves that car again (i.e. somebody actually wants it),
 *   - at most MAX_FETCH_ATTEMPTS times (counted per CarsXE call, in runCarsxeFetch),
 *   - never more often than RETRY_COOLDOWN_MINUTES.
 * Pending, rejected and approved rows are still left alone.
 */
export async function claimVehicleImageFetch(v: VehicleLike): Promise<boolean> {
  await ensureVehicleImageTables();
  const cacheKey = vehicleImageCacheKey(v);
  const { make, model, colour } = keyParts(cacheKey);
  if (!make || !model) return false;
  const created = await queryOne<{ id: string }>(
    `INSERT INTO vehicle_images (cache_key, make, model, year, colour, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')
     ON CONFLICT (cache_key) DO NOTHING
     RETURNING id`,
    [cacheKey, make, model, Number(v?.year ?? v?.vehicle_year) || null, colour]
  );
  if (created) return true;

  const retried = await queryOne<{ id: string }>(
    `UPDATE vehicle_images
        SET status = 'queued'
      WHERE cache_key = $1
        AND status = 'none_found'
        AND attempts < $2
        AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - ($3 || ' minutes')::interval)
      RETURNING id`,
    [cacheKey, MAX_FETCH_ATTEMPTS, String(RETRY_COOLDOWN_MINUTES)]
  );
  return Boolean(retried);
}

// ── picking the best of the returned images (no extra calls) ──────────────────

const DEALER_PAGE = /(autotrader|gumtree|olx|facebook|marketplace|carfind|weelee|dealer|classified|bid|auction)/i;
const WATERMARK = /(watermark|shutterstock|getty|alamy|dreamstime|123rf|istock|stock)/i;

export interface RawCarsxeImage {
  link?: string;
  mime?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  thumbnailLink?: string;
  contextLink?: string;
}

/**
 * Scores every image on the criteria you specified and returns them best-first:
 *   + png/webp preferred, + width >= 600 (and 1000), + aspect ratio 1.2–2.2,
 *   − dealer/classifieds context pages, − watermarked stock libraries.
 * Nothing here calls the API — it only reads the array we already paid for.
 */
export function scoreCandidates(images: RawCarsxeImage[]): Array<RawCarsxeImage & { score: number; note: string }> {
  return (images || [])
    .filter((img) => typeof img?.link === "string" && img.link.startsWith("http"))
    .map((img) => {
      const mime = String(img.mime || "").toLowerCase();
      const w = Number(img.width) || 0;
      const h = Number(img.height) || 0;
      const ar = w && h ? w / h : 0;
      const ctx = String(img.contextLink || "");
      const reasons: string[] = [];
      let score = 0;

      if (/png|webp/.test(mime)) { score += 3; reasons.push("png/webp"); }
      if (w >= 600) { score += 2; reasons.push("width>=600"); }
      if (w >= 1000) { score += 2; reasons.push("width>=1000"); }
      if (ar >= 1.2 && ar <= 2.2) { score += 4; reasons.push("good aspect"); }
      else if (ar) { score -= 3; reasons.push(`odd aspect ${ar.toFixed(2)}`); }
      if (DEALER_PAGE.test(ctx)) { score -= 6; reasons.push("dealer/classifieds page"); }
      if (WATERMARK.test(ctx) || WATERMARK.test(img.link || "")) { score -= 5; reasons.push("possible watermark"); }
      if (Number(img.byteSize) > 4 * 1024 * 1024) { score -= 2; reasons.push("very large"); }

      return { ...img, score, note: reasons.join(", ") || "no strong signal" };
    })
    .sort((a, b) => b.score - a.score || (Number(b.width) || 0) - (Number(a.width) || 0));
}

// ── download, key out the studio background, trim, canvas, webp under 80 KB ───

export function imageBaseUrl(): string {
  // PUBLIC_API_BASE wins when set. Otherwise fall back to the production host
  // instead of a bare path: a relative path only works for our own server-rendered
  // pages, and inside the Capacitor WebView it resolved against https://localhost,
  // so the rider's car photo could never load. With an absolute URL here, both the
  // app builds already installed and the new ones can fetch the image.
  const base = (process.env.PUBLIC_API_BASE || "https://api.ridevura.com").replace(/\/+$/, "");
  return `${base}/api/vehicle-images`;
}

const fileFor = (cacheKey: string, index = 0, hash?: string) =>
  `${cacheKey.replace(/\|/g, "-").replace(/[^a-z0-9.\-]/gi, "_")}${index ? `-${index + 1}` : ""}${
    hash ? `-${hash}` : ""
  }.webp`;

export const storageKeyFor = (cacheKey: string, index = 0, hash?: string) =>
  `vehicle-images/${fileFor(cacheKey, index, hash)}`;

export const fileNameFor = fileFor;

/**
 * Downloads a candidate ONCE. Never hotlinks: the bytes are re-uploaded to our
 * own bucket and only our own URL is ever stored or shown.
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();
  // A browser-ish User-Agent: several hosts on CarsXE results (focus2move, canm8)
  // answer 403 to a bare fetch. It does not defeat real hotlink protection, but it
  // converts a silent failure into a plain download.
  // A hard timeout matters more: without one, a single slow host blocks the whole
  // fetch past the request/worker window and the key ends up with nothing stored.
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`download ${res.status} from ${host}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`suspiciously small image (${buf.length}B from ${host})`);
  return buf;
}

/**
 * Studio shots sit on a plain light background, so keying it out is deterministic
 * and needs no ML model (a 40 MB ONNX runtime does not belong in an EB deploy).
 * Pure white -> fully transparent, near-white -> feathered, then trim, fit the
 * shared 900x560 canvas (same as scripts/generate-vehicle-images.js) and step the
 * WebP quality down until it fits 80 KB.
 */
export async function processVehicleImage(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(input)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const min = Math.min(r, g, b);
    const spread = Math.max(r, g, b) - min;
    if (min >= 236 && spread <= 14) data[i + 3] = 0;
    else if (min >= 205 && spread <= 20) data[i + 3] = Math.round(255 * ((236 - min) / 31));
  }

  const canvas = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 2 })
    .resize(CANVAS.w, CANVAS.h, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });

  let out = await canvas.webp({ quality: 82, effort: 5 }).toBuffer();
  for (let q = 76; q >= 40 && out.length > MAX_BYTES; q -= 6) {
    out = await canvas.webp({ quality: q, effort: 5 }).toBuffer();
  }
  return out;
}

// ── is this a studio shot on a plain backdrop, or a photo with a real scene? ───

/**
 * How much of the picture is a plain, keyable background?
 *
 * Only the OUTER BORDER RING and the four CORNERS of a small thumbnail are
 * measured, and a pixel counts as background when it is either transparent or
 * near-pure white - the very same test the keying loop in processVehicleImage()
 * uses. A studio shot on a white/transparent backdrop scores ~1.0; a forecourt,
 * press or street photo has road, sky, grass or a building along the border and
 * scores low. Measuring the ring rather than the whole frame is deliberate: a
 * WHITE CAR sits inside the frame, not on its border, so it cannot inflate the
 * number the way a "count the white pixels" rule would.
 *
 * Must run on the RAW download, before processVehicleImage(): the stored WebP has
 * its background already keyed to transparent, so measuring that file would make
 * every candidate look like a studio shot.
 */
export async function measureStudioBackground(
  input: Buffer
): Promise<{ borderWhite: number; corners: number }> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(input)
    .rotate()
    .resize(160, 160, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.05));
  const cw = Math.max(2, Math.round(w * 0.12));
  const ch = Math.max(2, Math.round(h * 0.12));

  /** 1 = keyable background, 0.5 = near-white (the feathered band), 0 = content. */
  const weight = (x: number, y: number): number => {
    const i = (y * w + x) * 4;
    const a = data[i + 3];
    // Transparent wins outright: CarsXE's `transparent` filter hands us cut-outs, and
    // lossy WebP/PNG alpha edges are noisy, so anything clearly see-through counts (a
    // real background pixel is alpha 255, which leaves 40 a wide margin).
    if (a < 40) return 1;
    if (a < 160) return 0.5; // soft/fringed edge of a cut-out
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const min = Math.min(r, g, b);
    const spread = Math.max(r, g, b) - min;
    if (min >= 236 && spread <= 14) return 1;
    if (min >= 205 && spread <= 20) return 0.5;
    return 0;
  };

  let ringSum = 0;
  let ringN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      ringN += 1;
      ringSum += weight(x, y);
    }
  }

  let cornerSum = 0;
  let cornerN = 0;
  for (const [x0, y0] of [[0, 0], [w - cw, 0], [0, h - ch], [w - cw, h - ch]]) {
    for (let y = y0; y < y0 + ch; y++) {
      for (let x = x0; x < x0 + cw; x++) {
        cornerN += 1;
        cornerSum += weight(x, y);
      }
    }
  }

  return {
    borderWhite: ringN ? ringSum / ringN : 0,
    corners: cornerN ? cornerSum / cornerN : 0,
  };
}

/**
 * Points added to a candidate's text score for looking like a studio shot.
 *
 * Both the ring AND the corners have to be clean for the full bonus: a car shot
 * against a bright sky has a white top border but a road along the bottom and dark
 * corners, which is not the clean catalogue look the rider card wants.
 */
export function studioBonus(m: { borderWhite: number; corners: number }): number {
  if (m.borderWhite >= 0.85 && m.corners >= 0.7) return 10;
  if (m.borderWhite >= 0.6) return 4;
  if (m.borderWhite <= 0.2) return -4;
  return 0;
}

// ── the one and only CarsXE call, guarded by the budget ───────────────────────

/**
 * Runs for a row that is already 'queued' — the caller must have WON the claim,
 * so there is exactly one of these per cache_key. Logs the call (status and count
 * only — never the URL, which carries the key), stores up to three processed
 * candidates as 'pending' and leaves the row for human approval.
 */
export async function runCarsxeFetch(
  cacheKey: string,
  options?: { keepStatus?: boolean }
): Promise<void> {
  await ensureVehicleImageTables();
  const row = await queryOne<any>(
    `SELECT id, make, model, year, colour, status FROM vehicle_images WHERE cache_key = $1`,
    [cacheKey]
  );
  // A re-fetch of an ALREADY APPROVED row is allowed (keepStatus), so the live image
  // stays up while the operator reviews fresh candidates. Everything else still has to
  // win the 'queued' claim, which is what keeps this to one CarsXE call per key.
  const keepStatus = Boolean(options?.keepStatus);
  if (!row || (row.status !== "queued" && !(keepStatus && row.status === "approved"))) return;

  // Atomic claim: flip queued -> fetching so a second caller cannot spend a second
  // CarsXE credit on the same key. This is real, not theoretical: pressing
  // "Re-fetch" sets the row back to 'queued' and the 30s worker then picks up the
  // same row while the request is still running, which is how one Picanto cost five
  // calls (visible in the review page's call log). Exactly one UPDATE can match
  // `status = 'queued'`, so the loser returns without calling the API.
  if (!keepStatus) {
    const claimed = await queryOne<{ id: string }>(
      `UPDATE vehicle_images SET status = 'fetching'
        WHERE id = $1 AND status = 'queued' RETURNING id`,
      [row.id]
    ).catch(() => null);
    if (!claimed) return;
  }

  /** Never demote a live approved row - it keeps serving until a human approves. */
  const markNoneFound = async (reason?: string) => {
    if (keepStatus) return;
    await execute(
      `UPDATE vehicle_images
          SET status = 'none_found', api_calls_used = 1, last_attempt_at = NOW(),
              last_error = $2
        WHERE id = $1`,
      [row.id, reason ? String(reason).slice(0, 900) : null]
    );
  };

  const key = process.env.CARSXE_API_KEY;
  if (!key) {
    console.warn("[vehicleImages] CARSXE_API_KEY is not set — no photo for", cacheKey);
    await markNoneFound();
    return;
  }

  const budget = await carsxeUsage();
  if (budget.blocked) {
    console.warn(
      `[vehicleImages] CarsXE budget reached (${budget.used}/${budget.max}) — no call for ${cacheKey}. ` +
        `Raise CARSXE_MAX_CALLS only if you really have budget left.`
    );
    await markNoneFound();
    return;
  }

  // One fetch = one attempt, counted against the retry budget used in
  // claimVehicleImageFetch. Counting here (not in the claim) keeps the number exactly
  // equal to the CarsXE calls this key has cost.
  await execute(
    `UPDATE vehicle_images SET attempts = attempts + 1, last_attempt_at = NOW() WHERE id = $1`,
    [row.id]
  ).catch(() => {});

  let httpStatus: number | null = null;
  let images: RawCarsxeImage[] = [];
  let exactMatch = false;
  // The first query is the exact one. A colour filter can legitimately come back empty
  // (Kia Picanto 2017 in "red" returned zero images, which is what left that car on its
  // SVG icon), so the colour is dropped, then the year, before giving up with a
  // 'none_found' the driver could never be rescued from. Each fallback is a real call, so
  // it only runs when the previous query found NOTHING, and the budget is re-checked
  // before every call.
  const queries: Array<Record<string, string>> = [
    { ...(row.year ? { year: String(row.year) } : {}), ...(row.colour ? { color: String(row.colour) } : {}) },
    ...(row.colour ? [{ ...(row.year ? { year: String(row.year) } : {}) }] : []),
    ...(row.year ? [{}] : []),
  ];
  try {
    for (const [i, extra] of queries.entries()) {
      if (i > 0 && (await carsxeUsage()).blocked) break;
      const qs = new URLSearchParams({
        key,
        make: String(row.make || ""),
        model: String(row.model || ""),
        ...extra,
      });
      const res = await fetch(`${CARSXE_URL}?${qs.toString()}`);
      httpStatus = res.status;
      const body: any = await res.json().catch(() => null);
      images = Array.isArray(body?.images) ? body.images : [];
      // the request URL carries the key: log the status and the count, nothing else.
      const label =
        i === 0
          ? "carsxe images lookup"
          : `carsxe fallback ${i} (${Object.keys(extra).join("+") || "make+model"})`;
      await logCarsxeCall(cacheKey, images.length, httpStatus, label);
      if (images.length) {
        // Only the exact query counts as a match. A fallback dropped the colour (or the
        // year), so its photos are for a human to look at, never an automatic pick.
        exactMatch = i === 0;
        break;
      }
    }
  } catch (err: any) {
    await logCarsxeCall(cacheKey, null, httpStatus, `request failed: ${err?.message || err}`);
    await markNoneFound();
    return;
  }

  const sharp = (await import("sharp")).default;

  // Step 1: download and MEASURE more candidates than we keep. The text score cannot
  // see a background, so the studio shot can easily sit 4th-6th in its order; reading
  // the pixels costs no extra API call (the search results are already paid for) and
  // only the winners below are uploaded to S3.
  const examined = scoreCandidates(images).slice(0, MEASURE_CANDIDATES);
  const measured: Array<{
    pick: (typeof examined)[number];
    buffer: Buffer;
    bg: { borderWhite: number; corners: number };
    bonus: number;
  }> = [];
  // Every failure is recorded so the review page can say WHY a car has no photo,
  // instead of leaving it to a console.warn nobody can read in production.
  const failures: string[] = [];
  for (const pick of examined) {
    try {
      const buffer = await downloadImage(pick.link!);
      const bg = await measureStudioBackground(buffer);
      measured.push({ pick, buffer, bg, bonus: studioBonus(bg) });
    } catch (err: any) {
      const why = `${pick.width || "?"}x${pick.height || "?"} ${err?.message || err}`;
      failures.push(why);
      console.warn(`[vehicleImages] a candidate for ${cacheKey} could not be read:`, err?.message || err);
    }
  }
  if (!measured.length) {
    await markNoneFound(
      examined.length === 0
        ? `the search returned ${images.length} image(s) but none passed the filters`
        : `all ${examined.length} candidate(s) failed to download/measure: ${failures.slice(0, 4).join(" | ")}`
    );
    return;
  }

  // Step 2: best first - studio-style shot, then the text score, then width.
  measured.sort(
    (a, b) =>
      b.pick.score + b.bonus - (a.pick.score + a.bonus) ||
      (Number(b.pick.width) || 0) - (Number(a.pick.width) || 0)
  );

  const stored: Candidate[] = [];
  for (const [i, entry] of measured.slice(0, MAX_CANDIDATES).entries()) {
    const { pick, buffer, bg, bonus } = entry;
    try {
      const webp = await processVehicleImage(buffer);
      // Content-hashed name on purpose: a re-fetch of a car must never overwrite a
      // file that Cloudflare (public, max-age=1 year, immutable) and the installed
      // apps still cache - otherwise the operator approves a fresh photo and every
      // phone keeps showing the old one. A new name means a new URL, so it just works.
      const hash = createHash("sha1").update(webp).digest("hex").slice(0, 8);
      const storageKey = storageKeyFor(cacheKey, i, hash);
      const up = await uploadToS3(storageKey, webp.toString("base64"), "image/webp");
      const meta = await sharp(webp).metadata();
      stored.push({
        url: `${imageBaseUrl()}/${fileNameFor(cacheKey, i, hash)}`,
        storageKey,
        sourceUrl: pick.link!,
        contextLink: String(pick.contextLink || ""),
        width: meta.width || CANVAS.w,
        height: meta.height || CANVAS.h,
        bytes: up.size,
        score: pick.score + bonus,
        note: [
          pick.note,
          `white border ${(bg.borderWhite * 100).toFixed(0)}%`,
          bonus >= 10 ? "studio-style" : bonus < 0 ? "busy background" : "",
        ]
          .filter(Boolean)
          .join(" | "),
        borderWhite: Math.round(bg.borderWhite * 100) / 100,
        studioBonus: bonus,
      });
    } catch (err: any) {
      failures.push(`process ${i + 1} (${pick.width || "?"}x${pick.height || "?"}): ${err?.message || err}`);
      console.warn(`[vehicleImages] candidate ${i + 1} for ${cacheKey} failed:`, err?.message || err);
    }
  }

  if (!stored.length) {
    await markNoneFound(
      `the search returned ${images.length} image(s), ${measured.length} downloaded, ` +
        `but every one failed to store: ${failures.slice(0, 4).join(" | ")}`
    );
    return;
  }
  // A successful fetch clears any stale reason from an earlier attempt.
  await execute(`UPDATE vehicle_images SET last_error = NULL WHERE id = $1`, [row.id]).catch(() => {});

  // Order AFTER the pixels are known. The text score alone ties constantly (three
  // candidates at score 6 is normal - measured on the live Polo row), which used to
  // let the widest photo win even when a clean studio shot sat right beside it.
  // With the border measurement folded in, the studio shot now leads.
  stored.sort((a, b) => b.score - a.score || (b.width || 0) - (a.width || 0));

  const best = stored[0];

  if (keepStatus) {
    // A re-fetch of an approved car: the candidates are replaced for review, but the
    // approved status and the live image stay exactly as they were, so riders keep
    // seeing a photo until the operator approves one of the fresh candidates.
    await execute(
      `UPDATE vehicle_images SET candidates = $2::jsonb, api_calls_used = api_calls_used + 1 WHERE id = $1`,
      [row.id, JSON.stringify(stored)]
    );
    console.log(
      `[vehicleImages] ${cacheKey}: ${stored.length} fresh candidate(s) for review ` +
        `(best white border ${Math.round((best.borderWhite ?? 0) * 100)}%); live image unchanged`
    );
    return;
  }

  // ── auto-apply a CONFIDENT studio pick ───────────────────────────────────────
  // This is what makes "press Save Vehicle and the car gets its photo" true without a
  // human in the loop. The measurement above is deterministic - the outer ring and the
  // four corners of the RAW download - so a shot that is at least 85% clean around the
  // border AND scored the full studio bonus (+10: clean ring AND clean corners) is a
  // catalogue-style cut-out on a white background, which is exactly what the app shows.
  //
  // Two guard rails: only an EXACT query (same colour, same year) may auto-apply, and
  // anything less confident still lands as 'pending' on the review page, so a doubtful
  // photo can never reach a rider unreviewed. VEHICLE_IMAGE_AUTO_APPROVE=off puts every
  // pick back in front of a human without a redeploy of anything else.
  const autoApproveEnabled = String(process.env.VEHICLE_IMAGE_AUTO_APPROVE ?? "").toLowerCase() !== "off";
  const confidentStudio = exactMatch && Number(best.borderWhite ?? 0) >= 0.85 && Number(best.studioBonus ?? 0) >= 10;
  const autoApproved = autoApproveEnabled && confidentStudio;

  await execute(
    `UPDATE vehicle_images
        SET status = $9,
            approved_at = CASE WHEN $9 = 'approved' THEN NOW() ELSE approved_at END,
            image_url = $2, storage_key = $3, source_url = $4,
            context_link = $5, width = $6, height = $7, candidates = $8::jsonb, api_calls_used = 1
      WHERE id = $1`,
    [
      row.id, best.url, best.storageKey, best.sourceUrl, best.contextLink, best.width, best.height,
      JSON.stringify(stored), autoApproved ? "approved" : "pending",
    ]
  );

  if (autoApproved) {
    // The candidates that were not chosen are dead weight in the bucket.
    for (const c of stored.slice(1)) if (c.storageKey) await deleteFromS3(c.storageKey).catch(() => {});
    console.log(
      `[vehicleImages] ${cacheKey}: auto-approved the top pick ` +
        `(white border ${Math.round((best.borderWhite ?? 0) * 100)}%, studio bonus ${best.studioBonus ?? 0})`
    );
  } else {
    console.log(`[vehicleImages] ${cacheKey}: ${stored.length} candidate(s) waiting for approval`);
  }
}

// ── background worker: drains 'queued' rows, one call per key, budget-aware ───

let worker: NodeJS.Timeout | null = null;

export function startVehicleImageWorker(intervalMs = 30_000): NodeJS.Timeout {
  if (worker) return worker;
  worker = setInterval(async () => {
    try {
      await ensureVehicleImageTables();
      // A row can be left at 'fetching' if the process restarted mid-fetch (that is
      // what the atomic claim above sets). Reclaim anything untouched for 5 minutes so
      // a crash can never strand a car on the SVG icon for ever.
      //
      // This runs BEFORE the budget check deliberately. With the check first, an
      // exhausted CarsXE budget froze the release of the stranded row too: the live
      // `toyota|etios|2017-2020|blue` row sat at 'fetching' with 78 attempts and could
      // never be picked up again, because the only thing that frees a 'fetching' row
      // is this UPDATE and the budget guard returned before it. Freeing it is
      // free — no API call is made by returning it to 'queued'; it simply becomes
      // eligible again the moment budget exists.
      await execute(
        `UPDATE vehicle_images SET status = 'queued'
          WHERE status = 'fetching'
            AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '5 minutes')`
      ).catch(() => {});
      if ((await carsxeUsage()).blocked) return;
      const rows = await query<{ cache_key: string }>(
        `SELECT cache_key FROM vehicle_images WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
      );
      for (const row of rows) await runCarsxeFetch(row.cache_key);
    } catch (err: any) {
      console.error("[vehicleImages] worker error:", err?.message || err);
    }
  }, intervalMs);
  worker.unref?.();
  return worker;
}

export function stopVehicleImageWorker(): void {
  if (worker) clearInterval(worker);
  worker = null;
}

// ── admin operations (the review page) ───────────────────────────────────────

export async function listVehicleImages(status?: string): Promise<any[]> {
  await ensureVehicleImageTables();
  return status
    ? query<any>(`SELECT * FROM vehicle_images WHERE status = $1 ORDER BY created_at DESC`, [status])
    : query<any>(`SELECT * FROM vehicle_images ORDER BY created_at DESC LIMIT 200`);
}

/** Approves the row, optionally promoting a different candidate than the auto-pick. */
export async function approveVehicleImage(id: string, candidateIndex = 0) {
  await ensureVehicleImageTables();
  const row = await queryOne<any>(`SELECT * FROM vehicle_images WHERE id = $1`, [id]);
  if (!row) return null;
  const candidates: Candidate[] = Array.isArray(row.candidates) ? row.candidates : [];
  const chosen = candidates[candidateIndex] || null;

  await execute(
    `UPDATE vehicle_images
        SET status = 'approved', approved_at = NOW(),
            image_url = COALESCE($2, image_url), storage_key = COALESCE($3, storage_key),
            source_url = COALESCE($4, source_url), context_link = COALESCE($5, context_link),
            width = COALESCE($6, width), height = COALESCE($7, height)
      WHERE id = $1`,
    [id, chosen?.url ?? null, chosen?.storageKey ?? null, chosen?.sourceUrl ?? null,
     chosen?.contextLink ?? null, chosen?.width ?? null, chosen?.height ?? null]
  );

  // The candidates you did not choose are dead weight in the bucket.
  for (const [i, c] of candidates.entries()) {
    if (i !== candidateIndex && c?.storageKey) await deleteFromS3(c.storageKey).catch(() => {});
  }
  return { id, candidateIndex, imageUrl: chosen?.url || row.image_url };
}

/**
 * Re-runs the (single) CarsXE call for a row that already exists, so a car approved
 * before the studio-shot picker existed can be re-picked. Costs ONE API call.
 *
 * For an approved row the live image stays up until the operator approves one of the
 * fresh candidates (see runCarsxeFetch keepStatus). Any other status is re-queued
 * first, which is exactly what a first fetch does.
 */
export async function refetchVehicleImage(id: string) {
  await ensureVehicleImageTables();
  const row = await queryOne<{ cache_key: string; status: string }>(
    `SELECT cache_key, status FROM vehicle_images WHERE id = $1`,
    [id]
  );
  if (!row) return null;

  const approved = row.status === "approved";
  if (!approved) await execute(`UPDATE vehicle_images SET status = 'queued' WHERE id = $1`, [id]);
  await runCarsxeFetch(row.cache_key, { keepStatus: approved });

  const after = await queryOne<any>(`SELECT status, image_url, candidates FROM vehicle_images WHERE id = $1`, [id]);
  const candidates: Candidate[] = Array.isArray(after?.candidates) ? after.candidates : [];
  return {
    id,
    cacheKey: row.cache_key,
    statusKept: approved,
    status: after?.status ?? null,
    liveImage: after?.image_url ?? null,
    candidates: candidates.length,
    bestWhiteBorder: candidates[0]?.borderWhite ?? null,
    budget: await carsxeUsage(),
  };
}

export async function rejectVehicleImage(id: string) {
  await ensureVehicleImageTables();
  await execute(`UPDATE vehicle_images SET status = 'rejected' WHERE id = $1`, [id]);
  return { id };
}

/**
 * Step 0 — a finished image produced by scripts/import-seed.js from a dashboard
 * search you already made. ZERO CarsXE calls: the bytes arrive already processed,
 * we only store them. Idempotent: re-running overwrites the same row instead of
 * adding a second one, and the usage log records the import exactly once.
 */
export async function importSeedImage(input: {
  cacheKey: string;
  make: string;
  model: string;
  year?: number | null;
  colour?: string | null;
  sourceUrl?: string | null;
  contextLink?: string | null;
  licenceNote?: string | null;
  webpBase64: string;
  candidates?: Candidate[];
}) {
  await ensureVehicleImageTables();
  const cacheKey = input.cacheKey.trim().toLowerCase();
  const storageKey = storageKeyFor(cacheKey, 0);
  const webp = Buffer.from(
    input.webpBase64.includes(",") ? input.webpBase64.split(",")[1] : input.webpBase64,
    "base64"
  );
  if (!webp.length) throw new Error("empty image payload");

  const sharp = (await import("sharp")).default;
  const meta = await sharp(webp).metadata();
  const up = await uploadToS3(storageKey, webp.toString("base64"), "image/webp");

  const candidate: Candidate = {
    url: `${imageBaseUrl()}/${fileNameFor(cacheKey, 0)}`,
    storageKey,
    sourceUrl: input.sourceUrl || "",
    contextLink: input.contextLink || "",
    width: meta.width || CANVAS.w,
    height: meta.height || CANVAS.h,
    bytes: up.size,
    score: 0,
    note: "imported from the CarsXE dashboard search",
  };
  const candidates = [candidate, ...(input.candidates || [])];

  const row = await queryOne<any>(
    `INSERT INTO vehicle_images
       (cache_key, make, model, year, colour, image_url, storage_key, source_url, context_link,
        licence_note, width, height, status, candidates, api_calls_used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13::jsonb,0)
     ON CONFLICT (cache_key) DO UPDATE
       SET image_url = EXCLUDED.image_url, storage_key = EXCLUDED.storage_key,
           source_url = EXCLUDED.source_url, context_link = EXCLUDED.context_link,
           licence_note = EXCLUDED.licence_note, width = EXCLUDED.width, height = EXCLUDED.height,
           candidates = EXCLUDED.candidates, status = 'pending'
     RETURNING *`,
    [cacheKey, input.make, input.model, input.year ?? null, input.colour ?? null,
     candidate.url, storageKey, candidate.sourceUrl, candidate.contextLink,
     input.licenceNote ?? null, candidate.width, candidate.height, JSON.stringify(candidates)]
  );

  // The dashboard search cost you one call, so the budget must count it — once.
  const already = await queryOne<{ id: string }>(
    `SELECT id FROM carsxe_usage_log WHERE cache_key = $1 AND note LIKE 'imported%' LIMIT 1`,
    [cacheKey]
  );
  if (!already) {
    await logCarsxeCall(cacheKey, (input.candidates || []).length + 1, 200, "imported from dashboard search");
  }

  return { row, candidate, budget: await carsxeUsage() };
}

// ── cached resolver for the POLLED endpoints ─────────────────────────────────
// /api/rides/me/active-state is polled roughly once a second while the trip card
// is open, so the three lookup queries above must not run on every poll. Five
// minutes of TTL costs nothing and a stale entry only means a freshly approved
// photo shows up to five minutes later (the admin approve/reject endpoints do not
// need to clear it: the app is relaunched far more often than that).
const resolveCache = new Map<string, { url: string | null; at: number }>();
const RESOLVE_TTL_MS = 5 * 60 * 1000;

export async function resolveVehicleImageCached(
  v?: VehicleLike | null
): Promise<ResolvedVehicleImage> {
  const key = vehicleImageCacheKey(v);
  const hit = resolveCache.get(key);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) {
    return { url: hit.url, cacheKey: key, matched: hit.url ? "exact" : "none" };
  }
  const resolved = await resolveVehicleImage(v);
  resolveCache.set(key, { url: resolved.url, at: Date.now() });
  return resolved;
}
export async function noteDriverVehicle(v: VehicleLike): Promise<ResolvedVehicleImage> {
  const resolved = await resolveVehicleImage(v);
  if (resolved.url) return resolved;
  await claimVehicleImageFetch(v).catch((err) =>
    console.error("[vehicleImages] claim failed:", err?.message || err)
  );
  return resolved;
}

