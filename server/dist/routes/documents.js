"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const s3_1 = require("../lib/s3");
// Driver document storage — S3 + Postgres metadata.
//   POST   /api/documents/upload     driver uploads a document
//   GET    /api/documents/mine       driver lists their own documents
//   GET    /api/documents            admin lists documents (all drivers)
//   GET    /api/documents/:id/url    owner or admin gets a view URL
//   PATCH  /api/documents/:id/status admin approves/rejects a document
//   DELETE /api/documents/:id        owner or admin removes a document
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
async function loadDbUser(req) {
    if (!req.userId)
        return null;
    const rows = await (0, database_1.query)("SELECT id, role FROM users WHERE firebase_uid = $1", [req.userId]);
    return rows[0] ?? null;
}
/** Gate an endpoint to the given DB roles. Attaches the DB user row. */
function roleGuard(roles) {
    return async (req, res, next) => {
        try {
            const u = await loadDbUser(req);
            if (!u) {
                res.status(401).json({ error: "User not synced — call /api/users/sync first" });
                return;
            }
            req.dbUser = u;
            if (!roles.includes(u.role)) {
                res.status(403).json({ error: "Insufficient permissions" });
                return;
            }
            next();
        }
        catch (err) {
            res.status(500).json({ error: err?.message || "Auth lookup failed" });
        }
    };
}
async function loadDoc(id) {
    const rows = await (0, database_1.query)(`SELECT id, driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket,
            size_bytes, status, note, reviewed_at, created_at
       FROM driver_documents WHERE id = $1`, [id]);
    return rows[0] ?? null;
}
// ── driver side ───────────────────────────────────────────────────────────────
// POST /api/documents/upload
// Body: { type, fileName, mimeType, data (base64 or data: URL), note? }
router.post("/upload", roleGuard(["driver", "admin"]), async (req, res) => {
    try {
        const { type, fileName, mimeType, data, note } = req.body || {};
        const dbUser = req.dbUser;
        if (!(0, s3_1.isDocumentType)(type)) {
            res.status(400).json({ error: `Invalid document type. Allowed: ${type ? String(type) : "missing"}` });
            return;
        }
        if (typeof data !== "string" || data.length === 0) {
            res.status(400).json({ error: "Document data (base64) is required" });
            return;
        }
        const id = (0, node_crypto_1.randomUUID)();
        const key = (0, s3_1.documentKey)(dbUser.id, type, String(fileName || "document"), id);
        const uploaded = await (0, s3_1.uploadToS3)(key, data, String(mimeType || "application/octet-stream"));
        const rows = await (0, database_1.query)(`INSERT INTO driver_documents
         (id, driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, size_bytes, status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review', $9)
       RETURNING id, doc_type, file_name, mime_type, status, note, created_at`, [
            id,
            dbUser.id,
            type,
            String(fileName || "document"),
            String(mimeType || "application/octet-stream"),
            uploaded.key,
            uploaded.bucket,
            uploaded.size,
            typeof note === "string" && note ? note : null,
        ]);
        const doc = rows[0];
        res.status(201).json({
            document: {
                ...doc,
                viewUrl: await (0, s3_1.getPresignedViewUrl)(uploaded.key),
            },
        });
        // ── Persist the document name on the driver profile (best-effort).
        // Without this, the "progress bar" in the driver app (which reads
        // user.licenseDocumentName / idDocumentName / carscan_report_name) stays at
        // 0% and the doc appears to vanish after the driver leaves the screen.
        const dbName = String(fileName || "document").slice(0, 255);
        try {
            if (type === "drivers_license") {
                await (0, database_1.query)("UPDATE users SET license_document_name = $2 WHERE id = $1", [dbUser.id, dbName]);
            }
            else if (type === "id_document") {
                await (0, database_1.query)("UPDATE users SET id_document_name = $2 WHERE id = $1", [dbUser.id, dbName]);
            }
            else if (type === "carscan_report") {
                const upsert = await (0, database_1.query)("UPDATE driver_profiles SET carscan_report_name = $2 WHERE user_id = $1 RETURNING id", [dbUser.id, dbName]);
                if (upsert.length === 0) {
                    await (0, database_1.query)("INSERT INTO driver_profiles (user_id, carscan_report_name) VALUES ($1, $2)", [dbUser.id, dbName]);
                }
            }
        }
        catch (err) {
            console.error("Profile doc-name update failed (non-fatal):", err?.message || err);
        }
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Upload failed" });
    }
});
// GET /api/documents/mine — the driver's own documents, newest first
router.get("/mine", roleGuard(["driver", "admin"]), async (req, res) => {
    try {
        const dbUser = req.dbUser;
        const rows = await (0, database_1.query)(`SELECT id, driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket,
              size_bytes, status, note, reviewed_at, created_at
         FROM driver_documents WHERE driver_id = $1
        ORDER BY created_at DESC
        LIMIT 50`, [dbUser.id]);
        res.json({ documents: rows.map((d) => ({ ...d })) });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Failed to list documents" });
    }
});
// GET /api/documents — admin lists ALL drivers' documents
router.get("/", roleGuard(["admin"]), async (req, res) => {
    try {
        const rows = await (0, database_1.query)(`SELECT d.id, d.driver_id, d.doc_type, d.file_name, d.mime_type, d.s3_key,
              d.s3_bucket, d.size_bytes, d.status, d.note, d.reviewed_at, d.created_at,
              u.full_name AS driver_name, u.email AS driver_email
         FROM driver_documents d
         JOIN users u ON u.id = d.driver_id
        ORDER BY d.created_at DESC
        LIMIT 200`);
        res.json({ documents: rows });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Failed to list documents" });
    }
});
// GET /api/documents/:id/url — owner or admin gets a 15-min presigned view URL
router.get("/:id/url", roleGuard(["driver", "admin"]), async (req, res) => {
    try {
        const dbUser = req.dbUser;
        const doc = await loadDoc(String(req.params.id));
        if (!doc) {
            res.status(404).json({ error: "Document not found" });
            return;
        }
        if (doc.driver_id !== dbUser.id && dbUser.role !== "admin") {
            res.status(403).json({ error: "Insufficient permissions" });
            return;
        }
        res.json({ viewUrl: await (0, s3_1.getPresignedViewUrl)(doc.s3_key) });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Failed to build view URL" });
    }
});
// PATCH /api/documents/:id/status — admin approves/rejects a document
router.patch("/:id/status", roleGuard(["admin"]), async (req, res) => {
    try {
        const { status, note } = req.body || {};
        if (!["pending_review", "approved", "rejected"].includes(String(status || ""))) {
            res.status(400).json({ error: "status must be one of: pending_review, approved, rejected" });
            return;
        }
        const rows = await (0, database_1.query)(`UPDATE driver_documents
          SET status = $2, note = COALESCE($3, note), reviewed_at = NOW()
        WHERE id = $1
        RETURNING id, driver_id, doc_type, file_name, mime_type, status, note, reviewed_at, created_at`, [req.params.id, String(status), typeof note === "string" && note ? note : null]);
        if (!rows[0]) {
            res.status(404).json({ error: "Document not found" });
            return;
        }
        res.json({ document: rows[0] });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Failed to update document" });
    }
});
// DELETE /api/documents/:id — owner or admin removes a document (S3 + row)
router.delete("/:id", roleGuard(["driver", "admin"]), async (req, res) => {
    try {
        const dbUser = req.dbUser;
        const doc = await loadDoc(String(req.params.id));
        if (!doc) {
            res.status(404).json({ error: "Document not found" });
            return;
        }
        if (doc.driver_id !== dbUser.id && dbUser.role !== "admin") {
            res.status(403).json({ error: "Insufficient permissions" });
            return;
        }
        try {
            await (0, s3_1.deleteFromS3)(doc.s3_key);
        }
        catch (e) {
            console.error("S3 delete failed (continuing):", e);
        }
        await (0, database_1.query)("DELETE FROM driver_documents WHERE id = $1", [doc.id]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Failed to delete document" });
    }
});
exports.default = router;
//# sourceMappingURL=documents.js.map