// ─────────────────────────────────────────────────────────────────────────────
// adminAuth — ADMIN V2 (Phase 0): roles, permissions, audit log.
//
// WHO:  an admin is a Firebase-authenticated user whose VERIFIED email
//       resolves to a role. Resolution order:
//         1. email listed in the ADMIN_EMAILS env  → super_admin (the
//            fallback that cannot be locked out by a broken table),
//         2. a non-disabled row in admin_users      → its role,
//         3. otherwise → null (403).
//
// WHAT: each role carries a fixed permission set (no per-permission editing in
// Phase 0). Routes call requireAdmin("perm") and the server is the ONLY
// authority — the UI mirrors the same matrix to hide what a role cannot do.
//
// AUDIT: every admin ACTION calls writeAudit(...) — who, when, what, the old
// and new value and (where required) the reason. The table is append-only;
// there is no update or delete path.
//
// MISSING TABLES: a database without migration 004 answers 503 "feature off"
// — never a throw, and these routes are not on any ride/driver/location path.
// ─────────────────────────────────────────────────────────────────────────────
import { Response, NextFunction } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { queryOne, execute, isMissingRelation } from "../config/database";

export const ADMIN_ROLES = [
  "super_admin",
  "onboarding_reviewer",
  "support_agent",
  "operations",
  "finance",
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(v: unknown): v is AdminRole {
  return typeof v === "string" && (ADMIN_ROLES as readonly string[]).includes(v);
}

/** The permission strings routes gate on. Keep in sync with the admin app. */
export const ADMIN_PERMISSIONS = [
  "dashboard.read",
  "drivers.read",
  "drivers.write", // lifecycle actions: suspend/reinstate/block/approve
  "documents.read",
  "documents.review",
  "riders.read",
  "riders.write",
  "trips.read",
  "tickets.read",
  "tickets.write",
  "messaging.send",
  "features.read",
  "features.write",
  "settings.read",
  "settings.write",
  "money.read",
  "admins.manage",
  "audit.read",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/**
 * The role → permission matrix. Finance is READ-ONLY on money (Phase 6 adds
 * nothing writable there either; the brief keeps all money actions off).
 */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  onboarding_reviewer: [
    "dashboard.read",
    "drivers.read",
    "drivers.write",
    "documents.read",
    "documents.review",
    "audit.read",
  ],
  support_agent: [
    "dashboard.read",
    "drivers.read",
    "riders.read",
    "trips.read",
    "tickets.read",
    "tickets.write",
  ],
  operations: [
    "dashboard.read",
    "drivers.read",
    "drivers.write",
    "riders.read",
    "riders.write",
    "trips.read",
    "tickets.read",
    "tickets.write",
    "messaging.send",
    "features.read",
    "settings.read",
  ],
  finance: ["dashboard.read", "money.read"],
};

export function roleHasPermission(role: AdminRole, perm: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

export interface AdminActor {
  email: string;
  role: AdminRole;
}

/** Emails from the env, lowercased and trimmed. Empty list = fallback unused. */
export function superAdminFallbackEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve the caller's admin role. Returns null for non-admins.
 * A disabled admin_users row loses to nothing — it simply does not resolve
 * (unless the email is in the ADMIN_EMAILS fallback).
 */
export async function resolveAdminRole(email: string | undefined | null): Promise<AdminRole | null> {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  if (superAdminFallbackEmails().includes(normalized)) return "super_admin";
  try {
    const row = await queryOne<{ role: string }>(
      `SELECT role FROM admin_users WHERE LOWER(email) = $1 AND disabled = FALSE`,
      [normalized]
    );
    return isAdminRole(row?.role) ? row.role : null;
  } catch (err) {
    // Table missing (migration 004 not applied) → feature off, not a crash.
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

/** Resolve the actor for ACTION code (audit + permission checks). */
export async function resolveAdminActor(req: AuthRequest): Promise<AdminActor | null> {
  const role = await resolveAdminRole(req.user?.email);
  if (!role) return null;
  return { email: (req.user!.email || "").trim().toLowerCase(), role };
}

/** Attach the resolved actor (or null) to the request. Never throws. */
export async function loadAdminActor(req: AuthRequest): Promise<AdminActor | null> {
  const actor = await resolveAdminActor(req);
  (req as any).adminActor = actor;
  return actor;
}

/**
 * requireAuth + role gate for ONE permission. 401 without a token, 403 when
 * the email resolves to no role or the role lacks the permission.
 */
export function requireAdmin(perm: AdminPermission) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Phase the caller through Firebase auth first (same middleware contract).
    await new Promise<void>((resolve) => requireAuth(req, res, () => resolve()));
    if (res.headersSent) return;
    try {
      const actor = await loadAdminActor(req);
      if (!actor) {
        res.status(403).json({ error: "Admin only" });
        return;
      }
      if (!roleHasPermission(actor.role, perm)) {
        res.status(403).json({
          error: "Insufficient permissions",
          required: perm,
          role: actor.role,
        });
        return;
      }
      next();
    } catch (err: any) {
      if (isMissingRelation(err)) {
        res.status(503).json({ error: "Admin features are not available on this server yet" });
        return;
      }
      res.status(500).json({ error: err?.message || "Admin auth failed" });
    }
  };
}

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
export async function writeAudit(actor: AdminActor, input: AuditInput): Promise<void> {
  try {
    await execute(
      `INSERT INTO admin_audit_log
         (actor_email, actor_role, action, entity_type, entity_id, old_value, new_value, reason)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        actor.email,
        actor.role,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
        input.newValue === undefined ? null : JSON.stringify(input.newValue),
        input.reason?.trim() || null,
      ]
    );
  } catch (err: any) {
    console.error(
      `[admin/audit] WRITE FAILED actor=${actor.email} action=${input.action} ` +
        `entity=${input.entityType}/${input.entityId ?? "-"}: ${err?.message}`
    );
  }
}