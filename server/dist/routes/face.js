"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const s3_1 = require("../lib/s3");
const phash_1 = require("../lib/phash");
// Driver facial recognition (ported from the driver repo's server, adapted to this
// server's helpers: requireAuth + Firebase uid, query() returns rows, and the
// schema is ensured here so production never needs a manual migration).
//
// Enrolment happens in the app's vehicle/documents flow: the driver captures a
// front-camera selfie which is uploaded as a `face_scan` document (S3 + row in
// driver_documents).
//
//   POST /api/face/verify   live selfie compared against the enrolled scan
//   GET  /api/face/status   enrolment + recent verification attempts
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
let schemaReady = null;
/** Additive, idempotent: the same pattern the profile PATCH already uses. */
function ensureFaceSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            await (0, database_1.execute)(`
        CREATE TABLE IF NOT EXISTS face_verifications (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          driver_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ride_id          UUID REFERENCES rides(id),
          score            DOUBLE PRECISION,
          hamming_distance INTEGER,
          verified         BOOLEAN NOT NULL DEFAULT FALSE,
          method           VARCHAR(40) NOT NULL DEFAULT 'phash',
          status           VARCHAR(30) NOT NULL DEFAULT 'attempted',
          note             TEXT,
          created_at       TIMESTAMPTZ DEFAULT NOW()
        )
      `);
            await (0, database_1.execute)("CREATE INDEX IF NOT EXISTS idx_face_verifications_driver ON face_verifications(driver_id)");
            await (0, database_1.execute)("CREATE INDEX IF NOT EXISTS idx_face_verifications_created ON face_verifications(created_at DESC)");
            // The two new document types have to be storable. The CHECK is swapped inside
            // ONE transaction, so a failure can never leave the table with no constraint,
            // and any older doc_type CHECK (whatever it is called) is replaced.
            const checks = await (0, database_1.query)(`SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = 'driver_documents'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%doc_type%'`);
            const alreadyFine = checks.some((c) => c.def.includes("face_scan") && c.def.includes("profile_photo"));
            if (!alreadyFine) {
                await (0, database_1.withTransaction)(async (client) => {
                    for (const c of checks) {
                        await client.query(`ALTER TABLE driver_documents DROP CONSTRAINT IF EXISTS "${c.conname}"`);
                    }
                    await client.query(`ALTER TABLE driver_documents ADD CONSTRAINT driver_documents_doc_type_check
             CHECK (doc_type IN ('drivers_license','id_document','prdp','criminal_record',
                                 'license_disk','carscan_report','vehicle_scan',
                                 'profile_photo','face_scan'))`);
                });
            }
        })().catch((err) => {
            schemaReady = null; // let the next request retry
            throw err;
        });
    }
    return schemaReady;
}
/** Firebase uid -> the driver's own row (driver_documents/face_verifications key on users.id). */
async function driverRow(req) {
    const rows = await (0, database_1.query)("SELECT id, role FROM users WHERE firebase_uid = $1", [req.userId]);
    return rows[0] ?? null;
}
/** ride_id is a nullable FK, so anything that is not a uuid becomes null. */
const asRideId = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
// POST /api/face/verify — Body: { selfie (base64 or data: URL), ride_id? }
router.post("/verify", async (req, res) => {
    try {
        const { selfie, ride_id } = req.body || {};
        if (typeof selfie !== "string" || selfie.length === 0) {
            res.status(400).json({ error: "A selfie image (base64) is required" });
            return;
        }
        await ensureFaceSchema();
        const me = await driverRow(req);
        if (!me) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        if (me.role !== "driver") {
            res.status(403).json({ error: "Driver account required" });
            return;
        }
        const rideId = asRideId(ride_id);
        const scans = await (0, database_1.query)(`SELECT id, s3_key, status, file_name
         FROM driver_documents
        WHERE driver_id = $1 AND doc_type = 'face_scan'
        ORDER BY created_at DESC
        LIMIT 1`, [me.id]);
        const scan = scans[0];
        if (!scan) {
            await (0, database_1.execute)(`INSERT INTO face_verifications (driver_id, ride_id, verified, method, status, note)
         VALUES ($1, $2, FALSE, 'phash', 'missing_enrollment', $3)`, [me.id, rideId, "No face scan on file"]);
            res.json({
                verified: false,
                status: "missing_enrollment",
                reason: "No face scan on file. Complete your face scan in Vehicle & Documents first.",
            });
            return;
        }
        if (scan.status === "rejected") {
            res.json({
                verified: false,
                status: "scan_rejected",
                reason: "Your face scan was rejected during review. Please re-scan your face.",
            });
            return;
        }
        // Download the enrolled scan and compare it with the live selfie.
        const enrolled = await (0, s3_1.getObjectFromS3)(scan.s3_key);
        const selfieBuf = (0, phash_1.toImageBuffer)(selfie);
        const comparison = (0, phash_1.compareFaceImages)(enrolled, selfieBuf);
        const status = comparison.degenerate ? "degenerate" : comparison.verified ? "verified" : "mismatch";
        const note = comparison.degenerate
            ? "Image too blank/blurry to compare - capture failed closed."
            : comparison.verified
                ? null
                : "Live selfie does not match the enrolled face scan.";
        await (0, database_1.execute)(`INSERT INTO face_verifications
         (driver_id, ride_id, score, hamming_distance, verified, method, status, note)
       VALUES ($1, $2, $3, $4, $5, 'phash', $6, $7)`, [me.id, rideId, comparison.score, comparison.hammingDistance, comparison.verified, status, note]);
        res.json({
            verified: comparison.verified,
            score: comparison.score,
            hamming_distance: comparison.hammingDistance,
            status,
            reason: comparison.degenerate
                ? "Your photo is too dark or blurry. Find better lighting and try again."
                : comparison.verified
                    ? null
                    : "Your face doesn't match the driver on file.",
        });
    }
    catch (err) {
        console.error("face verify error:", err?.message || err);
        res.status(500).json({ error: "Failed to verify face" });
    }
});
// GET /api/face/status — enrolment + recent verification attempts
router.get("/status", async (req, res) => {
    try {
        await ensureFaceSchema();
        const me = await driverRow(req);
        if (!me) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const scans = await (0, database_1.query)(`SELECT id, status, file_name, created_at
         FROM driver_documents
        WHERE driver_id = $1 AND doc_type = 'face_scan'
        ORDER BY created_at DESC
        LIMIT 1`, [me.id]);
        const recent = await (0, database_1.query)(`SELECT score, hamming_distance, verified, method, status, note, created_at
         FROM face_verifications
        WHERE driver_id = $1
        ORDER BY created_at DESC
        LIMIT 10`, [me.id]);
        res.json({
            enrolled: scans.length > 0,
            face_scan: scans[0] || null,
            recent_verifications: recent,
        });
    }
    catch (err) {
        console.error("face status error:", err?.message || err);
        res.status(500).json({ error: "Failed to fetch face status" });
    }
});
exports.default = router;
//# sourceMappingURL=face.js.map