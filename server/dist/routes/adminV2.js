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
const adminDrivers_1 = require("../services/adminDrivers");
const push_1 = require("../services/push");
const adminTrips_1 = require("../services/adminTrips");
const adminRiders_1 = require("../services/adminRiders");
const format_1 = require("../lib/format");
const adminMessaging_1 = require("../services/adminMessaging");
/**
 * Best-effort push notice to the driver when an admin changes their status.
 * States the reason verbatim (the brief: "push notification to the driver
 * stating the reason"). Never throws into the route.
 */
async function notifyDriverLifecycle(driverId, to, reason) {
    const label = to === "SUSPENDED"
        ? "Your account is suspended"
        : to === "BLOCKED"
            ? "Your account is blocked"
            : to === "REJECTED"
                ? "Your application was not approved"
                : to === "ACTIVE"
                    ? "Your account is active"
                    : `Your status is now ${to.toLowerCase()}`;
    await (0, push_1.sendPushToUser)(driverId, {
        title: label,
        body: reason || "Contact support for details.",
    });
}
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
// ── Phase 1: drivers ─────────────────────────────────────────────────────────
// GET /api/admin/v2/drivers — searchable, filterable driver list (POPIA:
// phone masked in the LIST; the profile endpoint reveals with audit).
router.get("/drivers", (0, adminAuth_1.requireAdmin)("drivers.read"), async (req, res) => {
    try {
        const { rows, total } = await (0, adminDrivers_1.listDrivers)({
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
        const masked = rows.map((r) => ({ ...r, phone: (0, format_1.maskPhone)(r.phone) }));
        res.json({ drivers: masked, total });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/drivers/:id — full profile. Writing phone/id_number
// into the audit log is deliberate: a reveal is an audited action.
router.get("/drivers/:id", (0, adminAuth_1.requireAdmin)("drivers.read"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const profile = await (0, adminDrivers_1.getDriverProfile)(String(req.params.id));
        if (!profile) {
            res.status(404).json({ error: "Driver not found" });
            return;
        }
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "driver.reveal",
            entityType: "driver",
            entityId: profile.driver_id,
            newValue: { revealed: ["phone", "id_number"] },
        });
        res.json({ driver: profile });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/drivers/:id/lifecycle — move through the state machine.
// Body: { to, reason?, ends_at? }. Illegal transitions → 409 with the allowed set.
router.post("/drivers/:id/lifecycle", (0, adminAuth_1.requireAdmin)("drivers.write"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const driverId = String(req.params.id);
        const to = req.body?.to;
        const reason = req.body?.reason ? String(req.body.reason).trim() : null;
        const endsAt = req.body?.ends_at ? String(req.body.ends_at) : null;
        if (!(0, adminDrivers_1.isLifecycleStatus)(to)) {
            res.status(400).json({ error: `to must be one of: ${adminDrivers_1.LIFECYCLE_STATES.join(", ")}` });
            return;
        }
        // Suspend/reject/block require a reason (brief: "reason where required").
        if (["SUSPENDED", "REJECTED", "BLOCKED"].includes(to) && (!reason || reason.length < 3)) {
            res.status(400).json({ error: `A reason is required to ${to.toLowerCase()}` });
            return;
        }
        if (to === "APPROVED") {
            const docs = await (0, adminDrivers_1.allRequiredDocsApproved)(driverId);
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
            result = await (0, adminDrivers_1.transitionLifecycle)(driverId, to, actor.email, { reason, endsAt });
        }
        catch (e) {
            if (e?.code === "not_found") {
                res.status(404).json({ error: e.message });
                return;
            }
            if (e?.code === "illegal_transition") {
                res.status(409).json({ error: e.message, ...e.detail });
                return;
            }
            throw e;
        }
        await (0, adminAuth_1.writeAudit)(actor, {
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
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/onboarding — the review queue, oldest waiting first.
router.get("/onboarding", (0, adminAuth_1.requireAdmin)("drivers.read"), async (_req, res) => {
    try {
        const [queue, lists] = await Promise.all([(0, adminDrivers_1.listOnboardingQueue)(), (0, adminDrivers_1.getReviewLists)()]);
        res.json({ queue, ...lists });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/documents/expiring — documents expiring within N days.
router.get("/documents/expiring", (0, adminAuth_1.requireAdmin)("drivers.read"), async (req, res) => {
    try {
        const days = parseInt(String(req.query.days || "30"), 10);
        const rows = await (0, adminDrivers_1.listExpiringDocuments)(days);
        res.json({ documents: rows.map((r) => ({ ...r, phone: (0, format_1.maskPhone)(r.phone) })) });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/vehicles — vehicle register: linked driver, documents,
// expiry dates, vehicle_tier (existing driver_profiles.vehicle_tier, NOT the
// performance tier).
router.get("/vehicles", (0, adminAuth_1.requireAdmin)("drivers.read"), async (_req, res) => {
    try {
        const rows = await (0, database_1.query)(`SELECT u.id AS driver_id, u.full_name,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_year, dp.vehicle_color,
              dp.body_type, dp.vehicle_category, dp.vehicle_tier, dp.license_plate,
              dp.lifecycle_status,
              (SELECT MIN(d.expires_at) FROM driver_documents d
                WHERE d.driver_id = u.id AND d.doc_type IN ('carscan_report','vehicle_scan','license_disk')
                  AND d.expires_at IS NOT NULL) AS vehicle_doc_expires,
              (SELECT COUNT(*) FROM driver_documents d
                WHERE d.driver_id = u.id AND d.status = 'pending_review')::int AS pending_docs
         FROM users u
         JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.role = 'driver'
          AND (dp.license_plate IS NOT NULL OR dp.vehicle_make IS NOT NULL)
        ORDER BY dp.vehicle_tier NULLS LAST, u.full_name`);
        res.json({ vehicles: rows });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/drivers/:id/tier — performance tier view (metrics,
// thresholds read-only; editing thresholds is Phase 5).
router.get("/drivers/:id/tier", (0, adminAuth_1.requireAdmin)("drivers.read"), async (req, res) => {
    try {
        const driverId = String(req.params.id);
        const tier = await (0, database_1.queryOne)(`SELECT driver_id, tier, points, rating_avg, accept_percent, cancel_percent,
              rides_completed, offers_received, offers_accepted, offers_timedout,
              driver_cancels, window_start, window_end, at_risk, demote_after,
              demote_pending_tier, updated_at
         FROM driver_tiers WHERE driver_id = $1`, [driverId]);
        const thresholds = await (0, database_1.query)(`SELECT tier, display_name, rank, min_points, min_rating, min_accept_percent,
              max_cancel_percent, commission_percent
         FROM performance_tier_thresholds ORDER BY rank`);
        const history = await (0, database_1.query)(`SELECT old_tier, new_tier, reason, points, created_at
         FROM driver_tier_history WHERE driver_id = $1
        ORDER BY created_at DESC LIMIT 20`, [driverId]);
        res.json({ tier: tier || null, thresholds, history });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/drivers/:id/tier — SUPER-ADMIN tier override with a
// required reason (audited; history row written; thresholds untouched).
router.post("/drivers/:id/tier", (0, adminAuth_1.requireAdmin)("admins.manage"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor || actor.role !== "super_admin") {
            res.status(403).json({ error: "Super Admin only" });
            return;
        }
        const driverId = String(req.params.id);
        const to = String(req.body?.tier || "").toLowerCase();
        const reason = req.body?.reason ? String(req.body.reason).trim() : "";
        const valid = ["bronze", "silver", "gold", "platinum"];
        if (!valid.includes(to)) {
            res.status(400).json({ error: `tier must be one of: ${valid.join(", ")}` });
            return;
        }
        if (reason.length < 3) {
            res.status(400).json({ error: "A reason is required for a tier override" });
            return;
        }
        const driver = await (0, database_1.queryOne)(`SELECT id FROM users WHERE id = $1`, [driverId]);
        if (!driver) {
            res.status(404).json({ error: "Driver not found" });
            return;
        }
        const before = await (0, database_1.queryOne)(`SELECT tier FROM driver_tiers WHERE driver_id = $1`, [driverId]);
        // Upsert + history in one statement each (no transactions needed: an
        // audit row follows regardless, and the next read is consistent).
        await (0, database_1.execute)(`INSERT INTO driver_tiers (driver_id, tier, window_start, window_end)
         VALUES ($1, $2::text, CURRENT_DATE, CURRENT_DATE)
         ON CONFLICT (driver_id) DO UPDATE SET tier = EXCLUDED.tier, updated_at = NOW()`, [driverId, to]);
        await (0, database_1.execute)(`INSERT INTO driver_tier_history (driver_id, old_tier, new_tier, reason, points)
         VALUES ($1, $2, $3, $4, COALESCE((SELECT points FROM driver_tiers WHERE driver_id = $1), 0))`, [driverId, before?.tier || "bronze", to, `admin_override: ${reason}`]);
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "driver.tier_override",
            entityType: "driver_tier",
            entityId: driverId,
            oldValue: { tier: before?.tier || null },
            newValue: { tier: to },
            reason,
        });
        res.json({ driver_id: driverId, tier: to, previous: before?.tier || null });
    }
    catch (err) {
        sendError(res, err);
    }
});
// ── Riders (Phase 2) ──────────────────────────────────────────────────────────
// GET /api/admin/v2/riders — searchable rider list (POPIA: phones masked).
router.get("/riders", (0, adminAuth_1.requireAdmin)("riders.read"), async (req, res) => {
    try {
        const result = await (0, adminRiders_1.listRiders)({
            search: typeof req.query.search === "string" ? req.query.search : "",
            status: typeof req.query.status === "string" ? req.query.status : "",
            limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 50,
            offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
        });
        res.json({ riders: result.rows, total: result.total });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/riders/:id — full profile + stats + notes + history.
// Phone/id_number returned RAW (support needs them); the LIST stays masked,
// and this reveal is audited below — same posture as the driver profile.
router.get("/riders/:id", (0, adminAuth_1.requireAdmin)("riders.read"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const rider = await (0, adminRiders_1.getRider)(String(req.params.id));
        if (!rider) {
            res.status(404).json({ error: "Rider not found" });
            return;
        }
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "rider.reveal",
            entityType: "rider",
            entityId: rider.id,
            newValue: { phone: (0, format_1.maskPhone)(rider.phone) },
            reason: "Profile opened from the console",
        });
        res.json({ rider });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/riders/:id/moderation — suspend/unsuspend/ban/unban.
// Reason REQUIRED to suspend/ban; history + audit + best-effort push notice.
router.post("/riders/:id/moderation", (0, adminAuth_1.requireAdmin)("riders.write"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const riderId = String(req.params.id);
        const to = String(req.body?.status || "").toLowerCase();
        if (!(0, adminRiders_1.isRiderStatus)(to)) {
            res.status(400).json({ error: `status must be one of: ${adminRiders_1.RIDER_STATUSES.join(", ")}` });
            return;
        }
        const reason = req.body?.reason ? String(req.body.reason).trim() : "";
        const until = req.body?.until ? String(req.body.until) : null;
        const result = await (0, adminRiders_1.moderateRider)(riderId, to, actor.email, { reason, until });
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "rider.moderation",
            entityType: "rider",
            entityId: riderId,
            oldValue: { status: result.from },
            newValue: { status: result.to, until },
            reason: reason || null,
        });
        // Best-effort notice — never fails the operator's action.
        if (result.from !== result.to) {
            try {
                await (0, push_1.sendPushToUser)(riderId, {
                    title: to === "active"
                        ? "Your account is active"
                        : to === "suspended"
                            ? "Your account is suspended"
                            : "Your account is banned",
                    body: reason || "Contact support for details.",
                });
            }
            catch { /* push is best-effort */ }
        }
        res.json({ rider_id: riderId, ...result });
    }
    catch (err) {
        if (err instanceof adminRiders_1.RiderModerationError) {
            const status = err.code === "not_found" ? 404 : err.code === "illegal_transition" ? 409 : 400;
            res.status(status).json({ error: err.message, code: err.code, detail: err.detail });
            return;
        }
        sendError(res, err);
    }
});
// POST /api/admin/v2/riders/:id/notes — internal support note (audited).
router.post("/riders/:id/notes", (0, adminAuth_1.requireAdmin)("riders.write"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const note = String(req.body?.note || "").trim();
        if (note.length < 3) {
            res.status(400).json({ error: "A note of at least 3 characters is required" });
            return;
        }
        const rider = await (0, database_1.queryOne)(`SELECT id FROM users WHERE id = $1 AND role = 'passenger'`, [String(req.params.id)]);
        if (!rider) {
            res.status(404).json({ error: "Rider not found" });
            return;
        }
        await (0, adminRiders_1.addRiderNote)(rider.id, note, actor.email);
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "rider.note_add",
            entityType: "rider",
            entityId: rider.id,
            newValue: { note },
        });
        res.status(201).json({ ok: true });
    }
    catch (err) {
        sendError(res, err);
    }
});
// ── Trips & live map (Phase 3) ────────────────────────────────────────────────
// GET /api/admin/v2/trips — searchable/filterable trip list (read-only).
router.get("/trips", (0, adminAuth_1.requireAdmin)("trips.read"), async (req, res) => {
    try {
        const result = await (0, adminTrips_1.listTrips)({
            status: typeof req.query.status === "string" ? req.query.status : "",
            search: typeof req.query.search === "string" ? req.query.search : "",
            from: typeof req.query.from === "string" ? req.query.from : "",
            to: typeof req.query.to === "string" ? req.query.to : "",
            limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 50,
            offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
        });
        res.json({ trips: result.rows, total: result.total });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/trips/stats — dashboard tile (7-day window, configurable).
router.get("/trips/stats", (0, adminAuth_1.requireAdmin)("trips.read"), async (req, res) => {
    try {
        const days = req.query.days ? parseInt(String(req.query.days), 10) : 7;
        res.json({ stats: await (0, adminTrips_1.getTripStats)(days) });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/trips/live — live-map snapshot: online drivers + active rides.
router.get("/trips/live", (0, adminAuth_1.requireAdmin)("trips.read"), async (_req, res) => {
    try {
        res.json(await (0, adminTrips_1.getLiveSnapshot)());
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/trips/:id — one trip + its dispatch timeline. Read-only:
// there is deliberately no refund/adjust action (brief: no money changes).
router.get("/trips/:id", (0, adminAuth_1.requireAdmin)("trips.read"), async (req, res) => {
    try {
        const trip = await (0, adminTrips_1.getTrip)(String(req.params.id));
        if (!trip) {
            res.status(404).json({ error: "Trip not found" });
            return;
        }
        res.json({ trip });
    }
    catch (err) {
        sendError(res, err);
    }
});
// ── Support inbox (Phase 3) ───────────────────────────────────────────────────
// GET /api/admin/v2/tickets — open/pending first, then newest.
router.get("/tickets", (0, adminAuth_1.requireAdmin)("tickets.read"), async (req, res) => {
    try {
        const result = await (0, adminTrips_1.listTickets)({
            status: typeof req.query.status === "string" ? req.query.status : "",
            priority: typeof req.query.priority === "string" ? req.query.priority : "",
            search: typeof req.query.search === "string" ? req.query.search : "",
            limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 50,
            offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
        });
        res.json({ tickets: result.rows, total: result.total });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/tickets/:id — the ticket + full thread.
router.get("/tickets/:id", (0, adminAuth_1.requireAdmin)("tickets.read"), async (req, res) => {
    try {
        const ticket = await (0, adminTrips_1.getTicket)(String(req.params.id));
        if (!ticket) {
            res.status(404).json({ error: "Ticket not found" });
            return;
        }
        res.json({ ticket });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/tickets — open a ticket on a rider's behalf (walk-up,
// call, email). The body becomes message #1 from the acting admin.
router.post("/tickets", (0, adminAuth_1.requireAdmin)("tickets.write"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const subject = String(req.body?.subject || "").trim();
        const body = String(req.body?.body || "").trim();
        if (subject.length < 3 || body.length < 3) {
            res.status(400).json({ error: "subject and body are required (min 3 chars)" });
            return;
        }
        const priority = String(req.body?.priority || "normal");
        if (!["low", "normal", "high", "urgent"].includes(priority)) {
            res.status(400).json({ error: "priority must be low|normal|high|urgent" });
            return;
        }
        const ticket = await (0, adminTrips_1.createTicket)({
            subject, body, priority,
            rider_id: req.body?.rider_id || null,
            driver_id: req.body?.driver_id || null,
            rider_name: req.body?.rider_name || null,
            rider_email: req.body?.rider_email || null,
            rider_phone: req.body?.rider_phone || null,
            ride_id: req.body?.ride_id || null,
        }, actor.email);
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "ticket.create",
            entityType: "support_ticket",
            entityId: ticket.id,
            newValue: { reference: ticket.reference, subject, priority },
        });
        res.status(201).json({ ticket });
    }
    catch (err) {
        sendError(res, err);
    }
});
// PATCH /api/admin/v2/tickets/:id — status/priority/assignee.
router.patch("/tickets/:id", (0, adminAuth_1.requireAdmin)("tickets.write"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const id = String(req.params.id);
        const before = await (0, adminTrips_1.getTicket)(id);
        if (!before) {
            res.status(404).json({ error: "Ticket not found" });
            return;
        }
        const { status, priority, assignee_email } = req.body || {};
        if (status && !["open", "pending", "resolved", "closed"].includes(status)) {
            res.status(400).json({ error: "status must be open|pending|resolved|closed" });
            return;
        }
        if (priority && !["low", "normal", "high", "urgent"].includes(priority)) {
            res.status(400).json({ error: "priority must be low|normal|high|urgent" });
            return;
        }
        const ticket = await (0, adminTrips_1.updateTicket)(id, { status, priority, assignee_email });
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "ticket.update",
            entityType: "support_ticket",
            entityId: id,
            oldValue: { status: before.status, priority: before.priority, assignee: before.assignee_email },
            newValue: { status: ticket?.status, priority: ticket?.priority, assignee: ticket?.assignee_email },
            reason: req.body?.reason ? String(req.body.reason) : null,
        });
        res.json({ ticket });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/tickets/:id/messages — reply or internal note.
router.post("/tickets/:id/messages", (0, adminAuth_1.requireAdmin)("tickets.write"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const id = String(req.params.id);
        const ticket = await (0, adminTrips_1.getTicket)(id);
        if (!ticket) {
            res.status(404).json({ error: "Ticket not found" });
            return;
        }
        const message = String(req.body?.message || "").trim();
        if (message.length < 1) {
            res.status(400).json({ error: "message is required" });
            return;
        }
        const isInternal = req.body?.is_internal === true;
        await (0, adminTrips_1.addTicketMessage)(id, actor.email, message, isInternal);
        await (0, adminAuth_1.writeAudit)(actor, {
            action: isInternal ? "ticket.note" : "ticket.reply",
            entityType: "support_ticket",
            entityId: id,
            newValue: { message },
        });
        res.status(201).json({ ok: true });
    }
    catch (err) {
        sendError(res, err);
    }
});
// ── Messaging campaigns (Phase 4) ─────────────────────────────────────────────
// GET /api/admin/v2/campaigns — newest first.
router.get("/campaigns", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(String(req.query.limit), 100) : 100;
        res.json({ campaigns: await (0, adminMessaging_1.listCampaigns)(limit) });
    }
    catch (err) {
        sendError(res, err);
    }
});
// GET /api/admin/v2/campaigns/:id — one campaign + delivery breakdown.
router.get("/campaigns/:id", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const campaign = await (0, adminMessaging_1.getCampaign)(String(req.params.id));
        if (!campaign) {
            res.status(404).json({ error: "Campaign not found" });
            return;
        }
        res.json({ campaign });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/campaigns — compose a draft (NOT sent yet).
router.post("/campaigns", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const name = String(req.body?.name || "").trim();
        const title = String(req.body?.title || "").trim();
        const body = String(req.body?.body || "").trim();
        const audience = String(req.body?.audience || "riders");
        if (name.length < 3 || title.length < 1 || body.length < 1) {
            res.status(400).json({ error: "name, title and body are required" });
            return;
        }
        if (title.length > 200) {
            res.status(400).json({ error: "title must be 200 chars or fewer" });
            return;
        }
        if (!(0, adminMessaging_1.isCampaignAudience)(audience)) {
            res.status(400).json({ error: `audience must be one of: ${adminMessaging_1.CAMPAIGN_AUDIENCES.join(", ")}` });
            return;
        }
        const campaign = await (0, adminMessaging_1.createCampaign)({ name, title, body, audience }, actor.email);
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "campaign.create",
            entityType: "admin_campaign",
            entityId: campaign.id,
            newValue: { name, title, audience },
        });
        res.status(201).json({ campaign });
    }
    catch (err) {
        sendError(res, err);
    }
});
// POST /api/admin/v2/campaigns/:id/send — fire a draft ONCE. The status flip
// in sendCampaign is the lock; a second click answers 409 with the sent row.
// Fan-out is awaited in batches — this route is intentionally synchronous so
// the operator sees the real delivered/failed counters when it returns.
router.post("/campaigns/:id/send", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const id = String(req.params.id);
        const existing = await (0, adminMessaging_1.getCampaign)(id);
        if (!existing) {
            res.status(404).json({ error: "Campaign not found" });
            return;
        }
        if (existing.status !== "draft") {
            res.status(409).json({ error: `Campaign already ${existing.status}`, campaign: existing });
            return;
        }
        const campaign = await (0, adminMessaging_1.sendCampaign)(id, actor.email);
        if (!campaign) {
            // Someone else won the race between our read and the claim.
            const now = await (0, adminMessaging_1.getCampaign)(id);
            res.status(409).json({ error: "Campaign already sent", campaign: now });
            return;
        }
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "campaign.send",
            entityType: "admin_campaign",
            entityId: id,
            oldValue: { status: "draft" },
            newValue: {
                status: campaign.status,
                audience: campaign.audience,
                recipients: campaign.recipient_count,
                sent: campaign.sent_count,
                failed: campaign.failed_count,
            },
        });
        res.json({ campaign });
    }
    catch (err) {
        sendError(res, err);
    }
});
exports.default = router;
//# sourceMappingURL=adminV2.js.map