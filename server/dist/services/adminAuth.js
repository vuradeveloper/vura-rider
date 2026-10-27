"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS = exports.ADMIN_PERMISSIONS = exports.GOVERNANCE_EMAIL = exports.ADMIN_ROLES = void 0;
exports.isGovernanceEmail = isGovernanceEmail;
exports.isAdminRole = isAdminRole;
exports.roleHasPermission = roleHasPermission;
exports.superAdminFallbackEmails = superAdminFallbackEmails;
exports.resolveAdminRole = resolveAdminRole;
exports.resolveAdminActor = resolveAdminActor;
exports.loadAdminActor = loadAdminActor;
exports.requireAdmin = requireAdmin;
exports.writeAudit = writeAudit;
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
exports.ADMIN_ROLES = [
    "super_admin",
    "onboarding_reviewer",
    "support_agent",
    "operations",
    "finance",
];
/** The single account that owns governance (admin user management). */
exports.GOVERNANCE_EMAIL = "ridevura@gmail.com";
function isGovernanceEmail(email) {
    return (email || "").trim().toLowerCase() === exports.GOVERNANCE_EMAIL;
}
function isAdminRole(v) {
    return typeof v === "string" && exports.ADMIN_ROLES.includes(v);
}
/** The permission strings routes gate on. Keep in sync with the admin app. */
exports.ADMIN_PERMISSIONS = [
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
    "catalogue.read",
    "catalogue.write",
];
/**
 * The role → permission matrix. Finance is READ-ONLY on money (Phase 6 adds
 * nothing writable there either; the brief keeps all money actions off).
 */
exports.ROLE_PERMISSIONS = {
    super_admin: exports.ADMIN_PERMISSIONS,
    onboarding_reviewer: [
        "dashboard.read",
        "drivers.read",
        "drivers.write",
        "documents.read",
        "documents.review",
        "audit.read",
        "catalogue.read",
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
        "catalogue.read",
        "catalogue.write",
    ],
    finance: ["dashboard.read", "money.read"],
};
function roleHasPermission(role, perm) {
    return exports.ROLE_PERMISSIONS[role].includes(perm);
}
/** Emails from the env, lowercased and trimmed. Empty list = fallback unused. */
function superAdminFallbackEmails() {
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
async function resolveAdminRole(email) {
    if (!email)
        return null;
    const normalized = email.trim().toLowerCase();
    if (!normalized)
        return null;
    if (superAdminFallbackEmails().includes(normalized))
        return "super_admin";
    // Governance owner is always a super_admin, even if not listed in env or table.
    if (normalized === exports.GOVERNANCE_EMAIL)
        return "super_admin";
    try {
        const row = await (0, database_1.queryOne)(`SELECT role FROM admin_users WHERE LOWER(email) = $1 AND disabled = FALSE`, [normalized]);
        return isAdminRole(row?.role) ? row.role : null;
    }
    catch (err) {
        // Table missing (migration 004 not applied) → feature off, not a crash.
        if ((0, database_1.isMissingRelation)(err))
            return null;
        throw err;
    }
}
/** Resolve the actor for ACTION code (audit + permission checks). */
async function resolveAdminActor(req) {
    const role = await resolveAdminRole(req.user?.email);
    if (!role)
        return null;
    return { email: (req.user.email || "").trim().toLowerCase(), role };
}
/** Attach the resolved actor (or null) to the request. Never throws. */
async function loadAdminActor(req) {
    const actor = await resolveAdminActor(req);
    req.adminActor = actor;
    return actor;
}
/**
 * requireAuth + role gate for ONE permission. 401 without a token, 403 when
 * the email resolves to no role or the role lacks the permission.
 */
function requireAdmin(perm) {
    return async (req, res, next) => {
        // Phase the caller through Firebase auth first (same middleware contract).
        await new Promise((resolve) => (0, auth_1.requireAuth)(req, res, () => resolve()));
        if (res.headersSent)
            return;
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
            // Governance (admin user management) is owned by a single account only.
            if (perm === "admins.manage" && !isGovernanceEmail(actor.email)) {
                res.status(403).json({
                    error: "Governance access is restricted to the account owner",
                    required: perm,
                    role: actor.role,
                });
                return;
            }
            next();
        }
        catch (err) {
            if ((0, database_1.isMissingRelation)(err)) {
                res.status(503).json({ error: "Admin features are not available on this server yet" });
                return;
            }
            res.status(500).json({ error: err?.message || "Admin auth failed" });
        }
    };
}
/**
 * Append one audit row. Call this INSIDE the same request as the action, right
 * after it succeeds. Never throws into the caller — an audit failure is
 * logged loudly but does not undo the operator's action (the action itself is
 * the source of truth; the log is the record of it).
 */
async function writeAudit(actor, input) {
    try {
        await (0, database_1.execute)(`INSERT INTO admin_audit_log
         (actor_email, actor_role, action, entity_type, entity_id, old_value, new_value, reason)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`, [
            actor.email,
            actor.role,
            input.action,
            input.entityType,
            input.entityId ?? null,
            input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
            input.newValue === undefined ? null : JSON.stringify(input.newValue),
            input.reason?.trim() || null,
        ]);
    }
    catch (err) {
        console.error(`[admin/audit] WRITE FAILED actor=${actor.email} action=${input.action} ` +
            `entity=${input.entityType}/${input.entityId ?? "-"}: ${err?.message}`);
    }
}
//# sourceMappingURL=adminAuth.js.map