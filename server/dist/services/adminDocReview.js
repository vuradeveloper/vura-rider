"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_DOC_TYPES = void 0;
exports.allRequiredApproved = allRequiredApproved;
exports.reviewDocument = reviewDocument;
// ─────────────────────────────────────────────────────────────────────────────
// adminDocReview — ADMIN V2 Phase 8: per-document verification with the
// ALL-DOCUMENTS-COMPLETE push.
//
// One review path for both the legacy /api/documents/:id/status route and the
// v2 console endpoints: approving the LAST outstanding required document
// pushes the driver "all documents verified" — approving one of several does
// NOT (the brief: notify when ALL are done, not only one).
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const notify_1 = require("./notify");
/** Static fallback; the live list is the active admin_required_docs (settings). */
exports.REQUIRED_DOC_TYPES = [
    "id_document",
    "drivers_license",
    "prdp",
    "criminal_record",
    "carscan_report",
];
async function requiredTypes() {
    try {
        const rows = await (0, database_1.query)(`SELECT doc_type FROM admin_required_docs WHERE active = TRUE`);
        if (rows.length)
            return rows.map((r) => r.doc_type);
    }
    catch {
        /* settings table missing (pre-005) — static list it is */
    }
    return exports.REQUIRED_DOC_TYPES;
}
/** True when the driver has EVERY active required document approved. */
async function allRequiredApproved(driverId) {
    const types = await requiredTypes();
    const approved = await (0, database_1.query)(`SELECT DISTINCT doc_type FROM driver_documents WHERE driver_id = $1 AND status = 'approved'`, [driverId]);
    const set = new Set(approved.map((r) => r.doc_type));
    return types.every((t) => set.has(t));
}
/**
 * Review ONE document. Returns null when the document does not exist.
 * When an approval COMPLETES the driver's set (was incomplete → now
 * complete), the driver gets the single "all verified" push.
 */
async function reviewDocument(id, status, note, actorLabel) {
    const before = await (0, database_1.queryOne)(`SELECT driver_id FROM driver_documents WHERE id = $1`, [id]);
    if (!before)
        return null;
    const wasComplete = await allRequiredApproved(before.driver_id);
    const rows = await (0, database_1.query)(`UPDATE driver_documents
        SET status = $2, note = COALESCE($3, note), reviewed_at = NOW()
      WHERE id = $1
      RETURNING id, driver_id, doc_type, file_name, status, note, reviewed_at, created_at`, [id, status, note]);
    let allApproved = await allRequiredApproved(before.driver_id);
    if (status === "approved" && allApproved && !wasComplete) {
        await (0, notify_1.sendPushToUsers)([before.driver_id], {
            type: "documents_verified",
            title: "All documents verified ✅",
            body: "Every required document has been approved — you're fully verified. Nothing else to do.",
            highPriority: true,
        }).catch(() => null);
    }
    else if (status === "rejected") {
        await (0, notify_1.sendPushToUsers)([before.driver_id], {
            type: "document_rejected",
            title: "A document needs re-upload",
            body: `${note || "One of your documents was rejected."} Re-upload it in the driver app.`,
            highPriority: true,
        }).catch(() => null);
        allApproved = false;
    }
    void actorLabel; // callers audit; this param documents the review chain
    return { document: rows[0], allApproved };
}
//# sourceMappingURL=adminDocReview.js.map