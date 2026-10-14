export type OcrFn = (bytes: Buffer, mime: string) => Promise<{
    text: string;
    confidence: number;
} | null>;
/** The active OCR provider, or null when verification is off. */
export declare function currentOcr(): OcrFn | null;
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