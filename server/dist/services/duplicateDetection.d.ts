import type { AdminActor } from "./adminAuth";
export type DuplicateKind = "phone" | "id" | "email" | "email_near";
export interface DuplicateMatch {
    userId: string;
    fullName: string | null;
    email: string | null;
    phone: string | null;
    score: number;
    kind: DuplicateKind;
    reason: string;
}
export declare function ensureDuplicateSchema(): Promise<void>;
/** Exact phone/ID matches and exact/near email matches, strongest first. */
export declare function findDuplicateMatches(input: {
    userId?: string;
    phone?: unknown;
    idNumber?: unknown;
    email?: unknown;
}): Promise<DuplicateMatch[]>;
/** Record a flag unless an admin already cleared or confirmed this account. */
export declare function markUserDuplicate(userId: string, match: DuplicateMatch): Promise<boolean>;
/**
 * Boot sweep for accounts that already exist. Keeps the oldest account as the
 * reference and flags the later ones. Email typos are compared only within the
 * same domain, and only one edit apart.
 */
export declare function sweepDuplicateUsers(limit?: number): Promise<number>;
/** Admin queue: open duplicate flags with both sides of the match. */
export declare function listDuplicateFlags(): Promise<any[]>;
export declare function resolveDuplicate(userId: string, resolution: "cleared" | "confirmed", actor: AdminActor, note?: string): Promise<any | null>;
//# sourceMappingURL=duplicateDetection.d.ts.map