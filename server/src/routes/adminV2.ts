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
import {
  LIFECYCLE_STATES,
  allRequiredDocsApproved,
  getDriverProfile,
  getReviewLists,
  isLifecycleStatus,
  listDrivers,
  listExpiringDocuments,
  listOnboardingQueue,
  transitionLifecycle,
} from "../services/adminDrivers";
import { sendPushToUser } from "../services/push";
import { maskPhone } from "../lib/format";
/**
 * Best-effort push notice to the driver when an admin changes their status.
 * States the reason verbatim (the brief: "push notification to the driver
 * stating the reason"). Never throws into the route.
 */
async function notifyDriverLifecycle(
  driverId: string,
  to: string,
  reason: string | null
): Promise<void> {
  const label =
    to === "SUSPENDED"
      ? "Your account is suspended"
      : to === "BLOCKED"
        ? "Your account is blocked"
        : to === "REJECTED"
          ? "Your application was not approved"
          : to === "ACTIVE"
            ? "Your account is active"
            : `Your status is now ${to.toLowerCase()}`;
  await sendPushToUser(driverId, {
    title: label,
    body: reason || "Contact support for details.",
  } as any);
}

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

// ── Phase 1: drivers ─────────────────────────────────────────────────────────

// GET /api/admin/v2/drivers — searchable, filterable driver list (POPIA:
// phone masked in the LIST; the profile endpoint reveals with audit).
router.get("/drivers", requireAdmin("drivers.read"), async (req: AuthRequest, res: Response) => {
  try {
    const { rows, total } = await listDrivers({
      search: String(req.query.search || ""),
      status: String(req.query.status || "") || undefined,
      online: req.query.online === "true" ? true : req.query.online === "false" ? false : undefined,
      tier: String(req.query.tier || "") || undefined,
      vehicleType: String(req.query.vehicle_type || "") || undefined,
      sort: String(req.query.sort || "created"),
      order: req.query.order === "asc" ? "asc" : "desc",
      limit: parseInt(String(req.query.limit || "50"), 10),
      offset: parseInt(String(req.query.offset || "0"), 10),
    });
    // POPIA: mask phones in list responses.
    const masked = rows.map((r) => ({ ...r, phone: maskPhone(r.phone) }));
    res.json({ drivers: masked, total });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/admin/v2/drivers/:id — full profile. Writing phone/id_number
// into the audit log is deliberate: a reveal is an audited action.
router.get("/drivers/:id", requireAdmin("drivers.read"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const profile = await getDriverProfile(String(req.params.id));
    if (!profile) { res.status(404).json({ error: "Driver not found" }); return; }
    await writeAudit(actor, {
      action: "driver.reveal",
      entityType: "driver",
      entityId: profile.driver_id,
      newValue: { revealed: ["phone", "id_number"] },
    });
    res.json({ driver: profile });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/admin/v2/drivers/:id/lifecycle — move through the state machine.
// Body: { to, reason?, ends_at? }. Illegal transitions → 409 with the allowed set.
router.post(
  "/drivers/:id/lifecycle",
  requireAdmin("drivers.write"),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveAdminActor(req);
      if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
      const driverId = String(req.params.id);
      const to = req.body?.to;
      const reason = req.body?.reason ? String(req.body.reason).trim() : null;
      const endsAt = req.body?.ends_at ? String(req.body.ends_at) : null;
      if (!isLifecycleStatus(to)) {
        res.status(400).json({ error: `to must be one of: ${LIFECYCLE_STATES.join(", ")}` });
        return;
      }
      // Suspend/reject/block require a reason (brief: "reason where required").
      if (["SUSPENDED", "REJECTED", "BLOCKED"].includes(to) && (!reason || reason.length < 3)) {
        res.status(400).json({ error: `A reason is required to ${to.toLowerCase()}` });
        return;
      }
      if (to === "APPROVED") {
        const docs = await allRequiredDocsApproved(driverId);
        if (!docs.ok) {
          res.status(409).json({
            error: "Cannot approve until all required documents are approved",
            missing: docs.missing,
          });
          return;
        }
      }
      if (endsAt && Number.isNaN(Date.parse(endsAt))) {
        res.status(400).json({ error: "ends_at must be an ISO date" });
        return;
      }
      let result;
      try {
        result = await transitionLifecycle(driverId, to, actor.email, { reason, endsAt });
      } catch (e: any) {
        if (e?.code === "not_found") { res.status(404).json({ error: e.message }); return; }
        if (e?.code === "illegal_transition") {
          res.status(409).json({ error: e.message, ...e.detail });
          return;
        }
        throw e;
      }
      await writeAudit(actor, {
        action: `driver.lifecycle.${to.toLowerCase()}`,
        entityType: "driver",
        entityId: driverId,
        oldValue: { lifecycle_status: result.from },
        newValue: { lifecycle_status: result.to, suspended_until: endsAt },
        reason,
      });
      // Push notice to the driver stating the reason (best-effort, never throws).
      void notifyDriverLifecycle(driverId, to, reason).catch(() => undefined);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// GET /api/admin/v2/onboarding — the review queue, oldest waiting first.
router.get("/onboarding", requireAdmin("drivers.read"), async (_req: AuthRequest, res: Response) => {
  try {
    const [queue, lists] = await Promise.all([listOnboardingQueue(), getReviewLists()]);
    res.json({ queue, ...lists });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/admin/v2/documents/expiring — documents expiring within N days.
router.get("/documents/expiring", requireAdmin("drivers.read"), async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(String(req.query.days || "30"), 10);
    const rows = await listExpiringDocuments(days);
    res.json({ documents: rows.map((r) => ({ ...r, phone: maskPhone(r.phone) })) });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;