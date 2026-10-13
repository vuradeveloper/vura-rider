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
import { Router, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { query, queryOne, execute, isMissingRelation } from "../config/database";
import {
  ADMIN_ROLES,
  ROLE_PERMISSIONS,
  requireAdmin,
  resolveAdminActor,
  writeAudit,
} from "../services/adminAuth";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sendError(res: Response, err: any) {
  if (isMissingRelation(err)) {
    res.status(503).json({ error: "Admin features are not available on this server yet" });
    return;
  }
  console.error("[admin/v2] unexpected error:", err);
  res.status(500).json({ error: err?.message || "unexpected error" });
}

// GET /api/admin/v2/me — the caller's resolved role and the exact permission
// list the UI mirrors (from the same matrix the server gates with).
router.get("/me", requireAdmin("dashboard.read"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    res.json({
      email: actor.email,
      role: actor.role,
      permissions: ROLE_PERMISSIONS[actor.role],
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ── Admin user management (super_admin / admins.manage) ──────────────────────

// GET /api/admin/v2/admins — list every admin row (fallback emails noted).
router.get("/admins", requireAdmin("admins.manage"), async (_req: AuthRequest, res: Response) => {
  try {
    const admins = await query(
      `SELECT id, email, role, disabled, invited_by, created_at, updated_at
         FROM admin_users ORDER BY LOWER(email)`
    );
    res.json({ admins });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/admin/v2/admins — invite by email + role. Upserts a disabled row
// back to enabled with the new role (so re-inviting works), audits old→new.
router.post("/admins", requireAdmin("admins.manage"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = req.body?.role;
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }
    if (!(ADMIN_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: `role must be one of: ${ADMIN_ROLES.join(", ")}` });
      return;
    }
    // The env fallback cannot be shadowed or disabled from the UI.
    if (email === actor.email && role !== "super_admin") {
      res.status(400).json({ error: "You cannot change your own role" });
      return;
    }
    const existing = await queryOne<any>(
      `SELECT id, role, disabled FROM admin_users WHERE LOWER(email) = $1`,
      [email]
    );
    const row = await queryOne<any>(
      `INSERT INTO admin_users (email, role, disabled, invited_by)
       VALUES ($1, $2, FALSE, $3)
       ON CONFLICT (LOWER(email)) DO UPDATE
         SET role = EXCLUDED.role, disabled = FALSE, updated_at = NOW()
       RETURNING id, email, role, disabled, invited_by, created_at`,
      [email, role, actor.email]
    );
    await writeAudit(actor, {
      action: existing ? "admin.role_change" : "admin.invite",
      entityType: "admin_user",
      entityId: row?.id ?? null,
      oldValue: existing ? { role: existing.role, disabled: existing.disabled } : undefined,
      newValue: { role, disabled: false },
    });
    res.status(existing ? 200 : 201).json({ admin: row });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /api/admin/v2/admins/:id — change role and/or disable. Cannot touch
// your own row (no self-lockout); the ADMIN_EMAILS fallback ignores rows.
router.patch("/admins/:id", requireAdmin("admins.manage"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const id = String(req.params.id || "");
    const existing = await queryOne<any>(
      `SELECT id, email, role, disabled FROM admin_users WHERE id = $1`,
      [id]
    );
    if (!existing) { res.status(404).json({ error: "Admin not found" }); return; }
    if (String(existing.email).toLowerCase() === actor.email) {
      res.status(400).json({ error: "You cannot change your own row" });
      return;
    }
    const role = req.body?.role;
    const disabled = req.body?.disabled;
    if (role !== undefined && !(ADMIN_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: `role must be one of: ${ADMIN_ROLES.join(", ")}` });
      return;
    }
    if (disabled !== undefined && typeof disabled !== "boolean") {
      res.status(400).json({ error: "disabled must be a boolean" });
      return;
    }
    const row = await queryOne<any>(
      `UPDATE admin_users
          SET role = COALESCE($2, role),
              disabled = COALESCE($3, disabled),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, role, disabled, invited_by, created_at, updated_at`,
      [id, role ?? null, disabled ?? null]
    );
    await writeAudit(actor, {
      action: "admin.role_change",
      entityType: "admin_user",
      entityId: id,
      oldValue: { role: existing.role, disabled: existing.disabled },
      newValue: { role: row?.role, disabled: row?.disabled },
    });
    res.json({ admin: row });
  } catch (err) {
    sendError(res, err);
  }
});

// ── Audit log (audit.read) ───────────────────────────────────────────────────

// GET /api/admin/v2/audit — searchable, filterable, newest first. Filters are
// whitelisted strings only; dates are ISO; limit is clamped. Export is the
// same query with format=csv.
router.get("/audit", requireAdmin("audit.read"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const where: string[] = [];
    const params: any[] = [];
    const add = (sql: string, value: any) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    const actorEmail = String(req.query.actor || "").trim().toLowerCase();
    if (actorEmail) add("LOWER(actor_email) = ?", actorEmail);
    const action = String(req.query.action || "").trim();
    // Prefix search so 'driver.' matches every driver action.
    if (action) add("action LIKE ?", `${action.replace(/[%_]/g, "")}%`);
    const entityType = String(req.query.entity_type || "").trim();
    if (entityType) add("entity_type = ?", entityType.replace(/[%_]/g, ""));
    const entityId = String(req.query.entity_id || "").trim();
    if (entityId) add("entity_id = ?", entityId);
    const from = String(req.query.from || "").trim();
    if (from) add("created_at >= ?", new Date(from).toISOString());
    const to = String(req.query.to || "").trim();
    if (to) add("created_at <= ?", new Date(to).toISOString());
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query<any>(
      `SELECT id, actor_email, actor_role, action, entity_type, entity_id,
              old_value, new_value, reason, created_at
         FROM admin_audit_log ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    // CSV export (audited — someone reading the whole log is worth knowing).
    if (String(req.query.format || "") === "csv") {
      await writeAudit(actor, {
        action: "audit.export",
        entityType: "admin_audit_log",
        newValue: { filters: { actorEmail, action, entityType, entityId, from, to }, rows: rows.length },
      });
      const esc = (v: any) =>
        v === null || v === undefined ? "" : `"${String(typeof v === "object" ? JSON.stringify(v) : v).replace(/"/g, '""')}"`;
      const header = "id,actor_email,actor_role,action,entity_type,entity_id,reason,created_at";
      const body = rows
        .map((r) =>
          [r.id, r.actor_email, r.actor_role, r.action, r.entity_type, r.entity_id, r.reason, r.created_at]
            .map(esc)
            .join(",")
        )
        .join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audit-log.csv"`);
      res.send(`${header}\n${body}`);
      return;
    }

    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM admin_audit_log ${whereSql}`,
      params
    );
    res.json({ entries: rows, total: total?.count ?? rows.length, limit, offset });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;