"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleError = exports.LEGAL_TRANSITIONS = exports.LIFECYCLE_STATES = void 0;
exports.isLifecycleStatus = isLifecycleStatus;
exports.canTransition = canTransition;
exports.transitionLifecycle = transitionLifecycle;
exports.listDrivers = listDrivers;
exports.getDriverProfile = getDriverProfile;
exports.listOnboardingQueue = listOnboardingQueue;
exports.allRequiredDocsApproved = allRequiredDocsApproved;
exports.listExpiringDocuments = listExpiringDocuments;
exports.getReviewLists = getReviewLists;
// ─────────────────────────────────────────────────────────────────────────────
// adminDrivers — ADMIN V2 Phase 1: the driver lifecycle state machine, the
// onboarding queue, document review, expiring documents and status actions.
//
// STATE MACHINE (server-authoritative; illegal transitions are rejected):
//   REGISTERED → DOCUMENTS_SUBMITTED → UNDER_REVIEW → CHANGES_REQUESTED |
//   APPROVED → ACTIVE ⇄ SUSPENDED → (reinstate) ACTIVE
//   any non-terminal → REJECTED | BLOCKED (terminal)
// SUSPENDED carries an optional end date (suspended_until).
//
// AUDIT GAP (reported in the Phase 0 audit): POST /api/drivers/online sets
// verification_status='approved' on first call with no document gate. The
// lifecycle columns record state NOW; enforcement in the online/offer path
// lands behind the `driver_gate_enabled` flag (default OFF) per the brief.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
exports.LIFECYCLE_STATES = [
    "REGISTERED",
    "DOCUMENTS_SUBMITTED",
    "UNDER_REVIEW",
    "CHANGES_REQUESTED",
    "APPROVED",
    "ACTIVE",
    "REJECTED",
    "SUSPENDED",
    "BLOCKED",
];
function isLifecycleStatus(v) {
    return typeof v === "string" && exports.LIFECYCLE_STATES.includes(v);
}
/** Legal transitions. Anything not listed here is a 409, server-side. */
exports.LEGAL_TRANSITIONS = {
    REGISTERED: ["DOCUMENTS_SUBMITTED", "REJECTED", "BLOCKED"],
    DOCUMENTS_SUBMITTED: ["UNDER_REVIEW", "CHANGES_REQUESTED", "REJECTED", "BLOCKED"],
    UNDER_REVIEW: ["CHANGES_REQUESTED", "APPROVED", "REJECTED", "BLOCKED"],
    CHANGES_REQUESTED: ["DOCUMENTS_SUBMITTED", "UNDER_REVIEW", "REJECTED", "BLOCKED"],
    APPROVED: ["ACTIVE", "REJECTED", "BLOCKED"],
    ACTIVE: ["SUSPENDED", "BLOCKED"],
    REJECTED: [],
    SUSPENDED: ["ACTIVE", "BLOCKED"],
    BLOCKED: [],
};
function canTransition(from, to) {
    if (!isLifecycleStatus(from) || !isLifecycleStatus(to))
        return false;
    return exports.LEGAL_TRANSITIONS[from].includes(to);
}
/**
 * Move a driver to a new lifecycle state. Writes the history row and the
 * profile columns in ONE transaction. Throws on illegal transitions (the
 * route maps that to 409) and on unknown drivers (404).
 */
async function transitionLifecycle(driverId, to, actorEmail, opts = {}) {
    return (0, database_1.withTransaction)(async (client) => {
        const cur = await client.query(`SELECT lifecycle_status FROM driver_profiles WHERE user_id = $1 FOR UPDATE`, [driverId]);
        if (cur.rowCount === 0)
            throw new LifecycleError("not_found", "Driver not found");
        const from = String(cur.rows[0].lifecycle_status || "ACTIVE");
        if (from === to)
            return { from: from, to };
        if (!canTransition(from, to)) {
            throw new LifecycleError("illegal_transition", `Cannot go from ${from} to ${to}`, { from, to, allowed: isLifecycleStatus(from) ? exports.LEGAL_TRANSITIONS[from] : [] });
        }
        await client.query(`UPDATE driver_profiles
          SET lifecycle_status = $2::varchar,
              lifecycle_reason = $3,
              lifecycle_updated_at = NOW(),
              suspended_until = CASE WHEN $2::varchar = 'SUSPENDED' THEN $4::timestamptz ELSE NULL END,
              updated_at = NOW()
        WHERE user_id = $1`, [driverId, to, opts.reason?.trim() || null, opts.endsAt || null]);
        await client.query(`INSERT INTO driver_status_history (driver_id, from_status, to_status, reason, actor_email, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`, [driverId, from, to, opts.reason?.trim() || null, actorEmail, opts.endsAt || null]);
        // A suspended driver must not stay online: flip is_online when suspending
        // or blocking (defensive; the flag-gated dispatch rule comes later).
        if (to === "SUSPENDED" || to === "BLOCKED" || to === "REJECTED") {
            await client.query(`UPDATE driver_profiles SET is_online = FALSE, status = 'offline'
          WHERE user_id = $1 AND is_online = TRUE`, [driverId]);
        }
        return { from: from, to };
    });
}
class LifecycleError extends Error {
    code;
    detail;
    constructor(code, message, detail) {
        super(message);
        this.code = code;
        this.detail = detail;
    }
}
exports.LifecycleError = LifecycleError;
const DRIVER_SORT_COLUMNS = {
    name: "u.full_name",
    created: "u.created_at",
    updated: "dp.updated_at",
    rating: "dp.rating_avg",
    status: "dp.lifecycle_status",
};
/**
 * Driver list with search (name/phone/email/plate/licence), lifecycle and
 * online filters, sort + pagination. POPIA: the raw phone/id_number are
 * returned here (list endpoints MASK them — the route layer does that).
 */
async function listDrivers(q) {
    const where = [`u.role = 'driver'`];
    const params = [];
    const add = (sql, v) => {
        params.push(v);
        where.push(sql.replace("?", `$${params.length}`));
    };
    const s = (q.search || "").trim();
    if (s) {
        // Five ILIKE predicates, five $n params (the add() helper handles one).
        const like = `%${s}%`;
        params.push(like, like, like, like, like);
        where.push(`(u.full_name ILIKE $${params.length - 4} OR u.email ILIKE $${params.length - 3}
        OR u.phone ILIKE $${params.length - 2} OR dp.license_plate ILIKE $${params.length - 1}
        OR dp.license_number ILIKE $${params.length})`);
    }
    if (q.status)
        add("dp.lifecycle_status = ?", q.status);
    if (q.online === true)
        where.push("dp.is_online = TRUE");
    if (q.online === false)
        where.push("dp.is_online = FALSE");
    if (q.city)
        add("dp.vehicle_color ILIKE ?", `%${q.city}%`); // placeholder until city lands
    if (q.tier)
        add("dp.vehicle_tier = ?", q.tier);
    if (q.vehicleType)
        add("dp.vehicle_category = ?", q.vehicleType);
    const sortCol = DRIVER_SORT_COLUMNS[q.sort || "created"] || DRIVER_SORT_COLUMNS.created;
    const order = q.order === "asc" ? "ASC" : "DESC";
    const limit = Math.min(Math.max(q.limit || 50, 1), 200);
    const offset = Math.max(q.offset || 0, 0);
    const from = `FROM users u
      LEFT JOIN driver_profiles dp ON dp.user_id = u.id`;
    const rows = await (0, database_1.query)(`SELECT u.id AS driver_id, u.full_name, u.email, u.phone, u.created_at,
            dp.status AS online_status, dp.is_online, dp.lifecycle_status,
            dp.vehicle_make, dp.vehicle_model, dp.vehicle_year, dp.license_plate,
            dp.vehicle_category, dp.vehicle_tier, dp.rating_avg,
            dp.current_lat, dp.current_lng, dp.last_location_at, dp.last_heartbeat_at,
            dp.suspended_until
     ${from}
     WHERE ${where.join(" AND ")}
     ORDER BY ${sortCol} ${order} NULLS LAST
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    const total = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS count ${from} WHERE ${where.join(" AND ")}`, params);
    return { rows, total: total?.count ?? rows.length };
}
/** Full profile for one driver: person + vehicle + lifecycle + tier + docs. */
async function getDriverProfile(driverId) {
    const row = await (0, database_1.queryOne)(`SELECT u.id AS driver_id, u.full_name, u.email, u.phone, u.id_number,
            u.profile_photo_url, u.created_at,
            dp.status AS online_status, dp.is_online, dp.lifecycle_status,
            dp.lifecycle_reason, dp.lifecycle_updated_at, dp.suspended_until,
            dp.license_number, dp.vehicle_make, dp.vehicle_model, dp.vehicle_year,
            dp.vehicle_color, dp.body_type, dp.vehicle_category, dp.vehicle_tier,
            dp.license_plate, dp.rating_avg, dp.cancellations_count,
            dp.current_lat, dp.current_lng, dp.last_location_at, dp.last_heartbeat_at,
            dt.tier AS performance_tier, dt.points, dt.at_risk, dt.demote_after
       FROM users u
       LEFT JOIN driver_profiles dp ON dp.user_id = u.id
       LEFT JOIN driver_tiers dt ON dt.driver_id = u.id
      WHERE u.id = $1 AND u.role = 'driver'`, [driverId]);
    if (!row)
        return null;
    const [docs, history] = await Promise.all([
        (0, database_1.query)(`SELECT id, doc_type, file_name, status, note, expires_at, created_at, reviewed_at
         FROM driver_documents WHERE driver_id = $1 ORDER BY created_at DESC`, [driverId]),
        (0, database_1.query)(`SELECT from_status, to_status, reason, actor_email, ends_at, created_at
         FROM driver_status_history WHERE driver_id = $1
        ORDER BY created_at DESC LIMIT 50`, [driverId]),
    ]);
    return { ...row, documents: docs, status_history: history };
}
/**
 * Onboarding queue: drivers not yet ACTIVE, OLDEST first, with a waiting-time
 * indicator (seconds since the newest pending document arrived).
 */
async function listOnboardingQueue(limit = 100) {
    return (0, database_1.query)(`SELECT u.id AS driver_id, u.full_name, u.email, u.phone,
            dp.lifecycle_status, dp.lifecycle_updated_at,
            COUNT(d.id) FILTER (WHERE d.status = 'pending_review')::int AS pending_docs,
            COUNT(d.id) FILTER (WHERE d.status = 'approved')::int AS approved_docs,
            COUNT(d.id) FILTER (WHERE d.status = 'rejected')::int AS rejected_docs,
            MIN(d.created_at) FILTER (WHERE d.status = 'pending_review') AS waiting_since,
            EXTRACT(EPOCH FROM (NOW() - MIN(d.created_at) FILTER (WHERE d.status = 'pending_review')))::int AS waiting_seconds
       FROM users u
       JOIN driver_profiles dp ON dp.user_id = u.id
       LEFT JOIN driver_documents d ON d.driver_id = u.id
      WHERE u.role = 'driver'
        AND dp.lifecycle_status NOT IN ('ACTIVE', 'BLOCKED', 'REJECTED')
      GROUP BY u.id, u.full_name, u.email, u.phone, dp.lifecycle_status, dp.lifecycle_updated_at
      HAVING COUNT(d.id) FILTER (WHERE d.status = 'pending_review') > 0
          OR dp.lifecycle_status IN ('REGISTERED', 'DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED')
      ORDER BY waiting_since ASC NULLS LAST, u.created_at ASC
      LIMIT $1`, [Math.min(Math.max(limit, 1), 500)]);
}
/** Are all REQUIRED documents approved for this driver? (Configurable list.) */
async function allRequiredDocsApproved(driverId) {
    const required = await (0, database_1.query)(`SELECT doc_type FROM admin_required_docs WHERE active = TRUE ORDER BY sort_order`);
    const approved = await (0, database_1.query)(`SELECT DISTINCT doc_type FROM driver_documents
      WHERE driver_id = $1 AND status = 'approved'
        AND (expires_at IS NULL OR expires_at > NOW())`, [driverId]);
    const have = new Set(approved.map((r) => r.doc_type));
    const missing = required.map((r) => r.doc_type).filter((t) => !have.has(t));
    return { ok: missing.length === 0 && required.length > 0, missing };
}
/** Documents expiring within `days` (default 30), soonest first. */
async function listExpiringDocuments(days = 30) {
    return (0, database_1.query)(`SELECT d.id, d.driver_id, d.doc_type, d.expires_at, d.last_reminder_at,
            u.full_name, u.email, u.phone
       FROM driver_documents d
       JOIN users u ON u.id = d.driver_id
      WHERE d.expires_at IS NOT NULL
        AND d.expires_at BETWEEN NOW() AND NOW() + ($1 || ' days')::interval
      ORDER BY d.expires_at ASC`, [String(Math.min(Math.max(days, 1), 365))]);
}
/** Doc rows + required list + reject reasons (for the review screens). */
async function getReviewLists() {
    const [required, rejectReasons] = await Promise.all([
        (0, database_1.query)(`SELECT doc_type, label, sort_order FROM admin_required_docs WHERE active = TRUE ORDER BY sort_order`),
        (0, database_1.query)(`SELECT code, label, sort_order FROM admin_reject_reasons WHERE active = TRUE ORDER BY sort_order`),
    ]);
    return { required, rejectReasons };
}
//# sourceMappingURL=adminDrivers.js.map