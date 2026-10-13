"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUPLICATE_PENDING_PRECHECK_SQL = exports.MIGRATION_ORDER = void 0;
exports.migrationsDir = migrationsDir;
exports.splitStatements = splitStatements;
exports.runMigrationsOnBoot = runMigrationsOnBoot;
// ─────────────────────────────────────────────────────────────────────────────
// MIGRATE ON BOOT — the server applies its own additive migrations.
//
// WHY: the deploy contract is "git pull + eb deploy". Until now the four
// module migrations (001 → 001b → 002 → 003) were a manual psql step, so a
// fresh database stayed at "feature off" forever unless someone ran SQL.
//
// CONTRACT (RC4 brief):
//   • RUN_MIGRATIONS_ON_BOOT, default FALSE. One deploy with it true, read the
//     summary line, set it back to false.
//   • schema_migrations records each file exactly once.
//   • A pg advisory lock (try-lock loop — never hangs boot) makes concurrent
//     boots idempotent: whoever does not get the lock skips and reports.
//   • Order: 001, 001b, 002, 003. Transactional files run inside BEGIN/COMMIT.
//     001b runs OUTSIDE any transaction (CREATE INDEX CONCURRENTLY) and starts
//     with its duplicate-pending-offer PRE-CHECK: duplicates ⇒ log the
//     offending driver ids, SKIP 001b (not recorded → retried next boot),
//     keep serving.
//   • A failure rolls back THAT migration, logs the exact error, records the
//     failure and continues — this function never throws and never crashes
//     boot. Features whose config row/table is missing read as OFF everywhere
//     (config.ts falls back to defaults; routes answer enabled:false).
//   • One summary line: applied / skipped / failed.
// ─────────────────────────────────────────────────────────────────────────────
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const database_1 = __importDefault(require("../config/database"));
exports.MIGRATION_ORDER = [
    "001_h3_driver_index.sql",
    "001b_offer_unique_index.sql",
    "002_destination_mode.sql",
    "003_performance_tier.sql",
    "004_admin_v2.sql",
    "005_admin_drivers.sql",
    "006_admin_riders.sql",
    "007_admin_trips.sql",
];
/** Arbitrary app-wide advisory key — one constant so all boots serialise. */
const ADVISORY_KEY = 726401001;
/** Same pre-check the 001b file itself documents (STEP 3). */
exports.DUPLICATE_PENDING_PRECHECK_SQL = `
SELECT driver_id,
       COUNT(*) AS pending_offers,
       array_agg(id ORDER BY created_at) AS offer_ids
  FROM ride_offers
 WHERE status = 'pending'
 GROUP BY driver_id
HAVING COUNT(*) > 1`;
function migrationsDir() {
    const candidates = [
        path_1.default.join(process.cwd(), "migrations"), // EB/Procfile: cwd = server/
        path_1.default.join(__dirname, "../../migrations"), // dist|src/services → server/migrations
    ];
    for (const c of candidates)
        if ((0, fs_1.existsSync)(c))
            return c;
    return candidates[0];
}
/**
 * Split SQL into top-level statements. Handles single-quoted strings (with ''
 * and \-escapes), `--` line comments and `$$…$$` bodies — enough for the four
//  migration files, which contain no nested dollar tags.
 */
function splitStatements(sql) {
    const out = [];
    let cur = "";
    let inString = false;
    let inLine = false;
    let inDollar = false;
    for (let i = 0; i < sql.length; i++) {
        const c = sql[i];
        const next = sql[i + 1];
        if (inLine) {
            cur += c;
            if (c === "\n")
                inLine = false;
            continue;
        }
        if (inDollar) {
            cur += c;
            if (c === "$" && next === "$") {
                cur += next;
                i++;
                inDollar = false;
            }
            continue;
        }
        if (inString) {
            cur += c;
            if (c === "\\" && next) {
                cur += next;
                i++;
                continue;
            }
            if (c === "'" && next === "'") {
                cur += next;
                i++;
                continue;
            }
            if (c === "'")
                inString = false;
            continue;
        }
        if (c === "-" && next === "-") {
            inLine = true;
            cur += c;
            continue;
        }
        if (c === "'") {
            inString = true;
            cur += c;
            continue;
        }
        if (c === "$" && next === "$") {
            inDollar = true;
            cur += c + next;
            i++;
            continue;
        }
        if (c === ";") {
            out.push(cur);
            cur = "";
            continue;
        }
        cur += c;
    }
    if (cur.trim())
        out.push(cur);
    return out;
}
/**
 * 001b — outside any transaction, statement by statement.
 * Pre-check first: duplicates ⇒ log ids, skip (unrecorded), keep serving.
 */
async function apply001b(client, file, sql, summary) {
    const stmts = splitStatements(sql).filter((s) => stripComments(s).length > 0);
    for (const stmt of stmts) {
        const body = stripComments(stmt);
        if (/^select\b/i.test(body)) {
            const res = await client.query(stmt);
            const dups = res.rows ?? [];
            if (dups.length > 0) {
                const ids = dups.map((d) => `${d.driver_id}(${d.pending_offers})`).join(", ");
                console.error(`[migrate] 001b PRE-CHECK FAILED — duplicate pending offers for driver(s): ${ids}. ` +
                    `001b SKIPPED (not recorded; retried next boot). Fix: expire the older offers ` +
                    `per migrations/001b_offer_unique_index.sql STEP 3, then restart.`);
                summary.skipped++;
                summary.results.push({ file, outcome: "skipped", detail: `duplicate pending offers: ${ids}` });
                return; // keep serving — 002/003 still run below
            }
            continue; // clean pre-check → run the rest of the file
        }
        await client.query(stmt); // CREATE UNIQUE INDEX CONCURRENTLY … autocommits
    }
    // Post-check: an interrupted CONCURRENTLY build leaves an INVALID index that
    // silently enforces nothing — treat that as a failure so it is retried.
    const valid = await client.query(`SELECT i.indisvalid AS ok FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'idx_ride_offers_one_active_per_driver'`);
    if (valid.rows.length > 0 && valid.rows[0].ok === false) {
        throw new Error("idx_ride_offers_one_active_per_driver was left INVALID by an interrupted build — DROP INDEX CONCURRENTLY it and re-run");
    }
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
    summary.applied++;
    summary.results.push({ file, outcome: "applied" });
    console.log(`[migrate] applied ${file} (outside transaction, index valid)`);
}
/**
 * Never throws. Returns a summary even on total failure so boot always has
 * exactly one summary line to read.
 */
async function runMigrationsOnBoot() {
    const summary = { enabled: false, applied: 0, skipped: 0, failed: 0, results: [] };
    const enabled = process.env.RUN_MIGRATIONS_ON_BOOT === "true";
    summary.enabled = enabled;
    if (!enabled) {
        console.log("[migrate] RUN_MIGRATIONS_ON_BOOT is not 'true' — skipped (default off; applied=0 skipped=0 failed=0)");
        return summary;
    }
    let client = null;
    let locked = false;
    try {
        client = await (0, database_1.default)().connect();
        // Try-lock loop: never block boot indefinitely — after ~10s skip and report.
        for (let i = 0; i < 10 && !locked; i++) {
            const r = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [ADVISORY_KEY]);
            locked = r.rows?.[0]?.ok === true;
            if (!locked)
                await sleep(1000);
        }
        if (!locked) {
            console.warn("[migrate] could not get the migration advisory lock in 10s — another instance is migrating; skipping this boot.");
            summary.skipped = exports.MIGRATION_ORDER.length;
            summary.results = exports.MIGRATION_ORDER.map((f) => ({ file: f, outcome: "skipped", detail: "advisory lock held elsewhere" }));
            return summary;
        }
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`);
        const done = new Set((await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => String(r.filename)));
        const dir = migrationsDir();
        for (const file of exports.MIGRATION_ORDER) {
            if (done.has(file)) {
                summary.skipped++;
                summary.results.push({ file, outcome: "skipped", detail: "already applied" });
                continue;
            }
            const full = path_1.default.join(dir, file);
            if (!(0, fs_1.existsSync)(full)) {
                summary.failed++;
                summary.results.push({ file, outcome: "failed", detail: "file not found on disk" });
                console.error(`[migrate] FAILED ${file}: file not found at ${full}`);
                continue;
            }
            const sql = (0, fs_1.readFileSync)(full, "utf8");
            try {
                if (file.startsWith("001b")) {
                    await apply001b(client, file, sql, summary);
                }
                else {
                    await client.query("BEGIN");
                    await client.query(sql);
                    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
                    await client.query("COMMIT");
                    summary.applied++;
                    summary.results.push({ file, outcome: "applied" });
                    console.log(`[migrate] applied ${file}`);
                }
            }
            catch (err) {
                try {
                    await client.query("ROLLBACK");
                }
                catch {
                    /* the original error matters more */
                }
                summary.failed++;
                summary.results.push({ file, outcome: "failed", detail: String(err?.message || err) });
                // Exact error, one line, no swallowing — but never rethrown.
                console.error(`[migrate] FAILED ${file}: ${err?.message || err}`);
            }
        }
    }
    catch (err) {
        // Outer guard: connection/lock failures etc. Keep serving, report honestly.
        summary.failed++;
        summary.results.push({ file: "(runner)", outcome: "failed", detail: String(err?.message || err) });
        console.error(`[migrate] boot runner error (continuing, new features stay OFF): ${err?.message || err}`);
    }
    finally {
        if (client) {
            if (locked) {
                try {
                    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_KEY]);
                }
                catch {
                    /* release is best-effort */
                }
            }
            try {
                client.release();
            }
            catch {
                /* ignore */
            }
        }
        console.log(`[migrate] summary applied=${summary.applied} skipped=${summary.skipped} failed=${summary.failed}`);
    }
    return summary;
}
function stripComments(sql) {
    return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
//# sourceMappingURL=migrateOnBoot.js.map