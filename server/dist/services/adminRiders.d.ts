export declare const RIDER_STATUSES: readonly ["active", "suspended", "banned"];
export type RiderStatus = (typeof RIDER_STATUSES)[number];
export declare function isRiderStatus(v: unknown): v is RiderStatus;
/** Legal moderation transitions (server-authoritative). */
export declare const RIDER_TRANSITIONS: Record<RiderStatus, RiderStatus[]>;
export declare function canModerate(from: string, to: string): boolean;
export declare class RiderModerationError extends Error {
    code: "not_found" | "illegal_transition" | "reason_required";
    detail?: unknown | undefined;
    constructor(code: "not_found" | "illegal_transition" | "reason_required", message: string, detail?: unknown | undefined);
}
/**
 * Apply a moderation change. Writes rider_moderation (upsert) +
 * rider_status_history in ONE transaction; the caller writes the audit row.
 * Reason is REQUIRED for suspending/banning (reinstating needs none).
 */
export declare function moderateRider(riderId: string, to: RiderStatus, actorEmail: string, opts?: {
    reason?: string | null;
    until?: string | null;
}): Promise<{
    from: RiderStatus;
    to: RiderStatus;
}>;
/**
 * Rider list for the console. POPIA: phones masked at the API edge; search
 * matches name/email/phone. Moderation status is LEFT-JOINed (absent row =
 * active). Includes ride counts so support sees standing at a glance.
 */
export declare function listRiders(opts: {
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<{
    rows: any[];
    total: number;
}>;
/** One rider: full profile (phone/id NOT masked — reveal is audited), notes, history, stats. */
export declare function getRider(riderId: string): Promise<any | null>;
/**
 * Is the rider gate armed? Reads app_config key `rider_gate` with a 10s cache;
 * a missing/unreadable row is OFF (safe-by-default, same as every other flag).
 */
export declare function riderGateEnabled(force?: boolean): Promise<boolean>;
/**
 * The ONE booking gate: throws when the gate is armed and the rider is
 * suspended/banned (and any `until` has passed). With the flag OFF — the
 * seed — this is a single cached SELECT that always returns.
 */
export declare function assertRiderCanBook(riderId: string): Promise<void>;
/** Add an internal note (write is audited by the route). */
export declare function addRiderNote(riderId: string, note: string, actorEmail: string): Promise<void>;
//# sourceMappingURL=adminRiders.d.ts.map