import type { AdminActor } from "./adminAuth";
/** Every flag the console can display; rider_gate rides alongside the RC4 three. */
export declare function readAllFlags(): Promise<Record<string, unknown>>;
/**
 * Update one RC4 flag with audit. rider_gate is deliberately NOT writable
 * here: flipping a booking gate is a deploy-runbook action (SQL), not a
 * console button — the brief keeps high-blast-radius switches off.
 */
export declare function writeFlag(key: string, changes: Record<string, unknown>, actor: AdminActor): Promise<Record<string, unknown>>;
export declare function listRequiredDocs(): Promise<any[]>;
export declare function listRejectReasons(): Promise<any[]>;
export declare function setRequiredDoc(docType: string, patch: {
    label?: string;
    active?: boolean;
    sort_order?: number;
}, actor: AdminActor): Promise<any>;
export declare function setRejectReason(code: string, patch: {
    label?: string;
    active?: boolean;
    sort_order?: number;
}, actor: AdminActor): Promise<any>;
/**
 * Ops status snapshot: DB reachable, migrations applied, feature flags,
 * fleet counts and admin-table health. Read-only; safe to poll.
 */
export declare function getSystemStatus(): Promise<Record<string, unknown>>;
//# sourceMappingURL=adminSettings.d.ts.map