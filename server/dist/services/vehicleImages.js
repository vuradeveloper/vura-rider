"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileNameFor = exports.storageKeyFor = exports.MAX_BYTES = exports.CANVAS = void 0;
exports.generationRange = generationRange;
exports.vehicleImageCacheKey = vehicleImageCacheKey;
exports.ensureVehicleImageTables = ensureVehicleImageTables;
exports.carsxeMaxCalls = carsxeMaxCalls;
exports.carsxeUsage = carsxeUsage;
exports.logCarsxeCall = logCarsxeCall;
exports.resolveVehicleImage = resolveVehicleImage;
exports.claimVehicleImageFetch = claimVehicleImageFetch;
exports.scoreCandidates = scoreCandidates;
exports.imageBaseUrl = imageBaseUrl;
exports.downloadImage = downloadImage;
exports.processVehicleImage = processVehicleImage;
exports.runCarsxeFetch = runCarsxeFetch;
exports.startVehicleImageWorker = startVehicleImageWorker;
exports.stopVehicleImageWorker = stopVehicleImageWorker;
exports.listVehicleImages = listVehicleImages;
exports.approveVehicleImage = approveVehicleImage;
exports.rejectVehicleImage = rejectVehicleImage;
exports.importSeedImage = importSeedImage;
exports.noteDriverVehicle = noteDriverVehicle;
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
const database_1 = require("../config/database");
const s3_1 = require("../lib/s3");
exports.CANVAS = { w: 900, h: 560 };
exports.MAX_BYTES = 80 * 1024;
const CARSXE_URL = "https://api.carsxe.com/images";
const DEFAULT_MAX_CALLS = 90; // of the 100-call budget; the rest is headroom
const MAX_CANDIDATES = 3;
// ── cache keys ───────────────────────────────────────────────────────────────
/**
 * The "generation" bucket of a model year. 2017, 2018, 2019 and 2020 all land in
 * "2017-2020" (4-year blocks), which is what makes rule 2b work: a 2019 Picanto
 * request reuses the image imported for 2018 with NO api call.
 */
function generationRange(year) {
    const y = Number(year);
    if (!Number.isFinite(y) || y < 1950 || y > 2100)
        return "any";
    const start = Math.floor((y - 1) / 4) * 4 + 1;
    return `${start}-${start + 3}`;
}
const slug = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** lowercase make|model|year_range|colour — the DB's unique key. */
function vehicleImageCacheKey(v) {
    const make = slug(v?.make || v?.vehicle_make);
    const model = slug(v?.model || v?.vehicle_model);
    const colour = slug(v?.colour || v?.vehicle_color);
    const year = v?.year ?? v?.vehicle_year;
    return `${make}|${model}|${generationRange(year)}|${colour}`;
}
/** make | model | colour with the year bucket wildcarded, for fallback matching. */
function keyParts(cacheKey) {
    const [make = "", model = "", , colour = ""] = cacheKey.split("|");
    return { make, model, colour };
}
// ── schema ───────────────────────────────────────────────────────────────────
let ensured = false;
async function ensureVehicleImageTables() {
    if (ensured)
        return;
    await (0, database_1.execute)(`
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
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS carsxe_usage_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key VARCHAR(160),
      called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      result_count INTEGER,
      http_status INTEGER,
      note TEXT
    )
  `);
    await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS vehicle_images_status_idx ON vehicle_images (status)`);
    ensured = true;
}
// ── budget ───────────────────────────────────────────────────────────────────
function carsxeMaxCalls() {
    const n = parseInt(process.env.CARSXE_MAX_CALLS || "", 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CALLS;
}
/** Counts EVERY logged call, including the ones imported from the dashboard. */
async function carsxeUsage() {
    await ensureVehicleImageTables();
    const row = await (0, database_1.queryOne)(`SELECT COUNT(*)::text AS used FROM carsxe_usage_log`);
    const used = parseInt(row?.used || "0", 10);
    const max = carsxeMaxCalls();
    return { used, max, left: Math.max(0, max - used), blocked: used >= max };
}
/**
 * Records one call. NEVER pass the request URL here — it carries the API key.
 */
async function logCarsxeCall(cacheKey, resultCount, httpStatus, note) {
    await (0, database_1.execute)(`INSERT INTO carsxe_usage_log (cache_key, result_count, http_status, note)
     VALUES ($1, $2, $3, $4)`, [cacheKey, resultCount, httpStatus, note]);
}
/**
 * Fallback order, resolved server-side so every client agrees:
 *   1. approved, exact make+model+generation+colour
 *   2. approved, same make+model+colour, another generation   (the 2019 -> 2018 image)
 *   3. approved, same make+model, another colour              (colour fetch queued meanwhile)
 *   4. none -> the app draws the body-type icon, then the generic car
 */
async function resolveVehicleImage(v) {
    await ensureVehicleImageTables();
    const cacheKey = vehicleImageCacheKey(v);
    const { make, model, colour } = keyParts(cacheKey);
    if (!make || !model)
        return { url: null, cacheKey, matched: "none" };
    const exact = await (0, database_1.queryOne)(`SELECT image_url FROM vehicle_images
      WHERE cache_key = $1 AND status = 'approved' AND image_url IS NOT NULL`, [cacheKey]);
    if (exact?.image_url)
        return { url: exact.image_url, cacheKey, matched: "exact" };
    if (colour) {
        const sameColour = await (0, database_1.queryOne)(`SELECT image_url FROM vehicle_images
        WHERE make = $1 AND model = $2 AND colour = $3 AND status = 'approved' AND image_url IS NOT NULL
        ORDER BY approved_at DESC NULLS LAST LIMIT 1`, [make, model, colour]);
        if (sameColour?.image_url) {
            return { url: sameColour.image_url, cacheKey, matched: "model-colour" };
        }
    }
    const anyColour = await (0, database_1.queryOne)(`SELECT image_url FROM vehicle_images
      WHERE make = $1 AND model = $2 AND status = 'approved' AND image_url IS NOT NULL
      ORDER BY approved_at DESC NULLS LAST LIMIT 1`, [make, model]);
    if (anyColour?.image_url)
        return { url: anyColour.image_url, cacheKey, matched: "model" };
    return { url: null, cacheKey, matched: "none" };
}
/**
 * Returns true ONLY for the caller that created the row. Two drivers saving the
 * same car in the same second therefore queue exactly ONE CarsXE call — the
 * unique constraint on cache_key decides the winner, not application logic.
 * A pre-existing row of ANY status (pending/rejected/none_found) is left alone,
 * which is what makes "never retry a rejected or none_found key automatically"
 * true without a second check.
 */
async function claimVehicleImageFetch(v) {
    await ensureVehicleImageTables();
    const cacheKey = vehicleImageCacheKey(v);
    const { make, model, colour } = keyParts(cacheKey);
    if (!make || !model)
        return false;
    const created = await (0, database_1.queryOne)(`INSERT INTO vehicle_images (cache_key, make, model, year, colour, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')
     ON CONFLICT (cache_key) DO NOTHING
     RETURNING id`, [cacheKey, make, model, Number(v?.year ?? v?.vehicle_year) || null, colour]);
    return Boolean(created);
}
// ── picking the best of the returned images (no extra calls) ──────────────────
const DEALER_PAGE = /(autotrader|gumtree|olx|facebook|marketplace|carfind|weelee|dealer|classified|bid|auction)/i;
const WATERMARK = /(watermark|shutterstock|getty|alamy|dreamstime|123rf|istock|stock)/i;
/**
 * Scores every image on the criteria you specified and returns them best-first:
 *   + png/webp preferred, + width >= 600 (and 1000), + aspect ratio 1.2–2.2,
 *   − dealer/classifieds context pages, − watermarked stock libraries.
 * Nothing here calls the API — it only reads the array we already paid for.
 */
function scoreCandidates(images) {
    return (images || [])
        .filter((img) => typeof img?.link === "string" && img.link.startsWith("http"))
        .map((img) => {
        const mime = String(img.mime || "").toLowerCase();
        const w = Number(img.width) || 0;
        const h = Number(img.height) || 0;
        const ar = w && h ? w / h : 0;
        const ctx = String(img.contextLink || "");
        const reasons = [];
        let score = 0;
        if (/png|webp/.test(mime)) {
            score += 3;
            reasons.push("png/webp");
        }
        if (w >= 600) {
            score += 2;
            reasons.push("width>=600");
        }
        if (w >= 1000) {
            score += 2;
            reasons.push("width>=1000");
        }
        if (ar >= 1.2 && ar <= 2.2) {
            score += 4;
            reasons.push("good aspect");
        }
        else if (ar) {
            score -= 3;
            reasons.push(`odd aspect ${ar.toFixed(2)}`);
        }
        if (DEALER_PAGE.test(ctx)) {
            score -= 6;
            reasons.push("dealer/classifieds page");
        }
        if (WATERMARK.test(ctx) || WATERMARK.test(img.link || "")) {
            score -= 5;
            reasons.push("possible watermark");
        }
        if (Number(img.byteSize) > 4 * 1024 * 1024) {
            score -= 2;
            reasons.push("very large");
        }
        return { ...img, score, note: reasons.join(", ") || "no strong signal" };
    })
        .sort((a, b) => b.score - a.score || (Number(b.width) || 0) - (Number(a.width) || 0));
}
// ── download, key out the studio background, trim, canvas, webp under 80 KB ───
function imageBaseUrl() {
    const base = (process.env.PUBLIC_API_BASE || "").replace(/\/+$/, "");
    return base ? `${base}/api/vehicle-images` : "/api/vehicle-images";
}
const fileFor = (cacheKey, index = 0) => `${cacheKey.replace(/\|/g, "-").replace(/[^a-z0-9.\-]/gi, "_")}${index ? `-${index + 1}` : ""}.webp`;
const storageKeyFor = (cacheKey, index = 0) => `vehicle-images/${fileFor(cacheKey, index)}`;
exports.storageKeyFor = storageKeyFor;
exports.fileNameFor = fileFor;
/**
 * Downloads a candidate ONCE. Never hotlinks: the bytes are re-uploaded to our
 * own bucket and only our own URL is ever stored or shown.
 */
async function downloadImage(url) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok)
        throw new Error(`download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024)
        throw new Error("suspiciously small image");
    return buf;
}
/**
 * Studio shots sit on a plain light background, so keying it out is deterministic
 * and needs no ML model (a 40 MB ONNX runtime does not belong in an EB deploy).
 * Pure white -> fully transparent, near-white -> feathered, then trim, fit the
 * shared 900x560 canvas (same as scripts/generate-vehicle-images.js) and step the
 * WebP quality down until it fits 80 KB.
 */
async function processVehicleImage(input) {
    const sharp = (await Promise.resolve().then(() => __importStar(require("sharp")))).default;
    const { data, info } = await sharp(input)
        .rotate()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const min = Math.min(r, g, b);
        const spread = Math.max(r, g, b) - min;
        if (min >= 236 && spread <= 14)
            data[i + 3] = 0;
        else if (min >= 205 && spread <= 20)
            data[i + 3] = Math.round(255 * ((236 - min) / 31));
    }
    const canvas = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .trim({ threshold: 2 })
        .resize(exports.CANVAS.w, exports.CANVAS.h, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    let out = await canvas.webp({ quality: 82, effort: 5 }).toBuffer();
    for (let q = 76; q >= 40 && out.length > exports.MAX_BYTES; q -= 6) {
        out = await canvas.webp({ quality: q, effort: 5 }).toBuffer();
    }
    return out;
}
// ── the one and only CarsXE call, guarded by the budget ───────────────────────
/**
 * Runs for a row that is already 'queued' — the caller must have WON the claim,
 * so there is exactly one of these per cache_key. Logs the call (status and count
 * only — never the URL, which carries the key), stores up to three processed
 * candidates as 'pending' and leaves the row for human approval.
 */
async function runCarsxeFetch(cacheKey) {
    await ensureVehicleImageTables();
    const row = await (0, database_1.queryOne)(`SELECT id, make, model, year, colour, status FROM vehicle_images WHERE cache_key = $1`, [cacheKey]);
    if (!row || row.status !== "queued")
        return;
    const key = process.env.CARSXE_API_KEY;
    if (!key) {
        console.warn("[vehicleImages] CARSXE_API_KEY is not set — no photo for", cacheKey);
        await (0, database_1.execute)(`UPDATE vehicle_images SET status = 'none_found' WHERE id = $1`, [row.id]);
        return;
    }
    const budget = await carsxeUsage();
    if (budget.blocked) {
        console.warn(`[vehicleImages] CarsXE budget reached (${budget.used}/${budget.max}) — no call for ${cacheKey}. ` +
            `Raise CARSXE_MAX_CALLS only if you really have budget left.`);
        await (0, database_1.execute)(`UPDATE vehicle_images SET status = 'none_found' WHERE id = $1`, [row.id]);
        return;
    }
    const qs = new URLSearchParams({
        key,
        make: String(row.make || ""),
        model: String(row.model || ""),
        ...(row.year ? { year: String(row.year) } : {}),
        ...(row.colour ? { color: String(row.colour) } : {}),
    });
    let httpStatus = null;
    let images = [];
    try {
        const res = await fetch(`${CARSXE_URL}?${qs.toString()}`);
        httpStatus = res.status;
        const body = await res.json().catch(() => null);
        images = Array.isArray(body?.images) ? body.images : [];
        // ⚠ the request URL carries the key: log the status and the count, nothing else.
        await logCarsxeCall(cacheKey, images.length, httpStatus, "carsxe images lookup");
    }
    catch (err) {
        await logCarsxeCall(cacheKey, null, httpStatus, `request failed: ${err?.message || err}`);
        await (0, database_1.execute)(`UPDATE vehicle_images SET status = 'none_found', api_calls_used = 1 WHERE id = $1`, [row.id]);
        return;
    }
    const sharp = (await Promise.resolve().then(() => __importStar(require("sharp")))).default;
    const picks = scoreCandidates(images).slice(0, MAX_CANDIDATES);
    const stored = [];
    for (const [i, pick] of picks.entries()) {
        try {
            const webp = await processVehicleImage(await downloadImage(pick.link));
            const storageKey = (0, exports.storageKeyFor)(cacheKey, i);
            const up = await (0, s3_1.uploadToS3)(storageKey, webp.toString("base64"), "image/webp");
            const meta = await sharp(webp).metadata();
            stored.push({
                url: `${imageBaseUrl()}/${(0, exports.fileNameFor)(cacheKey, i)}`,
                storageKey,
                sourceUrl: pick.link,
                contextLink: String(pick.contextLink || ""),
                width: meta.width || exports.CANVAS.w,
                height: meta.height || exports.CANVAS.h,
                bytes: up.size,
                score: pick.score,
                note: pick.note,
            });
        }
        catch (err) {
            console.warn(`[vehicleImages] candidate ${i + 1} for ${cacheKey} failed:`, err?.message || err);
        }
    }
    if (!stored.length) {
        await (0, database_1.execute)(`UPDATE vehicle_images SET status = 'none_found', api_calls_used = 1 WHERE id = $1`, [row.id]);
        return;
    }
    const best = stored[0];
    await (0, database_1.execute)(`UPDATE vehicle_images
        SET status = 'pending', image_url = $2, storage_key = $3, source_url = $4,
            context_link = $5, width = $6, height = $7, candidates = $8::jsonb, api_calls_used = 1
      WHERE id = $1`, [row.id, best.url, best.storageKey, best.sourceUrl, best.contextLink, best.width, best.height, JSON.stringify(stored)]);
    console.log(`[vehicleImages] ${cacheKey}: ${stored.length} candidate(s) waiting for approval`);
}
// ── background worker: drains 'queued' rows, one call per key, budget-aware ───
let worker = null;
function startVehicleImageWorker(intervalMs = 30_000) {
    if (worker)
        return worker;
    worker = setInterval(async () => {
        try {
            await ensureVehicleImageTables();
            if ((await carsxeUsage()).blocked)
                return;
            const rows = await (0, database_1.query)(`SELECT cache_key FROM vehicle_images WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`);
            for (const row of rows)
                await runCarsxeFetch(row.cache_key);
        }
        catch (err) {
            console.error("[vehicleImages] worker error:", err?.message || err);
        }
    }, intervalMs);
    worker.unref?.();
    return worker;
}
function stopVehicleImageWorker() {
    if (worker)
        clearInterval(worker);
    worker = null;
}
// ── admin operations (the review page) ───────────────────────────────────────
async function listVehicleImages(status) {
    await ensureVehicleImageTables();
    return status
        ? (0, database_1.query)(`SELECT * FROM vehicle_images WHERE status = $1 ORDER BY created_at DESC`, [status])
        : (0, database_1.query)(`SELECT * FROM vehicle_images ORDER BY created_at DESC LIMIT 200`);
}
/** Approves the row, optionally promoting a different candidate than the auto-pick. */
async function approveVehicleImage(id, candidateIndex = 0) {
    await ensureVehicleImageTables();
    const row = await (0, database_1.queryOne)(`SELECT * FROM vehicle_images WHERE id = $1`, [id]);
    if (!row)
        return null;
    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    const chosen = candidates[candidateIndex] || null;
    await (0, database_1.execute)(`UPDATE vehicle_images
        SET status = 'approved', approved_at = NOW(),
            image_url = COALESCE($2, image_url), storage_key = COALESCE($3, storage_key),
            source_url = COALESCE($4, source_url), context_link = COALESCE($5, context_link),
            width = COALESCE($6, width), height = COALESCE($7, height)
      WHERE id = $1`, [id, chosen?.url ?? null, chosen?.storageKey ?? null, chosen?.sourceUrl ?? null,
        chosen?.contextLink ?? null, chosen?.width ?? null, chosen?.height ?? null]);
    // The candidates you did not choose are dead weight in the bucket.
    for (const [i, c] of candidates.entries()) {
        if (i !== candidateIndex && c?.storageKey)
            await (0, s3_1.deleteFromS3)(c.storageKey).catch(() => { });
    }
    return { id, candidateIndex, imageUrl: chosen?.url || row.image_url };
}
async function rejectVehicleImage(id) {
    await ensureVehicleImageTables();
    await (0, database_1.execute)(`UPDATE vehicle_images SET status = 'rejected' WHERE id = $1`, [id]);
    return { id };
}
/**
 * Step 0 — a finished image produced by scripts/import-seed.js from a dashboard
 * search you already made. ZERO CarsXE calls: the bytes arrive already processed,
 * we only store them. Idempotent: re-running overwrites the same row instead of
 * adding a second one, and the usage log records the import exactly once.
 */
async function importSeedImage(input) {
    await ensureVehicleImageTables();
    const cacheKey = input.cacheKey.trim().toLowerCase();
    const storageKey = (0, exports.storageKeyFor)(cacheKey, 0);
    const webp = Buffer.from(input.webpBase64.includes(",") ? input.webpBase64.split(",")[1] : input.webpBase64, "base64");
    if (!webp.length)
        throw new Error("empty image payload");
    const sharp = (await Promise.resolve().then(() => __importStar(require("sharp")))).default;
    const meta = await sharp(webp).metadata();
    const up = await (0, s3_1.uploadToS3)(storageKey, webp.toString("base64"), "image/webp");
    const candidate = {
        url: `${imageBaseUrl()}/${(0, exports.fileNameFor)(cacheKey, 0)}`,
        storageKey,
        sourceUrl: input.sourceUrl || "",
        contextLink: input.contextLink || "",
        width: meta.width || exports.CANVAS.w,
        height: meta.height || exports.CANVAS.h,
        bytes: up.size,
        score: 0,
        note: "imported from the CarsXE dashboard search",
    };
    const candidates = [candidate, ...(input.candidates || [])];
    const row = await (0, database_1.queryOne)(`INSERT INTO vehicle_images
       (cache_key, make, model, year, colour, image_url, storage_key, source_url, context_link,
        licence_note, width, height, status, candidates, api_calls_used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13::jsonb,0)
     ON CONFLICT (cache_key) DO UPDATE
       SET image_url = EXCLUDED.image_url, storage_key = EXCLUDED.storage_key,
           source_url = EXCLUDED.source_url, context_link = EXCLUDED.context_link,
           licence_note = EXCLUDED.licence_note, width = EXCLUDED.width, height = EXCLUDED.height,
           candidates = EXCLUDED.candidates, status = 'pending'
     RETURNING *`, [cacheKey, input.make, input.model, input.year ?? null, input.colour ?? null,
        candidate.url, storageKey, candidate.sourceUrl, candidate.contextLink,
        input.licenceNote ?? null, candidate.width, candidate.height, JSON.stringify(candidates)]);
    // The dashboard search cost you one call, so the budget must count it — once.
    const already = await (0, database_1.queryOne)(`SELECT id FROM carsxe_usage_log WHERE cache_key = $1 AND note LIKE 'imported%' LIMIT 1`, [cacheKey]);
    if (!already) {
        await logCarsxeCall(cacheKey, (input.candidates || []).length + 1, 200, "imported from dashboard search");
    }
    return { row, candidate, budget: await carsxeUsage() };
}
async function noteDriverVehicle(v) {
    const resolved = await resolveVehicleImage(v);
    if (resolved.url)
        return resolved;
    await claimVehicleImageFetch(v).catch((err) => console.error("[vehicleImages] claim failed:", err?.message || err));
    return resolved;
}
//# sourceMappingURL=vehicleImages.js.map