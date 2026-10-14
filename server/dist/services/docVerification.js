"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentOcr = currentOcr;
exports.verifyDocument = verifyDocument;
exports.recheckDriver = recheckDriver;
// ─────────────────────────────────────────────────────────────────────────────
// docVerification — automatic document checks: the ridevura-verification
// logic ported INTO this server (no second AWS stack, no Firestore, no
// second bucket). The pure checkers live in server/verification/ as plain
// CJS, kept byte-faithful with the upstream project so its tests hold.
//
//   DOC_VERIFY=off      (default) nothing runs — staff flow unchanged
//   DOC_VERIFY=gemini   OCR with GEMINI_API_KEY (one vision call per doc)
//   DOC_VERIFY=textract NOT wired on purpose (needs @aws-sdk/client-textract)
//
// Rules the port enforces:
//   * "approved" NEVER flips the row to approved — staff must click
//     (decide.js finalize() also forces this: AUTO_APPROVE_TYPES defaults to none)
//   * "rejected" flips the row and writes the first reason as the driver-facing
//     note — both apps already display status + note, so drivers instantly see
//     WHY and re-upload. No APK rebuild needed for that.
//   * Everything is fire-and-forget from the upload route: a failure logs and
//     leaves the document exactly as it was before.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const s3_1 = require("../lib/s3");
// Ported CJS checkers — plain require keeps them identical to upstream.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { analyze } = require("../../verification/analyzers");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeIssues, finalize } = require("../../verification/lib/decide");
/** OCR with Gemini (their existing GEMINI_API_KEY — NOT an AWS cost). */
function geminiOcr() {
    const key = process.env.GEMINI_API_KEY || "";
    if (!key)
        return null;
    const model = process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
    return async (bytes, mime) => {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: "Extract ALL visible text from this document exactly as printed (ID numbers, dates, VINs, names). " +
                                    "Output only the raw text with no commentary.",
                            },
                            { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
                        ],
                    },
                ],
                generationConfig: { temperature: 0 },
            }),
        });
        if (!res.ok)
            throw new Error(`Gemini OCR HTTP ${res.status}`);
        const json = await res.json();
        const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
        return { text, confidence: 80 };
    };
}
/** The active OCR provider, or null when verification is off. */
function currentOcr() {
    const mode = (process.env.DOC_VERIFY || "off").trim().toLowerCase();
    if (mode === "gemini")
        return geminiOcr();
    return null; // off — and "textract" is intentionally not wired yet
}
async function writeVerdict(doc, v) {
    // Staff always makes the final call on a pass; only a hard reject moves the
    // row (driver sees status + note and re-uploads through the existing flow).
    const reject = v.autoStatus === "rejected";
    await (0, database_1.execute)(`UPDATE driver_documents
        SET auto_status = $2,
            auto_reasons = $3::jsonb,
            extracted = $4::jsonb,
            ocr_confidence = $5,
            verified_at = NOW(),
            status = CASE WHEN $6 THEN 'rejected'::varchar ELSE status END,
            note = CASE WHEN $6 THEN $7::varchar ELSE note END
      WHERE id = $1`, [
        doc.id,
        v.autoStatus,
        JSON.stringify(v.reasons),
        JSON.stringify(v.extracted),
        v.confidence,
        reject,
        reject ? v.reasons[0] || "Rejected by automatic checks." : null,
    ]);
    return { status: v.autoStatus, reasons: v.reasons };
}
/**
 * Runs the automatic checks for ONE document (OCR → analyzers → verdict) and
 * then cross-checks this driver's other documents (ID numbers vs the ID doc,
 * VINs vs the disc — free, local, no API calls).
 *
 * Pass `ocrOverride` in tests. Returns null when verification is off or the
 * check could not run — the document is then untouched.
 */
async function verifyDocument(docId, ocrOverride) {
    const ocr = ocrOverride ?? currentOcr();
    if (!ocr)
        return null; // verification off → zero behaviour change
    try {
        const doc = await (0, database_1.queryOne)(`SELECT d.id, d.driver_id, d.doc_type, d.mime_type, d.s3_key, u.full_name
         FROM driver_documents d
         JOIN users u ON u.id = d.driver_id
        WHERE d.id = $1`, [docId]);
        if (!doc || !doc.s3_key)
            return null;
        const bytes = await (0, s3_1.getObjectFromS3)(doc.s3_key);
        const out = await ocr(bytes, doc.mime_type || "application/octet-stream");
        if (!out || out.text.replace(/\s/g, "").length < 40) {
            return writeVerdict(doc, {
                autoStatus: "rejected",
                reasons: ["We couldn't read any text in this file. Upload a clear, well-lit copy."],
                extracted: {},
                confidence: out ? out.confidence ?? null : null,
            });
        }
        const result = analyze(doc.doc_type, { text: out.text, profileName: doc.full_name || null });
        const verdict = await writeVerdict(doc, {
            autoStatus: result.status,
            reasons: result.reasons || [],
            extracted: result.extracted || {},
            confidence: out.confidence ?? null,
        });
        await recheckDriver(doc.driver_id).catch((e) => console.error("[docVerification] cross-check failed:", e?.message || e));
        return verdict;
    }
    catch (err) {
        console.error("[docVerification] verify failed for", docId, err?.message || err);
        return null; // NEVER break the upload flow
    }
}
/**
 * Re-applies the cross-document checks for one driver: ID numbers on the
 * licence/PrDP/clearance must match the ID Document, VINs on the reports must
 * match the licence disc. Idempotent — previous issue messages are recovered
 * from extracted.crossIssues before the fresh ones are merged in.
 */
async function recheckDriver(driverId) {
    const rows = await (0, database_1.query)(`SELECT id, doc_type, status, auto_status, auto_reasons, extracted
       FROM driver_documents WHERE driver_id = $1`, [driverId]);
    const docs = {};
    for (const r of rows) {
        docs[r.doc_type] = {
            autoStatus: r.auto_status,
            autoReasons: r.auto_reasons || [],
            extracted: r.extracted || {},
            status: r.status,
        };
    }
    const issues = computeIssues(docs, null);
    for (const [type, list] of Object.entries(issues)) {
        const row = rows.find((r) => r.doc_type === type);
        if (!row || !row.auto_status)
            continue;
        const prevIssues = ((row.extracted && row.extracted.crossIssues) || []).map((i) => i.msg);
        const analyzerOnly = (row.auto_reasons || []).filter((m) => !prevIssues.includes(m));
        const fin = finalize(type, { autoStatus: row.auto_status, autoReasons: analyzerOnly }, list);
        const reject = fin.status === "rejected";
        await (0, database_1.execute)(`UPDATE driver_documents
          SET auto_status = $2,
              auto_reasons = $3::jsonb,
              extracted = jsonb_set(COALESCE(extracted, '{}'::jsonb), '{crossIssues}', $4::jsonb),
              verified_at = NOW(),
              status = CASE WHEN $5 THEN 'rejected'::varchar ELSE status END,
              note = CASE WHEN $5 THEN $6::varchar ELSE note END
        WHERE id = $1`, [
            row.id,
            fin.status,
            JSON.stringify(fin.reasons),
            JSON.stringify(list),
            reject,
            reject ? fin.reasons[0] || "Rejected by automatic checks." : null,
        ]);
    }
}
//# sourceMappingURL=docVerification.js.map