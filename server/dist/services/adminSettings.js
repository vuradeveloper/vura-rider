"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAllFlags = readAllFlags;
exports.writeFlag = writeFlag;
exports.listRequiredDocs = listRequiredDocs;
exports.listRejectReasons = listRejectReasons;
exports.setRequiredDoc = setRequiredDoc;
exports.setRejectReason = setRejectReason;
exports.getSystemStatus = getSystemStatus;
// ─────────────────────────────────────────────────────────────────────────────
// adminSettings — ADMIN V2 Phase 5: feature-flag reads/writes through the
// permission matrix, the required-docs/reject-reasons settings, and the
// system status snapshot. The RC4 three flags live in services/featureFlags;
// this wraps them with the v2 permission + audit contract, adds rider_gate
// (006), and serves the settings tables created by 005.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const featureFlags_1 = require("./featureFlags");
const adminAuth_1 = require("./adminAuth");
/** Every flag the console can display; rider_gate rides alongside the RC4 three. */
async function readAllFlags() {
    const f = await (0, featureFlags_1.readFeatures)();
    let riderGate = { enabled: false, note: "table missing (migration 006 not applied)" };
    try {
        const row = await (0, database_1.queryOne)(`SELECT value FROM app_config WHERE key = 'rider_gate'`);
        if (row)
            riderGate = row.value;
    }
    catch (err) {
        if (!(0, database_1.isMissingRelation)(err))
            throw err;
    }
    // FLAT: { matching: {...}, destination: {...}, performance_tier: {...},
    //         rider_gate: {...}, server_build, recent_matching_paths } so callers
    // can index by key (writeFlag's audit does before[key]/after[key]).
    return {
        ...f.flags,
        rider_gate: riderGate,
        server_build: f.server_build,
        recent_matching_paths: f.recent_matching_paths,
    };
}
/**
 * Update one RC4 flag with audit. rider_gate is deliberately NOT writable
 * here: flipping a booking gate is a deploy-runbook action (SQL), not a
 * console button — the brief keeps high-blast-radius switches off.
 */
async function writeFlag(key, changes, actor) {
    if (!featureFlags_1.FEATURE_KEYS.includes(key)) {
        throw new Error(`Unknown feature key: ${key}`);
    }
    const before = await readAllFlags();
    await (0, featureFlags_1.updateFeature)(key, changes, actor.email); // validates + writes + caches off
    const after = await readAllFlags();
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "feature.update",
        entityType: "app_config",
        entityId: key,
        oldValue: before[key],
        newValue: after[key],
    });
    return after;
}
// ── Settings tables ───────────────────────────────────────────────────────────
async function listRequiredDocs() {
    return (0, database_1.query)(`SELECT doc_type, label, active, sort_order FROM admin_required_docs ORDER BY sort_order`);
}
async function listRejectReasons() {
    return (0, database_1.query)(`SELECT code, label, active, sort_order FROM admin_reject_reasons ORDER BY sort_order`);
}
async function setRequiredDoc(docType, patch, actor) {
    const before = await (0, database_1.queryOne)(`SELECT * FROM admin_required_docs WHERE doc_type = $1`, [docType]);
    if (!before)
        throw new Error(`Unknown doc_type: ${docType}`);
    await (0, database_1.execute)(`UPDATE admin_required_docs
        SET label = COALESCE($2, label), active = COALESCE($3, active),
            sort_order = COALESCE($4, sort_order)
      WHERE doc_type = $1`, [docType, patch.label ?? null, patch.active ?? null, patch.sort_order ?? null]);
    const after = await (0, database_1.queryOne)(`SELECT * FROM admin_required_docs WHERE doc_type = $1`, [docType]);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "settings.required_doc_update",
        entityType: "admin_required_docs",
        entityId: docType,
        oldValue: before,
        newValue: after,
    });
    return after;
}
async function setRejectReason(code, patch, actor) {
    const before = await (0, database_1.queryOne)(`SELECT * FROM admin_reject_reasons WHERE code = $1`, [code]);
    if (!before)
        throw new Error(`Unknown code: ${code}`);
    await (0, database_1.execute)(`UPDATE admin_reject_reasons
        SET label = COALESCE($2, label), active = COALESCE($3, active),
            sort_order = COALESCE($4, sort_order)
      WHERE code = $1`, [code, patch.label ?? null, patch.active ?? null, patch.sort_order ?? null]);
    const after = await (0, database_1.queryOne)(`SELECT * FROM admin_reject_reasons WHERE code = $1`, [code]);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "settings.reject_reason_update",
        entityType: "admin_reject_reasons",
        entityId: code,
        oldValue: before,
        newValue: after,
    });
    return after;
}
// ── System status ─────────────────────────────────────────────────────────────
/**
 * Ops status snapshot: DB reachable, migrations applied, feature flags,
 * fleet counts and admin-table health. Read-only; safe to poll.
 */
async function getSystemStatus() {
    const dbOk = !!(await (0, database_1.queryOne)(`SELECT 'ok' AS ok`));
    let migrations = [];
    try {
        migrations = (await (0, database_1.query)(`SELECT filename FROM schema_migrations ORDER BY filename`)).map((r) => r.filename);
    }
    catch (err) {
        if (!(0, database_1.isMissingRelation)(err))
            throw err;
    }
    const counts = await (0, database_1.queryOne)(`SELECT
       (SELECT COUNT(*) FROM users WHERE role = 'driver')::int AS drivers,
       (SELECT COUNT(*) FROM driver_profiles WHERE is_online = TRUE)::int AS drivers_online,
       (SELECT COUNT(*) FROM users WHERE role IN ('passenger','rider'))::int AS riders,
       (SELECT COUNT(*) FROM rides WHERE created_at >= CURRENT_DATE)::int AS rides_today,
       (SELECT COUNT(*) FROM rides WHERE status IN ('searching','matched','accepted','in_progress'))::int AS rides_active,
       (SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','pending'))::int AS tickets_open,
       (SELECT COUNT(*) FROM driver_documents WHERE status = 'pending_review')::int AS docs_pending,
       (SELECT COUNT(*) FROM admin_users WHERE disabled = FALSE)::int AS admins`);
    return {
        db_ok: dbOk,
        server_time: new Date().toISOString(),
        migrations_applied: migrations,
        flags: await readAllFlags(),
        counts,
    };
}
//# sourceMappingURL=adminSettings.js.map