/**
 * Upload boundary for driver/rider documents. Kept dependency-free so the
 * allow-list and magic-byte check can be unit-tested without booting Express,
 * S3 or Postgres.
 */
export declare const DOC_MAX_BYTES: number;
export declare const DOC_MIME_ALLOWED: Set<string>;
export type DocumentCheck = {
    ok: true;
    mime: string;
    sizeBytes: number;
} | {
    ok: false;
    status: 400 | 413 | 415;
    error: string;
};
export declare function cleanMime(value: unknown): string;
export declare function base64Payload(data: string): string;
export declare function sniffDocumentMime(base64: string): string | null;
export declare function validateDocumentUpload(data: unknown, declaredMime: unknown): DocumentCheck;
//# sourceMappingURL=uploadGuard.d.ts.map