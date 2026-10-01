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
const express_1 = require("express");
const fs_1 = require("fs");
const path_1 = require("path");
const database_1 = require("../config/database");
const s3_1 = require("../lib/s3");
const devLogs_1 = require("./devLogs");
const vehicleImages_1 = require("../services/vehicleImages");
// ── Environment diagnostics ────────────────────────────────────────────────────
//   GET /api/dev/diag?key=…        what the live instance is actually running
//   GET /api/dev/diag?key=…&s3=1   also do a real S3 write + delete round trip
//
// Same read key as the device-log viewer and the dispatch inspector. No secret is
// ever returned — only presence flags, lengths and messages.
//
// Why this exists: the two worst live bugs were both invisible from outside. Driver
// earnings read R0 because users.role had been rewritten to 'passenger', and every
// vehicle photo became none_found while CarsXE cheerfully returned HTTP 200 with
// nine images. Neither could be diagnosed without reading files on an instance
// nobody could ssh into, so this endpoint turns "probably X" into "X, proven" — and
// it is the only way to confirm from a laptop that a deploy actually landed.
const router = (0, express_1.Router)();
/** Which build is actually live. Rides along with every response so a stale
 *  deploy can never be mistaken for a broken fix. */
function buildStamp() {
    try {
        // This file is dist/routes/devDiag.js, so the entrypoint is one level up.
        const entry = (0, path_1.join)(__dirname, "..", "index.js");
        return { entry, builtAt: (0, fs_1.statSync)(entry).mtime.toISOString() };
    }
    catch (err) {
        return { error: String(err?.message || err) };
    }
}
/** sharp is imported lazily, so a wrong-platform native build stays invisible
 *  until the first image is processed — and even then it only shows up as a
 *  missing photo. Actually ENCODE something: a module that resolves is not the
 *  same as a native binary that works. */
async function probeSharp() {
    try {
        const sharp = (await Promise.resolve().then(() => __importStar(require("sharp")))).default;
        const png = await sharp({
            create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
        })
            .png()
            .toBuffer();
        return { loads: true, encodedBytes: png.length, versions: sharp.versions || null };
    }
    catch (err) {
        return {
            loads: false,
            error: String(err?.message || err),
            code: err?.code ?? null,
            hint: "a Windows-built @img/sharp-win32-x64 cannot load on linux-x64 — the EB hook must install the platform build",
        };
    }
}
/** The strongest possible check: real bytes into the real bucket, then clean up. */
async function probeS3() {
    const bucket = process.env.AWS_S3_BUCKET || "";
    if (!bucket)
        return { ok: false, error: "AWS_S3_BUCKET is not set" };
    const key = `diag/healthcheck-${Date.now()}.txt`;
    try {
        const up = await (0, s3_1.uploadToS3)(key, Buffer.from("vura s3 healthcheck").toString("base64"), "text/plain");
        await (0, s3_1.deleteFromS3)(key);
        return { ok: true, bucket: up.bucket, wroteBytes: up.size, deleted: true };
    }
    catch (err) {
        return { ok: false, bucket, key, error: String(err?.message || err), name: err?.name ?? null };
    }
}
router.get("/", async (req, res) => {
    if (String(req.query.key || "") !== devLogs_1.READ_KEY) {
        res.status(401).json({ error: "bad read key" });
        return;
    }
    const wantS3 = String(req.query.s3 || "") === "1";
    const [sharpStatus, budget] = await Promise.all([
        probeSharp(),
        (0, vehicleImages_1.carsxeUsage)().catch((err) => ({ error: String(err?.message || err) })),
    ]);
    const out = {
        serverTime: new Date().toISOString(),
        build: buildStamp(),
        runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
            uptimeSeconds: Math.round(process.uptime()),
            cwd: process.cwd(),
        },
        sharp: sharpStatus,
        carsxe: { keySet: Boolean(process.env.CARSXE_API_KEY), budget },
        storage: {
            bucket: process.env.AWS_S3_BUCKET || "MISSING",
            region: process.env.AWS_S3_REGION || "(default af-south-1)",
            staticKeysInEnv: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
            roundTrip: wantS3 ? await probeS3() : "not run — add &s3=1",
        },
    };
    // Why each car has no photo, newest first — the same reason the review page shows,
    // readable from a terminal.
    try {
        out.recentVehicleImages = await (0, database_1.query)(`SELECT cache_key, status, api_calls_used, attempts, last_error, last_attempt_at
         FROM vehicle_images
        ORDER BY COALESCE(last_attempt_at, created_at) DESC
        LIMIT 10`);
    }
    catch (err) {
        out.recentVehicleImages = { error: String(err?.message || err) };
    }
    // The role bug: an account that owns a driver_profiles row can never receive a
    // ride offer unless users.role is also 'driver', because the socket decides
    // driver-vs-passenger from that column alone. Anything where the two disagree is
    // a driver who is silently invisible to dispatch.
    try {
        out.driverRoles = await (0, database_1.query)(`SELECT u.email, u.role, dp.is_online, dp.vehicle_make, dp.vehicle_model
         FROM users u
         JOIN driver_profiles dp ON dp.user_id = u.id
        ORDER BY u.created_at DESC
        LIMIT 20`);
        out.driverRoleMismatch = await (0, database_1.query)(`SELECT u.email, u.role
         FROM users u
         JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.role <> 'driver'
        LIMIT 20`);
    }
    catch (err) {
        out.driverRoles = { error: String(err?.message || err) };
    }
    res.json(out);
});
exports.default = router;
//# sourceMappingURL=devDiag.js.map