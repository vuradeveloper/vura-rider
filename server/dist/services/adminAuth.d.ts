import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
export declare const ADMIN_ROLES: readonly ["super_admin", "onboarding_reviewer", "support_agent", "operations", "finance"];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export declare function isAdminRole(v: unknown): v is AdminRole;
/** The permission strings routes gate on. Keep in sync with the admin app. */
export declare const ADMIN_PERMISSIONS: readonly ["dashboard.read", "drivers.read", "drivers.write", "documents.read", "documents.review", "riders.read", "riders.write", "trips.read", "tickets.read", "tickets.write", "messaging.send", "features.read", "features.write", "settings.read", "settings.write", "money.read", "admins.manage", "audit.read", "catalogue.read", "catalogue.write"];
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
/**
 * The role → permission matrix. Finance is READ-ONLY on money (Phase 6 adds
 * nothing writable there either; the brief keeps all money actions off).
 */
export declare const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]>;
export declare function roleHasPermission(role: AdminRole, perm: AdminPermission): boolean;
export interface AdminActor {
    email: string;
    role: AdminRole;
}
/** Emails from the env, lowercased and trimmed. Empty list = fallback unused. */
export declare function superAdminFallbackEmails(): string[];
/**
 * Resolve the caller's admin role. Returns null for non-admins.
 * A disabled admin_users row loses to nothing — it simply does not resolve
 * (unless the email is in the ADMIN_EMAILS fallback).
 */
export declare function resolveAdminRole(email: string | undefined | null): Promise<AdminRole | null>;
/** Resolve the actor for ACTION code (audit + permission checks). */
export declare function resolveAdminActor(req: AuthRequest): Promise<AdminActor | null>;
/** Attach the resolved actor (or null) to the request. Never throws. */
export declare function loadAdminActor(req: AuthRequest): Promise<AdminActor | null>;
/**
 * requireAuth + role gate for ONE permission. 401 without a token, 403 when
 * the email resolves to no role or the role lacks the permission.
 */
export declare function requireAdmin(perm: AdminPermission): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
export interface AuditInput {
    action: string;
    entityType: string;
    entityId?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
}
/**
 * Append one audit row. Call this INSIDE the same request as the action, right
 * after it succeeds. Never throws into the caller — an audit failure is
 * logged loudly but does not undo the operator's action (the action itself is
 * the source of truth; the log is the record of it).
 */
export declare function writeAudit(actor: AdminActor, input: AuditInput): Promise<void>;
//# sourceMappingURL=adminAuth.d.ts.map