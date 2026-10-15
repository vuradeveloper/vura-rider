// ─────────────────────────────────────────────────────────────────────────────
// adminDocReview — ADMIN V2 Phase 8: per-document verification with the
// ALL-DOCUMENTS-COMPLETE push.
//
// One review path for both the legacy /api/documents/:id/status route and the
// v2 console endpoints: approving the LAST outstanding required document
// pushes the driver "all documents verified" — approving one of several does
// NOT (the brief: notify when ALL are done, not only one).
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute } from "../config/database";
import { sendPushToUsers } from "./notify";

/** Static fallback; the live list is the active admin_required_docs (settings). */
export const REQUIRED_DOC_TYPES = [
  "id_document",
  "drivers_license",
  "prdp",
  "criminal_record",
  "carscan_report",
];

async function requiredTypes(): Promise<string[]> {
  try {
    const rows = await query<{ doc_type: string }>(
      `SELECT doc_type FROM admin_required_docs WHERE active = TRUE`
    );
    if (rows.length) return rows.map((r) => r.doc_type);
  } catch {
    /* settings table missing (pre-005) — static list it is */
  }
  return REQUIRED_DOC_TYPES;
}

/**
 * Which required documents a driver is still missing — the DRIVER APP's gate.
 *
 * A brand-new driver whose list is not fully approved opens on the documents &
 * vehicle screen ONLY; a fully approved driver goes straight to driver home.
 * Same source as allRequiredApproved: the active admin_required_docs settings,
 * with REQUIRED_DOC_TYPES as the pre-005 fallback (requiredTypes()).
 */
export async function requiredDocsStatus(driverId: string): Promise<{
  approved: boolean;
  missing: string[];
  required: string[];
}> {
  const required = await requiredTypes();
  const approved = await query<{ doc_type: string }>(
    `SELECT DISTINCT doc_type FROM driver_documents WHERE driver_id = $1 AND status = 'approved'`,
    [driverId]
  );
  const have = new Set(approved.map((r) => r.doc_type));
  const missing = required.filter((t) => !have.has(t));
  return { approved: missing.length === 0, missing, required };
}

/** True when the driver has EVERY active required document approved. */
export async function allRequiredApproved(driverId: string): Promise<boolean> {
  const types = await requiredTypes();
  const approved = await query<{ doc_type: string }>(
    `SELECT DISTINCT doc_type FROM driver_documents WHERE driver_id = $1 AND status = 'approved'`,
    [driverId]
  );
  const set = new Set(approved.map((r) => r.doc_type));
  return types.every((t) => set.has(t));
}

/**
 * Review ONE document. Returns null when the document does not exist.
 * When an approval COMPLETES the driver's set (was incomplete → now
 * complete), the driver gets the single "all verified" push.
 */
export async function reviewDocument(
  id: string,
  status: "approved" | "rejected" | "pending_review",
  note: string | null,
  actorLabel: string
): Promise<{ document: any; allApproved: boolean } | null> {
  const before = await queryOne<{ driver_id: string }>(
    `SELECT driver_id FROM driver_documents WHERE id = $1`,
    [id]
  );
  if (!before) return null;
  const wasComplete = await allRequiredApproved(before.driver_id);

  const rows = await query<any>(
    `UPDATE driver_documents
        SET status = $2, note = COALESCE($3, note), reviewed_at = NOW()
      WHERE id = $1
      RETURNING id, driver_id, doc_type, file_name, status, note, reviewed_at, created_at`,
    [id, status, note]
  );
  let allApproved = await allRequiredApproved(before.driver_id);

  if (status === "approved" && allApproved && !wasComplete) {
    await sendPushToUsers([before.driver_id], {
      type: "documents_verified",
      title: "All documents verified ✅",
      body: "Every required document has been approved — you're fully verified. Nothing else to do.",
      highPriority: true,
    }).catch(() => null);
  } else if (status === "rejected") {
    await sendPushToUsers([before.driver_id], {
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
