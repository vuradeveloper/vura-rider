export declare const LIFECYCLE_STATES: readonly ["REGISTERED", "DOCUMENTS_SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "ACTIVE", "REJECTED", "SUSPENDED", "BLOCKED"];
export type LifecycleStatus = (typeof LIFECYCLE_STATES)[number];
export declare function isLifecycleStatus(v: unknown): v is LifecycleStatus;
/** Legal transitions. Anything not listed here is a 409, server-side. */
export declare const LEGAL_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]>;
export declare function canTransition(from: string, to: string): boolean;
/**
 * Move a driver to a new lifecycle state. Writes the history row and the
 * profile columns in ONE transaction. Throws on illegal transitions (the
 * route maps that to 409) and on unknown drivers (404).
 */
export declare function transitionLifecycle(driverId: string, to: LifecycleStatus, actorEmail: string, opts?: {
    reason?: string | null;
    endsAt?: string | null;
}): Promise<{
    from: LifecycleStatus;
    to: LifecycleStatus;
}>;
export declare class LifecycleError extends Error {
    code: "not_found" | "illegal_transition";
    detail?: unknown;
    constructor(code: LifecycleError["code"], message: string, detail?: unknown);
}
export interface DriverListQuery {
    search?: string;
    status?: string;
    online?: boolean;
    city?: string;
    tier?: string;
    vehicleType?: string;
    sort?: string;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
}
/**
 * Driver list with search (name/phone/email/plate/licence), lifecycle and
 * online filters, sort + pagination. POPIA: the raw phone/id_number are
 * returned here (list endpoints MASK them — the route layer does that).
 */
export declare function listDrivers(q: DriverListQuery): Promise<{
    rows: any[];
    total: number;
}>;
/** Full profile for one driver: person + vehicle + lifecycle + tier + docs. */
export declare function getDriverProfile(driverId: string): Promise<any | null>;
/**
 * Onboarding queue: drivers not yet ACTIVE, OLDEST first, with a waiting-time
 * indicator (seconds since the newest pending document arrived).
 */
export declare function listOnboardingQueue(limit?: number): Promise<any[]>;
/** Are all REQUIRED documents approved for this driver? (Configurable list.) */
export declare function allRequiredDocsApproved(driverId: string): Promise<{
    ok: boolean;
    missing: string[];
}>;
/** Documents expiring within `days` (default 30), soonest first. */
export declare function listExpiringDocuments(days?: number): Promise<any[]>;
/** Doc rows + required list + reject reasons (for the review screens). */
export declare function getReviewLists(): Promise<{
    required: any[];
    rejectReasons: any[];
}>;
//# sourceMappingURL=adminDrivers.d.ts.map