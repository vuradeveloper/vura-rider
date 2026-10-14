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
exports.resolveRequestsForCacheKey = exports.recordCarDbMiss = exports.ensureRequestTable = void 0;
exports.listVehicleRequests = listVehicleRequests;
exports.resolveVehicleRequest = resolveVehicleRequest;
exports.addCarDbImage = addCarDbImage;
exports.searchCarsXe = searchCarsXe;
exports.approveImage = approveImage;
exports.refetchImage = refetchImage;
exports.rejectImage = rejectImage;
exports.listImages = listImages;
exports.purgeCarDb = purgeCarDb;
exports.generateImages = generateImages;
exports.generateAllCarColours = generateAllCarColours;
exports.catalogue = catalogue;
// ─────────────────────────────────────────────────────────────────────────────
// adminVehicleDb — ADMIN V2 Phase 7: Car DB console + vehicle photo requests.
//
// The image pipeline itself lives in services/vehicleImages (Car DB files,
// CarsXE search, S3, approval). This module adds the CONSOLE layer:
//   • a request queue: when a driver's car has no photo in the Car DB, the
//     gap is recorded here and the driver is alerted ONCE,
//   • filling a gap: upload a photo (importSeedImage) or trigger a web search,
//   • AUTO-RESOLVE: the moment an image for that cache_key is approved, every
//     open request for it resolves and the driver is pushed "photo ready" —
//     the driver does nothing; the next app load shows the image.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const notify_1 = require("./notify");
const vehicleImages_1 = require("./vehicleImages");
const adminAuth_1 = require("./adminAuth");
const vehicleCatalogue_1 = require("../data/vehicleCatalogue");
const vehicleImages_2 = require("./vehicleImages");
/** Idempotent — the migration creates this too; the guard covers first-boot order. */
exports.ensureRequestTable = vehicleImages_2.ensureVehicleRequestTable;
/**
 * Called from noteDriverVehicle's Car-DB-miss branch: queue the gap and alert
 * the driver exactly ONCE (driver_notified_at gates the push). Thin delegate —
 * the logic lives in vehicleImages next to the pipeline hooks.
 */
exports.recordCarDbMiss = vehicleImages_2.recordVehicleRequestMiss;
/** Console list: open (oldest first) or resolved; driver identity included. */
async function listVehicleRequests(status = "open") {
    await (0, exports.ensureRequestTable)();
    return (0, database_1.query)(`SELECT r.*, u.full_name AS driver_name, u.email AS driver_email
       FROM admin_vehicle_requests r
       JOIN users u ON u.id = r.driver_id
      WHERE ($1 = '' OR r.status = $1)
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at ASC
      LIMIT 300`, [status]);
}
/** Push "photo ready" to a driver (used by both manual and auto resolution). */
async function notifyReady(driverId, label) {
    await (0, notify_1.sendPushToUsers)([driverId], {
        type: "vehicle_image",
        title: "Your car photo is ready",
        body: `A photo for "${label}" is now live — it will show on trips automatically. Nothing else to do.`,
        highPriority: true,
    }).catch(() => null);
}
/** Manual console resolution (e.g. driver fixed their details). Audited. */
async function resolveVehicleRequest(id, actor, reason) {
    await (0, exports.ensureRequestTable)();
    const before = await (0, database_1.queryOne)(`SELECT * FROM admin_vehicle_requests WHERE id = $1`, [id]);
    if (!before)
        return null;
    await (0, database_1.execute)(`UPDATE admin_vehicle_requests
        SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
      WHERE id = $1`, [id]);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "vehicle_request.resolve",
        entityType: "admin_vehicle_requests",
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status: "resolved" },
        reason: reason ?? null,
    });
    const label = [before.make, before.model, before.year].filter(Boolean).join(" ");
    await notifyReady(before.driver_id, label || before.cache_key);
    return (0, database_1.queryOne)(`SELECT * FROM admin_vehicle_requests WHERE id = $1`, [id]);
}
/**
 * THE AUTO-PULL: when an image for cache_key becomes approved (via upload or
 * the review flow), every open request for that key resolves and its driver
 * is pushed. Thin delegate to the pipeline-side implementation.
 */
exports.resolveRequestsForCacheKey = vehicleImages_2.resolveVehicleRequests;
/** Admin uploads a photo for a missing car: pipeline → S3 → approved → auto-pull. */
async function addCarDbImage(input, actor) {
    const seed = await (0, vehicleImages_1.importSeedImage)({
        // MUST be the resolver's key format (make|model|year_range|colour) or the
        // approved image would never match the open requests it should release.
        cacheKey: (0, vehicleImages_2.vehicleImageCacheKey)({
            make: input.make,
            model: input.model,
            year: input.year ?? input.yearRange ?? null,
            colour: input.colour ?? "white",
        }),
        make: input.make,
        model: input.model,
        year: input.year ?? null,
        yearRange: input.yearRange ?? null,
        colour: input.colour ?? null,
        licenceNote: input.sourceNote ?? `Uploaded by admin ${actor.email}`,
        webpBase64: input.imageBase64,
        processRaw: true,
        approve: true,
    });
    const imageId = String(seed?.row?.id ?? "");
    const cacheKey = String(seed?.row?.cache_key ?? "").toLowerCase();
    // Admin placement: body shape + booking category ride with the row and win
    // the static guess in catalogueForApi.
    if (imageId && (input.bodyType || (input.categories && input.categories.length))) {
        await (0, database_1.execute)(`UPDATE vehicle_images
          SET body_type = COALESCE($2, body_type),
              categories = COALESCE($3::text[], categories)
        WHERE id = $1`, [imageId, input.bodyType ?? null, input.categories?.length ? input.categories : null]);
    }
    const resolved = cacheKey && imageId ? await (0, exports.resolveRequestsForCacheKey)(cacheKey, imageId) : 0;
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.image_add",
        entityType: "vehicle_images",
        entityId: imageId || cacheKey,
        newValue: { make: input.make, model: input.model, year: input.year, colour: input.colour },
    });
    return { image: seed, resolvedRequests: resolved };
}
/** Trigger the web (CarsXE) search for a car — the worker + approval finish it. */
async function searchCarsXe(v, actor) {
    const queued = await (0, vehicleImages_1.claimVehicleImageFetch)(v);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.search",
        entityType: "vehicle_images",
        newValue: { make: v.make, model: v.model, year: v.year, colour: v.colour, queued },
    });
    return { queued };
}
/** Approve a pending image (from search or upload) → resolves matching requests. */
async function approveImage(id, candidateIndex, actor) {
    const approval = await (0, vehicleImages_1.approveVehicleImage)(id, candidateIndex);
    if (!approval)
        throw new Error("image not found");
    // approveVehicleImage resolves matching open requests itself (auto-pull).
    const resolved = Number(approval.resolvedRequests ?? 0);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.image_approve",
        entityType: "vehicle_images",
        entityId: id,
        newValue: { candidateIndex, resolvedRequests: resolved },
    });
    return { approval, resolvedRequests: resolved };
}
async function refetchImage(id, actor) {
    const r = await (0, vehicleImages_1.refetchVehicleImage)(id);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.image_refetch",
        entityType: "vehicle_images",
        entityId: id,
    });
    return r;
}
async function rejectImage(id, actor) {
    const r = await (0, vehicleImages_1.rejectVehicleImage)(id);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.image_reject",
        entityType: "vehicle_images",
        entityId: id,
    });
    return r;
}
async function listImages(status) {
    const rows = await (0, vehicleImages_1.listVehicleImages)(status);
    // The apps pull photos via the PUBLIC bucket route /api/vehicle-images/<file>
    // (never the raw S3 URL) — the console uses the exact same source.
    return (rows || []).map((r) => ({
        ...r,
        display_url: r.storage_key
            ? `/api/vehicle-images/${String(r.storage_key).split("/").pop()}`
            : null,
    }));
}
/**
 * Clear the whole image library (console "Clear Car DB") — used right before a
 * curated re-import of the white masters + v11 colours. Audited; returns how
 * many rows were removed. Driver/rider apps fall back to silhouettes until the
 * re-import lands, so run it only as part of a refresh.
 */
async function purgeCarDb(actor) {
    const before = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS n FROM vehicle_images`);
    await (0, database_1.execute)(`DELETE FROM vehicle_images`);
    const removed = before?.n ?? 0;
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.purge",
        entityType: "vehicle_images",
        oldValue: { rows: removed },
        newValue: { rows: 0 },
    });
    return { removed };
}
// (recolourFromWhite + RECOLOUR_PALETTE live in services/vehicleImages — one
// engine shared by this console path and the automatic backfill worker.)
/**
 * Generate this car's missing colours from the WHITE original:
 *   • source = the uploaded file when given, else the car's existing approved
 *     WHITE row from the Car DB (zero upload needed),
 *   • one recolour per requested palette colour (default: every missing one),
 *   • each variant goes through the standard pipeline → approved → matching
 *     requests auto-resolve and drivers are pushed "photo ready".
 */
async function generateImages(input, actor) {
    // Source: the uploaded white original, else the car's approved WHITE row.
    const baseKey = (0, vehicleImages_2.vehicleImageCacheKey)({
        make: input.make,
        model: input.model,
        year: input.year ?? input.yearRange ?? null,
        colour: "white",
    });
    let raw = null;
    let source = "upload";
    if (input.imageBase64) {
        const b64 = input.imageBase64.includes(",") ? input.imageBase64.split(",")[1] : input.imageBase64;
        raw = Buffer.from(b64, "base64");
    }
    else {
        const whiteRow = await (0, database_1.queryOne)(`SELECT storage_key FROM vehicle_images
        WHERE cache_key = $1 AND status = 'approved' AND storage_key IS NOT NULL
        LIMIT 1`, [baseKey]);
        if (whiteRow?.storage_key) {
            const { getObjectFromS3 } = await Promise.resolve().then(() => __importStar(require("../lib/s3")));
            raw = await getObjectFromS3(whiteRow.storage_key);
            source = "car-db";
        }
    }
    if (!raw || !raw.length) {
        const e = new Error("No white original found: upload the white photo here first (it becomes the generate source), or add the white row to the Car DB.");
        e.status = 400;
        throw e;
    }
    // Default = every palette colour the car does NOT have approved yet.
    const baseNoColour = baseKey.slice(0, baseKey.lastIndexOf("|"));
    const existing = await (0, database_1.query)(`SELECT colour FROM vehicle_images
      WHERE cache_key LIKE $1 AND status = 'approved'`, [`${baseNoColour}|%`]);
    const have = new Set(existing.map((r) => String(r.colour || "").toLowerCase()));
    const palette = (input.colours && input.colours.length ? input.colours : vehicleImages_1.RECOLOUR_PALETTE)
        .map((c) => String(c).trim().toLowerCase())
        .filter((c) => c && c !== "white" && !have.has(c))
        .slice(0, 12);
    const generated = [];
    const failed = [];
    for (const colour of palette) {
        try {
            // STRICTLY the .py v12 engine — never the sharp fallback.
            const out = await (0, vehicleImages_1.pythonRecolour)(raw, colour);
            if (!out) {
                failed.push({ colour, error: "v12 python engine unavailable on this server" });
                break;
            }
            const seed = await (0, vehicleImages_1.importSeedImage)({
                // Resolver key format (make|model|year_range|colour) — auto-pull matches on it.
                cacheKey: (0, vehicleImages_2.vehicleImageCacheKey)({
                    make: input.make,
                    model: input.model,
                    year: input.year ?? input.yearRange ?? null,
                    colour,
                }),
                make: input.make,
                model: input.model,
                year: input.year ?? null,
                yearRange: input.yearRange ?? null,
                colour,
                licenceNote: `Recoloured from the white original by admin ${actor.email}`,
                webpBase64: out.toString("base64"),
                processRaw: true,
                approve: true,
            });
            generated.push({ colour, imageId: seed?.row?.id, cacheKey: seed?.row?.cache_key });
            if (seed?.row?.id && (input.bodyType || (input.categories && input.categories.length))) {
                await (0, database_1.execute)(`UPDATE vehicle_images
              SET body_type = COALESCE($2, body_type),
                  categories = COALESCE($3::text[], categories)
            WHERE id = $1`, [String(seed.row.id), input.bodyType ?? null, input.categories?.length ? input.categories : null]);
            }
        }
        catch (err) {
            failed.push({ colour, error: err?.message || String(err) });
        }
    }
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.generate",
        entityType: "vehicle_images",
        newValue: { make: input.make, model: input.model, year: input.year, source, generated: generated.length, failed },
    });
    if (!generated.length && failed.length) {
        const e = new Error(failed[0].error);
        e.status = 400;
        throw e;
    }
    return { generated, failed, source };
}
// ── Generate Car All: every car × every missing colour, .py v12 ONLY,
//    background so the HTTP call returns instantly. One run at a time.
let generateAllRunning = false;
function generateAllCarColours() {
    if (generateAllRunning)
        return { started: false, running: true };
    generateAllRunning = true;
    void (async () => {
        try {
            const made = await (0, vehicleImages_1.autoFillMissingColours)(100_000, true);
            console.log(`[carDb] generate-all finished: ${made} colour(s) created via v12`);
        }
        catch (err) {
            console.error("[carDb] generate-all failed:", err?.message || err);
        }
        finally {
            generateAllRunning = false;
        }
    })();
    return { started: true, running: true };
}
/** Static catalogue (makes/models/body/years) for the console's pickers. */
function catalogue() {
    return {
        makes: Object.entries(vehicleCatalogue_1.MAKE_MODELS).map(([make, models]) => ({
            make,
            models: models.map((m) => ({
                model: m.model,
                body: m.body,
                yearRange: m.year_range ?? m.yearRange ?? null,
                categories: m.categories ?? null,
            })),
        })),
    };
}
//# sourceMappingURL=adminVehicleDb.js.map