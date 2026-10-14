export type OcrFn = (bytes: Buffer, mime: string) => Promise<{
    text: string;
    confidence: number;
} | null>;
/** The active OCR provider, or null when verification is off. */
export declare function currentOcr(): OcrFn | null;
/**
 * The model's output is UNTRUSTED DATA: it is document-derived text, not
 * instructions. We strip control characters and cap the length; the analyzers
 * only run regex/marker matching over it, and every driver/staff-facing
 * message is OUR OWN string (never model text), so prompt injection inside a
 * document cannot influence decisions or UI.
 */
export declare function sanitizeOcrText(raw: string): string;
/**
 * Driver-facing note for a hard reject. Deliberately GENERIC: exact check
 * details (checksum failures, similarity scores, which field mismatched) stay
 * in auto_reasons, which ONLY the staff console shows — a driver must not be
 * able to learn how to fake the checks from the rejection message.
 */
export declare function driverNoteFor(status: string, reasons: string[]): string;
/** OCR budget: per driver and per document type, per calendar day. */
export declare function rateLimited(driverId: string, docType: string): Promise<boolean>;
/**
 * Global hard spend cap: automatic reads per calendar day across ALL drivers
 * (env DOC_READS_PER_DAY, default 100; 0 disables automatic reads entirely).
 * Works regardless of the per-driver limits — the cost ceiling is absolute.
 */
export declare function globalCapReached(): Promise<boolean>;
type Verdict = {
    status: string;
    reasons: string[];
};
/**
 * Runs the automatic checks for ONE document (OCR → analyzers → verdict) and
 * then cross-checks this driver's other documents (ID numbers vs the ID doc,
 * VINs vs the disc — free, local, no API calls).
 *
 * Pass `ocrOverride` in tests. Returns null when verification is off or the
 * check could not run — the document is then untouched.
 */
export declare function verifyDocument(docId: string, ocrOverride?: OcrFn): Promise<Verdict | null>;
/**
 * Re-applies the cross-document checks for one driver: ID numbers on the
 * licence/PrDP/clearance must match the ID Document, VINs on the reports must
 * match the licence disc. Idempotent — previous issue messages are recovered
 * from extracted.crossIssues before the fresh ones are merged in.
 */
export declare function recheckDriver(driverId: string): Promise<void>;
export {};
//# sourceMappingURL=docVerification.d.ts.map