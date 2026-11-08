"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportError = exports.REFUND_STATUSES = exports.LOST_ITEM_STATUSES = exports.DISPUTE_STATUSES = void 0;
exports.isReportId = isReportId;
exports.ensureReportSchema = ensureReportSchema;
exports.listDisputes = listDisputes;
exports.getDispute = getDispute;
exports.updateDispute = updateDispute;
exports.listLostItems = listLostItems;
exports.getLostItem = getLostItem;
exports.updateLostItem = updateLostItem;
const database_1 = require("../config/database");
/**
 * Admin support queue: disputes, refund requests and lost-item reports.
 *
 * Riders and drivers already write these rows (routes/disputes.ts), but until
 * now nothing in the admin console could read them. This service is deliberately
 * read/triage-only: it can record a decision and a Paystack reference, but it
 * never moves money. Refund execution stays an operator/Paystack action.
 */
exports.DISPUTE_STATUSES = ["open", "in_review", "resolved", "declined"];
exports.LOST_ITEM_STATUSES = ["reported", "in_review", "resolved", "closed"];
exports.REFUND_STATUSES = ["pending", "approved", "declined", "refunded"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class ReportError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.name = "ReportError";
        this.statusCode = statusCode;
    }
}
exports.ReportError = ReportError;
function isReportId(id) {
    return UUID_RE.test(id);
}
function clampLimit(value, fallback = 60) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return fallback;
    return Math.min(100, Math.floor(n));
}
function clampOffset(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    return Math.floor(n);
}
function cleanText(value, max = 4000) {
    if (value === undefined)
        return null;
    if (value === null)
        return null;
    const s = String(value).trim();
    if (!s)
        return null;
    if (s.length > max)
        throw new ReportError(`Text is too long (max ${max} characters).`);
    return s;
}
function isOneOf(value, allowed) {
    return typeof value === "string" && allowed.includes(value);
}
/**
 * Idempotent boot/read-time migration. Production does not run a migration
 * tool, so the queue's additive columns travel here with the code.
 *
 * The promise is cached so a queue request does not replay a dozen DDL
 * statements on every list/detail call. A failure clears the cache so the next
 * request can retry after a transient database error.
 */
let schemaPromise = null;
function ensureReportSchema() {
    if (!schemaPromise) {
        schemaPromise = createReportSchema().catch((err) => {
            schemaPromise = null;
            throw err;
        });
    }
    return schemaPromise;
}
async function createReportSchema() {
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS disputes (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      user_id UUID NOT NULL REFERENCES users(id),
      type VARCHAR(50) NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'open',
      resolution TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS admin_note TEXT`);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20)`);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS refund_reference VARCHAR(120)`);
    await (0, database_1.execute)(`ALTER TABLE disputes ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2)`);
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS lost_item_reports (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      user_id UUID NOT NULL REFERENCES users(id),
      item_name VARCHAR(255) NOT NULL,
      item_description TEXT,
      driver_contacted BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'reported',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await (0, database_1.execute)(`ALTER TABLE lost_item_reports ADD COLUMN IF NOT EXISTS admin_note TEXT`);
    await (0, database_1.execute)(`ALTER TABLE lost_item_reports ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
    await (0, database_1.execute)(`ALTER TABLE lost_item_reports ADD COLUMN IF NOT EXISTS resolution TEXT`);
    await (0, database_1.execute)(`ALTER TABLE lost_item_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`);
    await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS idx_disputes_status_created ON disputes (status, created_at DESC)`);
    await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS idx_disputes_type_status ON disputes (type, status)`);
    await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS idx_lost_items_status_created ON lost_item_reports (status, created_at DESC)`);
}
function disputeWhere(filters, includeStatus) {
    const where = [];
    const values = [];
    const add = (fragment, value) => {
        values.push(value);
        where.push(fragment.replace("$?", `$${values.length}`));
    };
    if (filters.type)
        add("d.type = $?", filters.type);
    if (filters.excludeType)
        add("d.type <> $?", filters.excludeType);
    if (includeStatus && filters.status && filters.status !== "all") {
        if (filters.status === "active") {
            where.push("d.status IN ('open','in_review')");
        }
        else if (filters.status === "done") {
            where.push("d.status IN ('resolved','declined')");
        }
        else if (isOneOf(filters.status, exports.DISPUTE_STATUSES)) {
            add("d.status = $?", filters.status);
        }
        else {
            throw new ReportError("Unknown dispute status filter.");
        }
    }
    const search = String(filters.search || "").trim();
    if (search) {
        values.push(`%${search}%`);
        const p = `$${values.length}`;
        where.push(`(
      d.reason ILIKE ${p} OR d.description ILIKE ${p} OR
      u.full_name ILIKE ${p} OR u.email ILIKE ${p} OR
      d.id::text ILIKE ${p} OR d.ride_id::text ILIKE ${p} OR
      r.pickup_address ILIKE ${p} OR r.destination_address ILIKE ${p}
    )`);
    }
    return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
}
const DISPUTE_SELECT = `
  SELECT d.id, d.ride_id, d.user_id, d.type, d.reason, d.description, d.status,
         d.resolution, d.admin_note, d.assigned_to, d.refund_status,
         d.refund_reference, d.refund_amount, d.created_at, d.updated_at, d.resolved_at,
         u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone,
         CASE WHEN u.role = 'driver' OR dp.user_id IS NOT NULL THEN 'driver' ELSE 'rider' END AS user_role,
         r.pickup_address, r.destination_address, r.status AS ride_status,
         r.estimated_fare, r.actual_fare, r.payment_method, r.payment_status,
         r.created_at AS ride_created_at,
         du.full_name AS driver_name, dpd.license_plate AS driver_plate,
         pay.reference AS payment_reference, pay.amount AS payment_amount,
         pay.status AS payment_status_label
    FROM disputes d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN driver_profiles dp ON dp.user_id = u.id
    LEFT JOIN rides r ON r.id = d.ride_id
    LEFT JOIN users du ON du.id = r.driver_id
    LEFT JOIN driver_profiles dpd ON dpd.user_id = r.driver_id
    LEFT JOIN LATERAL (
      SELECT p.reference, p.amount, p.status
        FROM payments p
       WHERE p.ride_id = d.ride_id
       ORDER BY p.created_at DESC
       LIMIT 1
    ) pay ON TRUE
`;
async function listDisputes(filters, opts = {}) {
    await ensureReportSchema();
    const limit = clampLimit(opts.limit);
    const offset = clampOffset(opts.offset);
    const filtered = disputeWhere(filters, true);
    const rows = await (0, database_1.query)(`${DISPUTE_SELECT}
     ${filtered.sql}
     ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
              d.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`, filtered.values);
    const aggregate = disputeWhere(filters, false);
    const countRows = await (0, database_1.query)(`SELECT COALESCE(d.status, 'open') AS status, COUNT(*)::int AS count
       FROM disputes d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN rides r ON r.id = d.ride_id
       ${aggregate.sql}
      GROUP BY COALESCE(d.status, 'open')`, aggregate.values);
    const counts = {
        open: 0,
        in_review: 0,
        resolved: 0,
        declined: 0,
        total: 0,
    };
    for (const row of countRows) {
        const status = String(row.status || "open");
        counts[status] = Number(row.count) || 0;
        counts.total += Number(row.count) || 0;
    }
    return { disputes: rows, total: counts.total, counts };
}
async function getDispute(id) {
    if (!isReportId(id))
        return null;
    await ensureReportSchema();
    return (0, database_1.queryOne)(`${DISPUTE_SELECT} WHERE d.id = $1`, [id]);
}
async function updateDispute(id, patch, opts = {}) {
    const before = await getDispute(id);
    if (!before)
        return null;
    if (opts.requireRefund && before.type !== "refund") {
        throw new ReportError("This report is not a refund request.", 400);
    }
    const sets = [];
    const values = [];
    const push = (column, value) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
    };
    let nextStatus = String(before.status || "open");
    if (patch.status !== undefined) {
        if (!isOneOf(patch.status, exports.DISPUTE_STATUSES)) {
            throw new ReportError("Unknown report status.");
        }
        nextStatus = patch.status;
    }
    let nextRefundStatus = before.refund_status == null ? null : String(before.refund_status);
    if (patch.refund_status !== undefined) {
        if (before.type !== "refund") {
            throw new ReportError("Refund fields only apply to refund requests.");
        }
        if (patch.refund_status === null || patch.refund_status === "") {
            nextRefundStatus = null;
        }
        else if (!isOneOf(patch.refund_status, exports.REFUND_STATUSES)) {
            throw new ReportError("Unknown refund status.");
        }
        else {
            nextRefundStatus = patch.refund_status;
        }
        push("refund_status", nextRefundStatus);
    }
    // A refund decision implies the report decision when the caller did not send
    // an explicit status: refunded -> resolved, declined -> declined. An approval
    // moves an untouched open report into review without closing it.
    if (patch.status === undefined && patch.refund_status !== undefined) {
        if (nextRefundStatus === "refunded")
            nextStatus = "resolved";
        if (nextRefundStatus === "declined")
            nextStatus = "declined";
        if (nextRefundStatus === "approved" && nextStatus === "open")
            nextStatus = "in_review";
    }
    if (patch.status !== undefined || nextStatus !== String(before.status || "open")) {
        push("status", nextStatus);
    }
    if (patch.resolution !== undefined)
        push("resolution", cleanText(patch.resolution));
    if (patch.admin_note !== undefined)
        push("admin_note", cleanText(patch.admin_note));
    if (patch.assigned_to !== undefined)
        push("assigned_to", cleanText(patch.assigned_to, 200));
    const nextResolution = patch.resolution !== undefined ? cleanText(patch.resolution) : before.resolution;
    if ((nextStatus === "resolved" || nextStatus === "declined") && !nextResolution) {
        throw new ReportError("Add a resolution message before closing the report.");
    }
    if (patch.refund_reference !== undefined) {
        if (before.type !== "refund")
            throw new ReportError("Refund fields only apply to refund requests.");
        push("refund_reference", cleanText(patch.refund_reference, 120));
    }
    let nextRefundAmount = before.refund_amount == null ? null : Number(before.refund_amount);
    if (patch.refund_amount !== undefined) {
        if (before.type !== "refund")
            throw new ReportError("Refund fields only apply to refund requests.");
        if (patch.refund_amount === null || patch.refund_amount === "") {
            nextRefundAmount = null;
        }
        else {
            const amount = Number(patch.refund_amount);
            if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
                throw new ReportError("Enter a valid refund amount.");
            }
            nextRefundAmount = Math.round(amount * 100) / 100;
        }
        push("refund_amount", nextRefundAmount);
    }
    if (nextRefundStatus === "approved" || nextRefundStatus === "refunded") {
        const fallback = Number(before.payment_amount || 0);
        if (nextRefundAmount == null && fallback > 0) {
            nextRefundAmount = fallback;
            push("refund_amount", nextRefundAmount);
        }
        if (nextRefundAmount == null || nextRefundAmount <= 0) {
            throw new ReportError("Enter the refund amount before approving it.");
        }
    }
    if (nextRefundStatus === "refunded") {
        const reference = patch.refund_reference !== undefined
            ? cleanText(patch.refund_reference, 120)
            : before.refund_reference;
        if (!reference) {
            throw new ReportError("Add the Paystack refund reference before marking it refunded.");
        }
    }
    if (nextStatus === "resolved" || nextStatus === "declined") {
        sets.push("resolved_at = NOW()");
    }
    else if (nextStatus === "open" || nextStatus === "in_review") {
        sets.push("resolved_at = NULL");
    }
    if (sets.length > 0) {
        sets.push("updated_at = NOW()");
        values.push(id);
        const updated = await (0, database_1.queryOne)(`UPDATE disputes SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id`, values);
        if (!updated)
            return null;
    }
    return getDispute(id);
}
function lostItemWhere(filters, includeStatus) {
    const where = [];
    const values = [];
    const add = (fragment, value) => {
        values.push(value);
        where.push(fragment.replace("$?", `$${values.length}`));
    };
    if (includeStatus && filters.status && filters.status !== "all") {
        if (filters.status === "active") {
            where.push("l.status IN ('reported','in_review')");
        }
        else if (filters.status === "done") {
            where.push("l.status IN ('resolved','closed')");
        }
        else if (isOneOf(filters.status, exports.LOST_ITEM_STATUSES)) {
            add("l.status = $?", filters.status);
        }
        else {
            throw new ReportError("Unknown lost-item status filter.");
        }
    }
    const search = String(filters.search || "").trim();
    if (search) {
        values.push(`%${search}%`);
        const p = `$${values.length}`;
        where.push(`(
      l.item_name ILIKE ${p} OR l.item_description ILIKE ${p} OR
      u.full_name ILIKE ${p} OR u.email ILIKE ${p} OR
      l.id::text ILIKE ${p} OR l.ride_id::text ILIKE ${p} OR
      r.pickup_address ILIKE ${p} OR r.destination_address ILIKE ${p}
    )`);
    }
    return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
}
const LOST_ITEM_SELECT = `
  SELECT l.id, l.ride_id, l.user_id, l.item_name, l.item_description,
         l.driver_contacted, l.status, l.admin_note, l.assigned_to,
         l.resolution, l.created_at, l.updated_at, l.resolved_at,
         u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone,
         CASE WHEN u.role = 'driver' OR dp.user_id IS NOT NULL THEN 'driver' ELSE 'rider' END AS user_role,
         r.pickup_address, r.destination_address, r.status AS ride_status,
         r.estimated_fare, r.actual_fare, r.payment_method, r.payment_status,
         r.created_at AS ride_created_at,
         du.full_name AS driver_name, dpd.license_plate AS driver_plate,
         pay.reference AS payment_reference, pay.amount AS payment_amount,
         pay.status AS payment_status_label
    FROM lost_item_reports l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN driver_profiles dp ON dp.user_id = u.id
    LEFT JOIN rides r ON r.id = l.ride_id
    LEFT JOIN users du ON du.id = r.driver_id
    LEFT JOIN driver_profiles dpd ON dpd.user_id = r.driver_id
    LEFT JOIN LATERAL (
      SELECT p.reference, p.amount, p.status
        FROM payments p
       WHERE p.ride_id = l.ride_id
       ORDER BY p.created_at DESC
       LIMIT 1
    ) pay ON TRUE
`;
async function listLostItems(filters, opts = {}) {
    await ensureReportSchema();
    const limit = clampLimit(opts.limit);
    const offset = clampOffset(opts.offset);
    const filtered = lostItemWhere(filters, true);
    const rows = await (0, database_1.query)(`${LOST_ITEM_SELECT}
     ${filtered.sql}
     ORDER BY CASE l.status WHEN 'reported' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
              l.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`, filtered.values);
    const aggregate = lostItemWhere(filters, false);
    const countRows = await (0, database_1.query)(`SELECT COALESCE(l.status, 'reported') AS status, COUNT(*)::int AS count
       FROM lost_item_reports l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN rides r ON r.id = l.ride_id
       ${aggregate.sql}
      GROUP BY COALESCE(l.status, 'reported')`, aggregate.values);
    const counts = {
        reported: 0,
        in_review: 0,
        resolved: 0,
        closed: 0,
        total: 0,
    };
    for (const row of countRows) {
        const status = String(row.status || "reported");
        counts[status] = Number(row.count) || 0;
        counts.total += Number(row.count) || 0;
    }
    return { reports: rows, total: counts.total, counts };
}
async function getLostItem(id) {
    if (!isReportId(id))
        return null;
    await ensureReportSchema();
    return (0, database_1.queryOne)(`${LOST_ITEM_SELECT} WHERE l.id = $1`, [id]);
}
async function updateLostItem(id, patch) {
    const before = await getLostItem(id);
    if (!before)
        return null;
    const sets = [];
    const values = [];
    const push = (column, value) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
    };
    let nextStatus = String(before.status || "reported");
    if (patch.status !== undefined) {
        if (!isOneOf(patch.status, exports.LOST_ITEM_STATUSES)) {
            throw new ReportError("Unknown lost-item status.");
        }
        nextStatus = patch.status;
        push("status", nextStatus);
    }
    if (patch.resolution !== undefined)
        push("resolution", cleanText(patch.resolution));
    if (patch.admin_note !== undefined)
        push("admin_note", cleanText(patch.admin_note));
    if (patch.assigned_to !== undefined)
        push("assigned_to", cleanText(patch.assigned_to, 200));
    if (patch.driver_contacted !== undefined) {
        push("driver_contacted", patch.driver_contacted === true);
    }
    const nextResolution = patch.resolution !== undefined ? cleanText(patch.resolution) : before.resolution;
    if ((nextStatus === "resolved" || nextStatus === "closed") && !nextResolution) {
        throw new ReportError("Add a resolution message before closing the report.");
    }
    if (nextStatus === "resolved" || nextStatus === "closed") {
        sets.push("resolved_at = NOW()");
    }
    else {
        sets.push("resolved_at = NULL");
    }
    if (sets.length > 0) {
        sets.push("updated_at = NOW()");
        values.push(id);
        const updated = await (0, database_1.queryOne)(`UPDATE lost_item_reports SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id`, values);
        if (!updated)
            return null;
    }
    return getLostItem(id);
}
//# sourceMappingURL=adminReports.js.map