export declare function normalisePhone(raw: unknown): string;
export declare function normaliseIdNumber(raw: unknown): string;
export declare function normaliseEmail(raw: unknown): {
    full: string;
    local: string;
    domain: string;
    key: string;
};
/** Classic Levenshtein distance, capped for short strings. */
export declare function levenshtein(a: string, b: string): number;
/**
 * 90 exact address, 85 alias-equivalent, 70 one-character typo in the local
 * part, 0 otherwise. Domain must match for every level below exact.
 */
export declare function emailSimilarity(a: unknown, b: unknown): number;
/** Never expose a full address in a signup response or an admin list. */
export declare function maskEmail(raw: unknown): string;
/** A phone shown to an admin or in a signup conflict: 082 *** 4567. */
export declare function maskPhone(raw: unknown): string;
//# sourceMappingURL=identity.d.ts.map