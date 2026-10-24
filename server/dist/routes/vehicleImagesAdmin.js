"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// vehicleImagesAdmin.ts — the two server endpoints the Car DB still needs:
//
//   GET  /api/vehicle-images/<file>.webp   public: our own stored copy
//   POST /api/admin/vehicle-images/seed    local importer: load a finished
//                                          WebP / raw image into the Car DB
//
// The old CarsXE review page and its approve/reject/refetch actions are gone.
// The console (Vura-Admin) owns review, categories and uploads now.
//
// Auth is HTTP Basic with CAR_DB_ADMIN_PASSWORD (legacy CARSXE_ADMIN_PASSWORD
// still works for the import scripts). If neither is set the seed endpoint
// answers 503 instead of being open to the world.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = __importDefault(require("express"));
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_1 = require("../lib/s3");
const vehicleImages_1 = require("../services/vehicleImages");
const router = express_1.default.Router();
function requireAdmin(req, res) {
    const password = process.env.CAR_DB_ADMIN_PASSWORD || process.env.CARSXE_ADMIN_PASSWORD || "";
    if (!password) {
        res.status(503).send("CAR_DB_ADMIN_PASSWORD is not set on the server — the importer is disabled.");
        return false;
    }
    const header = String(req.headers.authorization || "");
    const expected = "Basic " + Buffer.from(`admin:${password}`).toString("base64");
    if (header !== expected) {
        res.set("WWW-Authenticate", 'Basic realm="Vura vehicle images"');
        res.status(401).send("Authentication required.");
        return false;
    }
    return true;
}
// ── public: our own copy, straight from our bucket (never a third-party link) ──
router.get("/vehicle-images/:file", async (req, res) => {
    const file = String(req.params.file || "");
    // One flat namespace, no traversal: letters, digits, dash, dot, underscore only.
    if (!/^[a-z0-9._-]{3,160}$/i.test(file)) {
        res.status(400).end();
        return;
    }
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) {
        res.status(503).end();
        return;
    }
    try {
        const out = await s3_1.s3.send(new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: `vehicle-images/${file}` }));
        if (!out.Body) {
            res.status(404).end();
            return;
        }
        res.set("Content-Type", out.ContentType || "image/webp");
        res.set("Cache-Control", "public, max-age=31536000, immutable");
        const bytes = await out.Body.transformToByteArray();
        res.end(Buffer.from(bytes));
    }
    catch {
        res.status(404).end();
    }
});
// ── local importer: finished WebP or raw image → Car DB (0 external calls) ─────
router.post("/admin/vehicle-images/seed", async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    try {
        const body = req.body || {};
        if (!body.cacheKey || !body.image) {
            res.status(400).json({ error: "cacheKey and image (base64 webp) are required" });
            return;
        }
        const out = await (0, vehicleImages_1.importSeedImage)({
            cacheKey: String(body.cacheKey),
            make: String(body.make || ""),
            model: String(body.model || ""),
            year: body.year ?? null,
            yearRange: body.yearRange ?? null,
            colour: body.colour ?? null,
            sourceUrl: body.sourceUrl ?? null,
            contextLink: body.contextLink ?? null,
            licenceNote: body.licenceNote ?? null,
            webpBase64: String(body.image),
            candidates: Array.isArray(body.candidates) ? body.candidates : [],
            // The Car DB importer sends the ORIGINAL jpg/png and lets the server run
            // the standard pipeline, so an imported photo is processed exactly like
            // an uploaded one.
            processRaw: body.process === true,
            approve: body.approve === true,
        });
        res.json({
            success: true,
            cacheKey: out.row?.cache_key,
            status: out.row?.status,
            yearRange: out.row?.year_range,
            imageUrl: out.candidate.url,
            bytes: out.candidate.bytes,
            budget: out.budget,
        });
    }
    catch (err) {
        console.error("Seed import error:", err?.message || err);
        res.status(500).json({ error: err?.message || "import failed" });
    }
});
exports.default = router;
//# sourceMappingURL=vehicleImagesAdmin.js.map