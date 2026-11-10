export type FeatureKey = "matching" | "destination" | "performance_tier";
export declare const FEATURE_KEYS: FeatureKey[];
/**
 * The two service-wide kill switches. These are NOT rollout flags: they stop
 * new rider bookings / driver offers immediately and are shown by the apps as
 * a maintenance screen. They do not remove anything from Google Play.
 */
export type MaintenanceKey = "rider_maintenance" | "driver_maintenance";
export declare const MAINTENANCE_KEYS: MaintenanceKey[];
export type AnyFeatureKey = FeatureKey | MaintenanceKey;
export declare class FeatureFlagError extends Error {
    code: "validation" | "no_row" | "not_found";
    constructor(code: FeatureFlagError["code"], message: string);
}
/** Validate one field against SETTABLE; throws FeatureFlagError on anything unexpected. */
export declare function validateField(key: AnyFeatureKey, field: string, value: unknown): unknown;
/** Full operator view: all three flags/allowlists + last rides + server build. */
export declare function readFeatures(): Promise<Record<string, unknown>>;
export interface MaintenanceSide {
    enabled: boolean;
    message: string;
    /** Tokens with auth_time older than this are rejected (a real backend logout). */
    revokeBefore: string | null;
}
export interface MaintenanceStatus {
    rider: MaintenanceSide;
    driver: MaintenanceSide;
}
export declare function invalidateMaintenanceCache(): void;
/** Current rider/driver maintenance state (5 s cache). Never throws. */
export declare function readMaintenanceStatus(force?: boolean): Promise<MaintenanceStatus>;
/**
 * Close one app AND log every existing session out. The `revoke_before`
 * timestamp is what makes this a real backend logout: requireAuth rejects any
 * token whose Firebase `auth_time` predates it, even after the app is turned
 * back on. A refreshed token keeps the original auth_time, so the user must
 * actually sign in again.
 */
export declare function lockMaintenance(side: "rider" | "driver", message: string, actor: string): Promise<Record<string, unknown>>;
/** Turn the app back on. Old sessions stay logged out until they sign in again. */
export declare function unlockMaintenance(side: "rider" | "driver", actor: string): Promise<Record<string, unknown>>;
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
 * ONE call: turn all three features OFF for everyone — the exact inverse of
 * enableForAccounts. Restores the seed posture: matching kill switch off +
 * mode 'off'; destination/tier kill switches off + modes back to 'allowlist'.
 * Recorded allowlists are left alone: with the switches off they cover
 * nobody, and keeping them makes re-enabling the same test accounts one call.
 * Like everything in this service, it can never touch a money column.
 */
export declare function disableAllFeatures(actor: string): Promise<Record<string, unknown>>;
/**
 * One call: turn the three features ON for the given test accounts — or, with
 * no account ids at all, FOR EVERYONE:
 * matching  → enabled; rider ids ⇒ rollout 'allowlist' (those riders), no
 *             rider ids ⇒ rollout 'all' (H3 for every rider).
 * destination / performance_tier → enabled; driver ids ⇒ mode 'allowlist'
 *             with the ids merged in, no driver ids ⇒ mode 'all' (every
 *             driver). Returns the exact JSON that GET /features reads back.
 */
export declare function enableForAccounts(input: EnableInput, actor: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=featureFlags.d.ts.map