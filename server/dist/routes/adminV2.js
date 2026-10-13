"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/v2 — ADMIN V2 (Phase 0): who-am-I, admin user management and the
// immutable audit log.
//
//   GET    /api/admin/v2/me                the caller's role + permissions
//   GET    /api/admin/v2/admins            list admin users                (admins.manage)
//   POST   /api/admin/v2/admins            invite by email + role          (admins.manage)
//   PATCH  /api/admin/v2/admins/:id        change role / disable / enable  (admins.manage)
//   GET    /api/admin/v2/audit             search the audit log            (audit.read)
//
// Auth: Firebase bearer (requireAdmin does it) + the role permission matrix
// in services/adminAuth. Every ACTION writes an audit row. Inputs are
// validated against fixed lists — no arbitrary keys or SQL, ever.
// The legacy /api/admin/* routes keep their ADMIN_EMAILS gate untouched.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const database_1 = require("../config/database");
const adminAuth_1 = require("../services/adminAuth");
const router = (0, express_1.Router)();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function sendError(res, err) {
    if ((0, database_1.isMissingRelation)(err)) {
        res.status(503).json({ error: "Admin features are not available on this server yet" });
        return;
    }
    console.error("[admin/v2] unexpected error:", err);
    res.status(500).json({ error: err?.message || "unexpected error" });
}
// GET /api/admin/v2/me — the caller's resolved role and the exact permission
// list the UI mirrors (from the same matrix the server gates with).
router.get("/me", (0, adminAuth_1.requireAdmin)("dashboard.read"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        res.json({
            email: actor.email,
            role: actor.role,
            permissions: adminAuth_1.ROLE_PERMISSIONS[actor.role],
        });
    }
    catch (err) {
        sendError(res, err);
    }
});
// ── Admin user management (super_admin / admins.manage) ──────────────────────
// GET /api/admin/v2/admins — list every admin row (fallback emails noted).
router.get("/admins", (0, adminAuth_1.requireAdmin)("admins.manage"), async (_req, res) => {
    try {
        const admins = await (0, database_1.query)(`SELECT id, email, role, disabled, invited_by, created_at, updated_at
         FROM admin_users ORDER BY LOWER(email)`);
        res.json({ admins });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/admins — invite by email + role. Upserts a disabled row
// back to enabled with the new role (so re-inviting works), audits old→new.
router.post("/admins", (0, adminAuth_1.requireAdmin)("admins.manage"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const email = String(req.body?.email || "").trim().toLowerCase();
        const role = req.body?.role;
        if (!EMAIL_RE.test(email)) {
            res.status(400).json({ error: "A valid email is required" });
            return;
        }
        if (!adminAuth_1.ADMIN_ROLES.includes(role)) {
            res.status(400).json({ error: `role must be one of: ${adminAuth_1.ADMIN_ROLES.join(", ")}` });
            return;
        }
        // The env fallback cannot be shadowed or disabled from the UI.
        if (email === actor.email && role !== "super_admin") {
            res.status(400).json({ error: "You cannot change your own role" });
            return;
        }
        const existing = await (0, database_1.queryOne)(`SELECT id, role, disabled FROM admin_users WHERE LOWER(email) = $1`, [email]);
        const row = await (0, database_1.queryOne)(`INSERT INTO admin_users (email, role, disabled, invited_by)
       VALUES ($1, $2, FALSE, $3)
       ON CONFLICT (LOWER(email)) DO UPDATE
         SET role = EXCLUDED.role, disabled = FALSE, updated_at = NOW()
       RETURNING id, email, role, disabled, invited_by, created_at`, [email, role, actor.email]);
        await (0, adminAuth_1.writeAudit)(actor, {
            action: existing ? "admin.role_change" : "admin.invite",
            entityType: "admin_user",
            entityId: row?.id ?? null,
            oldValue: existing ? { role: existing.role, disabled: existing.disabled } : undefined,
            newValue: { role, disabled: false },
        });
        res.status(existing ? 200 : 201).json({ admin: row });
    }
    catch (err) {
        sendError(res, err);
    }
});
// PATCH /api/admin/v2/admins/:id — change role and/or disable. Cannot touch
// your own row (no self-lockout); the ADMIN_EMAILS fallback ignores rows.
router.patch("/admins/:id", (0, adminAuth_1.requireAdmin)("admins.manage"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const id = String(req.params.id || "");
        const existing = await (0, database_1.queryOne)(`SELECT id, email, role, disabled FROM admin_users WHERE id = $1`, [id]);
        if (!existing) {
            res.status(404).json({ error: "Admin not found" });
            return;
        }
        if (String(existing.email).toLowerCase() === actor.email) {
            res.status(400).json({ error: "You cannot change your own row" });
            return;
        }
        const role = req.body?.role;
        const disabled = req.body?.disabled;
        if (role !== undefined && !adminAuth_1.ADMIN_ROLES.includes(role)) {
            res.status(400).json({ error: `role must be one of: ${adminAuth_1.ADMIN_ROLES.join(", ")}` });
            return;
        }
        if (disabled !== undefined && typeof disabled !== "boolean") {
            res.status(400).json({ error: "disabled must be a boolean" });
            return;
        }
        const row = await (0, database_1.queryOne)(`UPDATE admin_users
          SET role = COALESCE($2, role),
              disabled = COALESCE($3, disabled),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, role, disabled, invited_by, created_at, updated_at`, [id, role ?? null, disabled ?? null]);
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "admin.role_change",
            entityType: "admin_user",
            entityId: id,
            oldValue: { role: existing.role, disabled: existing.disabled },
            newValue: { role: row?.role, disabled: row?.disabled },
        });
        res.json({ admin: row });
    }
    catch (err) {
        sendError(res, err);
    }
});
// ── Audit log (audit.read) ───────────────────────────────────────────────────
// GET /api/admin/v2/audit — searchable, filterable, newest first. Filters are
// whitelisted strings only; dates are ISO; limit is clamped. Export is the
// same query with format=csv.
router.get("/audit", (0, adminAuth_1.requireAdmin)("audit.read"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const where = [];
        const params = [];
        const add = (sql, value) => {
            params.push(value);
            where.push(sql.replace("?", `$${params.length}`));
        };
        const actorEmail = String(req.query.actor || "").trim().toLowerCase();
        if (actorEmail)
            add("LOWER(actor_email) = ?", actorEmail);
        const action = String(req.query.action || "").trim();
        // Prefix search so 'driver.' matches every driver action.
        if (action)
            add("action LIKE ?", `${action.replace(/[%_]/g, "")}%`);
        const entityType = String(req.query.entity_type || "").trim();
        if (entityType)
            add("entity_type = ?", entityType.replace(/[%_]/g, ""));
        const entityId = String(req.query.entity_id || "").trim();
        if (entityId)
            add("entity_id = ?", entityId);
        const from = String(req.query.from || "").trim();
        if (from)
            add("created_at >= ?", new Date(from).toISOString());
        const to = String(req.query.to || "").trim();
        if (to)
            add("created_at <= ?", new Date(to).toISOString());
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 500);
        const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const rows = await (0, database_1.query)(`SELECT id, actor_email, actor_role, action, entity_type, entity_id,
              old_value, new_value, reason, created_at
         FROM admin_audit_log ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
        // CSV export (audited — someone reading the whole log is worth knowing).
        if (String(req.query.format || "") === "csv") {
            await (0, adminAuth_1.writeAudit)(actor, {
                action: "audit.export",
                entityType: "admin_audit_log",
                newValue: { filters: { actorEmail, action, entityType, entityId, from, to }, rows: rows.length },
            });
            const esc = (v) => v === null || v === undefined ? "" : `"${String(typeof v === "object" ? JSON.stringify(v) : v).replace(/"/g, '""')}"`;
            const header = "id,actor_email,actor_role,action,entity_type,entity_id,reason,created_at";
            const body = rows
                .map((r) => [r.id, r.actor_email, r.actor_role, r.action, r.entity_type, r.entity_id, r.reason, r.created_at]
                .map(esc)
                .join(","))
                .join("\n");
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="audit-log.csv"`);
            res.send(`${header}\n${body}`);
            return;
        }
        const total = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS count FROM admin_audit_log ${whereSql}`, params);
        res.json({ entries: rows, total: total?.count ?? rows.length, limit, offset });
    }
    catch (err) {
        sendError(res, err);
    }
});
exports.default = router;
//# sourceMappingURL=adminV2.js.map