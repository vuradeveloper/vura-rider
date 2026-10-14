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
import { execute, query, queryOne } from "../config/database";
import { getObjectFromS3 } from "../lib/s3";

// Ported CJS checkers — plain require keeps them identical to upstream.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { analyze } = require("../../verification/analyzers");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeIssues, finalize } = require("../../verification/lib/decide");

export type OcrFn = (bytes: Buffer, mime: string) => Promise<{ text: string; confidence: number } | null>;

/** OCR with Gemini (their existing GEMINI_API_KEY — NOT an AWS cost). */
function geminiOcr(): OcrFn | null {
  const key = process.env.GEMINI_API_KEY || "";
  if (!key) return null;
  const model = process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
  // Hard timeout: a hung request can never wedge the upload worker.
  const timeoutMs = Math.min(Number(process.env.OCR_TIMEOUT_MS) || 30_000, 60_000);
  return async (bytes, mime) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    "Extract ALL visible text from this document exactly as printed (ID numbers, dates, VINs, names). " +
                    "Output only the raw text with no commentary.",
                },
                { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini OCR HTTP ${res.status}`); // status ONLY — never the body
    const json: any = await res.json();
    const raw = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("\n");
    return { text: sanitizeOcrText(raw), confidence: 80 };
  };
}

/** The active OCR provider, or null when verification is off. */
export function currentOcr(): OcrFn | null {
  const mode = (process.env.DOC_VERIFY || "off").trim().toLowerCase();
  if (mode === "gemini") return geminiOcr();
  return null; // off — and "textract" is intentionally not wired yet
}

const MAX_OCR_CHARS = 20_000;

/**
 * The model's output is UNTRUSTED DATA: it is document-derived text, not
 * instructions. We strip control characters and cap the length; the analyzers
 * only run regex/marker matching over it, and every driver/staff-facing
 * message is OUR OWN string (never model text), so prompt injection inside a
 * document cannot influence decisions or UI.
 */
export function sanitizeOcrText(raw: string): string {
  return String(raw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // control chars; keeps \n \t
    .slice(0, MAX_OCR_CHARS);
}

/**
 * Driver-facing note for a hard reject. Deliberately GENERIC: exact check
 * details (checksum failures, similarity scores, which field mismatched) stay
 * in auto_reasons, which ONLY the staff console shows — a driver must not be
 * able to learn how to fake the checks from the rejection message.
 */
export function driverNoteFor(status: string, reasons: string[]): string {
  if (status !== "rejected") return "";
  const joined = reasons.join(" ");
  if (/expired/i.test(joined)) return "This document has expired. Upload a valid, unexpired copy.";
  if (/doesn't look like|correct document/i.test(joined))
    return "This doesn't look like the right document type. Upload the correct document.";
  if (/couldn't read|valid ID number|any text/i.test(joined))
    return "We couldn't read this document. Retake it in good light, uncropped, with no glare.";
  if (/doesn't match/i.test(joined))
    return "The details on this document don't match your other documents. Check you uploaded the right files.";
  return "This document didn't pass our automatic checks. Re-upload it, or contact support if you believe this is a mistake.";
}

const envNum = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** OCR budget: per driver and per document type, per calendar day. */
export async function rateLimited(driverId: string, docType: string): Promise<boolean> {
  const maxDriver = envNum(process.env.OCR_MAX_PER_DRIVER_DAY, 10);
  const maxType = envNum(process.env.OCR_MAX_PER_TYPE_DAY, 3);
  const row = await queryOne<any>(
    `SELECT COUNT(*) FILTER (WHERE verified_at >= NOW()::date) AS today,
            COUNT(*) FILTER (WHERE doc_type = $2 AND verified_at >= NOW()::date) AS typeday
       FROM driver_documents
      WHERE driver_id = $1`,
    [driverId, docType]
  );
  return Number(row?.today || 0) >= maxDriver || Number(row?.typeday || 0) >= maxType;
}

/**
 * Global hard spend cap: automatic reads per calendar day across ALL drivers
 * (env DOC_READS_PER_DAY, default 100; 0 disables automatic reads entirely).
 * Works regardless of the per-driver limits — the cost ceiling is absolute.
 */
export async function globalCapReached(): Promise<boolean> {
  const v = process.env.DOC_READS_PER_DAY;
  const cap = v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 100;
  const row = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM driver_documents WHERE verified_at >= NOW()::date`);
  return Number(row?.n || 0) >= cap;
}

type Verdict = { status: string; reasons: string[] };

async function writeVerdict(
  doc: { id: string },
  v: { autoStatus: string; reasons: string[]; extracted: Record<string, unknown>; confidence: number | null }
): Promise<Verdict> {
  // Staff always makes the final call on a pass; only a hard reject moves the
  // row (driver sees status + note and re-uploads through the existing flow).
  const reject = v.autoStatus === "rejected";
  await execute(
    `UPDATE driver_documents
        SET auto_status = $2,
            auto_reasons = $3::jsonb,
            extracted = $4::jsonb,
            ocr_confidence = $5,
            verified_at = NOW(),
            status = CASE WHEN $6 THEN 'rejected'::varchar ELSE status END,
            note = CASE WHEN $6 THEN $7::varchar ELSE note END
      WHERE id = $1`,
    [
      doc.id,
      v.autoStatus,
      JSON.stringify(v.reasons),
      JSON.stringify(v.extracted),
      v.confidence,
      reject,
      reject ? driverNoteFor(v.autoStatus, v.reasons) : null,
    ]
  );
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
export async function verifyDocument(docId: string, ocrOverride?: OcrFn): Promise<Verdict | null> {
  const ocr = ocrOverride ?? currentOcr();
  if (!ocr) return null; // verification off → zero behaviour change
  try {
    const doc = await queryOne<any>(
      `SELECT d.id, d.driver_id, d.doc_type, d.mime_type, d.s3_key, d.verified_at, u.full_name
         FROM driver_documents d
         JOIN users u ON u.id = d.driver_id
        WHERE d.id = $1`,
      [docId]
    );
    if (!doc || !doc.s3_key) return null;

    // Never OCR the same file row twice (re-uploads create NEW rows anyway).
    if (doc.verified_at) return null;

    // Global daily spend cap across ALL drivers — absolute ceiling, checked
    // before any per-driver logic or provider call.
    if (await globalCapReached()) {
      console.log("[docVerification]", { docId, docType: doc.doc_type, verdict: "skipped_daily_cap" });
      return { status: "skipped_daily_cap", reasons: [] };
    }

    // OCR budget: per driver + per document type per calendar day. Over the
    // limit the document simply STAYS pending for staff — no model call, and
    // never a rejection. (Return value carries the clear reason.)
    if (await rateLimited(doc.driver_id, doc.doc_type)) {
      console.log("[docVerification]", { docId, docType: doc.doc_type, verdict: "skipped_rate_limit" });
      return { status: "skipped_rate_limit", reasons: [] };
    }

    const bytes = await getObjectFromS3(doc.s3_key);
    // Size cap: oversized files are never sent to the model. (Page count for
    // PDFs is bounded by this cap; a true page count would need a PDF parser.)
    const maxBytes = envNum(process.env.MAX_OCR_MB, 4) * 1024 * 1024;
    if (bytes.length > maxBytes) {
      return writeVerdict(doc, {
        autoStatus: "needs_review",
        reasons: ["This file is too large for automatic checks. Staff will review it."],
        extracted: { sizeBytes: bytes.length },
        confidence: null,
      });
    }

    let out: { text: string; confidence: number } | null = null;
    try {
      out = await ocr(bytes, doc.mime_type || "application/octet-stream");
    } catch (err: any) {
      // Provider error / timeout / unparseable response: the document STAYS
      // pending for staff — it is NEVER rejected, and the upload (already
      // finished) is unaffected. Log fields only, never document content.
      console.log("[docVerification]", {
        docId,
        docType: doc.doc_type,
        verdict: "ocr_failed",
        error: String(err?.message || err).slice(0, 120),
      });
      return null;
    }
    if (!out || out.text.replace(/\s/g, "").length < 40) {
      // Nothing readable — "can't check", NOT a hard reject (per policy: only
      // clear reasons — wrong type / expired — may reject).
      return writeVerdict(doc, {
        autoStatus: "needs_review",
        reasons: ["We couldn't check this document automatically. Staff will review it."],
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
    // Log discipline: document id, type and verdict ONLY — never OCR text,
    // extracted fields or reason details.
    console.log("[docVerification]", { docId, docType: doc.doc_type, verdict: verdict.status });

    await recheckDriver(doc.driver_id).catch((e: any) =>
      console.error("[docVerification] cross-check failed:", e?.message || e)
    );
    return verdict;
  } catch (err: any) {
    // Outer catch: anything unexpected leaves the document exactly as before.
    console.error("[docVerification] verify failed:", {
      docId,
      error: String(err?.message || err).slice(0, 120),
    });
    return null;
  }
}

/**
 * Re-applies the cross-document checks for one driver: ID numbers on the
 * licence/PrDP/clearance must match the ID Document, VINs on the reports must
 * match the licence disc. Idempotent — previous issue messages are recovered
 * from extracted.crossIssues before the fresh ones are merged in.
 */
export async function recheckDriver(driverId: string): Promise<void> {
  const rows = await query<any>(
    `SELECT id, doc_type, status, auto_status, auto_reasons, extracted
       FROM driver_documents WHERE driver_id = $1`,
    [driverId]
  );
  const docs: Record<string, any> = {};
  for (const r of rows) {
    docs[r.doc_type] = {
      autoStatus: r.auto_status,
      autoReasons: r.auto_reasons || [],
      extracted: r.extracted || {},
      status: r.status,
    };
  }
  const issues = computeIssues(docs, null) as Record<string, { status: string; msg: string }[]>;
  for (const [type, list] of Object.entries(issues)) {
    const row = rows.find((r: any) => r.doc_type === type);
    if (!row || !row.auto_status) continue;
    const prevIssues: string[] = ((row.extracted && (row.extracted as any).crossIssues) || []).map((i: any) => i.msg);
    const analyzerOnly = (row.auto_reasons || []).filter((m: string) => !prevIssues.includes(m));
    const fin = finalize(type, { autoStatus: row.auto_status, autoReasons: analyzerOnly }, list) as Verdict;
    const reject = fin.status === "rejected";
    await execute(
      `UPDATE driver_documents
          SET auto_status = $2,
              auto_reasons = $3::jsonb,
              extracted = jsonb_set(COALESCE(extracted, '{}'::jsonb), '{crossIssues}', $4::jsonb),
              verified_at = NOW(),
              status = CASE WHEN $5 THEN 'rejected'::varchar ELSE status END,
              note = CASE WHEN $5 THEN $6::varchar ELSE note END
        WHERE id = $1`,
      [
        row.id,
        fin.status,
        JSON.stringify(fin.reasons),
        JSON.stringify(list),
        reject,
        reject ? driverNoteFor(fin.status, fin.reasons) : null,
      ]
    );
  }
}