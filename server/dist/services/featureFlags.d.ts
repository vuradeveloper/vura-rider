export type FeatureKey = "matching" | "destination" | "performance_tier";
export declare const FEATURE_KEYS: FeatureKey[];
export declare class FeatureFlagError extends Error {
    code: "validation" | "no_row" | "not_found";
    constructor(code: FeatureFlagError["code"], message: string);
}
/** Validate one field against SETTABLE; throws FeatureFlagError on anything unexpected. */
export declare function validateField(key: FeatureKey, field: string, value: unknown): unknown;
/** Full operator view: all three flags/allowlists + last rides + server build. */
export declare function readFeatures(): Promise<Record<string, unknown>>;
/** Validate + apply one flag update. Validated keys only — never a money column. */
export declare function updateFeature(key: unknown, changes: unknown, actor: string): Promise<Record<string, unknown>>;
export interface EnableInput {
    driverIds?: string[];
    riderIds?: string[];
    driverEmails?: string[];
    driverPhones?: string[];
    riderEmails?: string[];
    riderPhones?: string[];
    /** Subset of the three keys; default = all three. */
    features?: string[];
}
/**
 * One call: turn the three features ON for the given test accounts.
 * matching  → enabled; rider ids ⇒ rollout 'allowlist' (those riders), no
 *             rider ids ⇒ rollout 'all' (fastest path for one test phone).
 * destination / performance_tier → enabled + driver ids merged into allowlists.
 * Returns the exact JSON that now reads back from GET /features.
 */
export declare function enableForAccounts(input: EnableInput, actor: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=featureFlags.d.ts.map