"use strict";
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
exports.generateImages = generateImages;
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
    return (0, vehicleImages_1.listVehicleImages)(status);
}
// ── Generate all colours WITHOUT CarsXE (the proven generate-vehicle-images.js
//    prompt, ported to the server). Needs GEMINI_API_KEY in the environment.
/** The exact style contract from scripts/generate-vehicle-images.js (white studio reference). */
const GEN_STYLE = "Photorealistic cut-out studio shot on a pure white seamless background. Camera at roughly " +
    "wheel-arch height, front three-quarter view from the driver's side with the nose pointing left. " +
    "The whole car is inside the frame, centred, with a small even margin around it. Soft, even, " +
    "large-source studio lighting, a gentle highlight along the bonnet and roof, realistic paint and " +
    "glass reflections, dark tinted windows, correctly round wheels with visible rims, headlights and " +
    "grille clearly modelled, and a subtle soft contact shadow under the tyres. No road, no scenery, " +
    "no props, no people, no text, no logos, no watermark.";
const GEN_TEMPLATE = "A high-resolution studio photograph of a {colour} {year} {make} {model}, front three-quarter view " +
    "from the driver's side, car facing left, centred, full car visible, plain pure white background, " +
    "soft studio lighting, realistic proportions, accurate {make} {model} body shape, no text, no people, " +
    "no other objects. " + GEN_STYLE;
async function geminiImage(prompt) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        const e = new Error("GEMINI_API_KEY is not set on the server — add it in EB → Configuration → Software → Environment properties (generation is disabled without it).");
        e.status = 503;
        throw e;
    }
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
        }),
    });
    if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        const e = new Error(`Gemini ${res.status}: ${body}`);
        e.status = res.status === 429 ? 429 : 502;
        throw e;
    }
    const json = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find((p) => p?.inlineData?.data);
    if (!inline)
        throw Object.assign(new Error("Gemini returned no image part"), { status: 502 });
    return Buffer.from(inline.inlineData.data, "base64");
}
/**
 * Generate this car in EVERY palette colour (default: the requested colour
 * only) — one Gemini call per colour, then the standard key-out/900x560/WebP
 * pipeline, approved straight away so requests auto-resolve. CarsXE is never
 * touched. Costs ~$0.04 per colour.
 */
async function generateImages(input, actor) {
    const palette = (input.colours && input.colours.length ? input.colours : ["white"])
        .map((c) => String(c).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12);
    const generated = [];
    const failed = [];
    for (const colour of palette) {
        try {
            const prompt = GEN_TEMPLATE.replaceAll("{colour}", colour)
                .replaceAll("{year}", String(input.year ?? ""))
                .replaceAll("{make}", input.make)
                .replaceAll("{model}", input.model);
            const raw = await geminiImage(prompt);
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
                licenceNote: `Gemini ${process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image"} via admin ${actor.email}`,
                webpBase64: raw.toString("base64"),
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
            if (err?.status === 429)
                break; // quota — stop burning the remaining colours
        }
    }
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "car_db.generate",
        entityType: "vehicle_images",
        newValue: { make: input.make, model: input.model, year: input.year, palette, generated: generated.length, failed },
    });
    if (!generated.length && failed.length) {
        const e = new Error(failed[0].error);
        e.status = failed[0].error?.includes("GEMINI_API_KEY") ? 503 : 502;
        throw e;
    }
    return { generated, failed };
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