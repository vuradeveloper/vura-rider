"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
exports.queryOne = queryOne;
exports.execute = execute;
exports.testConnection = testConnection;
exports.withTransaction = withTransaction;
const pg_1 = require("pg");
let pool = null;
function getPool() {
    if (!pool) {
        const ssl = process.env.NODE_ENV === "production" || process.env.DB_SSL === "true"
            ? { rejectUnauthorized: false }
            : false;
        pool = new pg_1.Pool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || "5432", 10),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
            ssl,
        });
        pool.on("error", (err) => {
            console.error("Unexpected PostgreSQL pool error:", err);
        });
    }
    return pool;
}
async function query(text, params) {
    const result = await getPool().query(text, params);
    return result.rows;
}
async function queryOne(text, params) {
    const result = await getPool().query(text, params);
    return result.rows[0] ?? null;
}
async function execute(text, params) {
    const result = await getPool().query(text, params);
    return { rowCount: result.rowCount, rows: result.rows };
}
async function testConnection() {
    try {
        const p = getPool();
        const start = Date.now();
        await p.query("SELECT 1");
        console.log(`✓ PostgreSQL connected successfully (${Date.now() - start}ms)`);
        return true;
    }
    catch (err) {
        console.error("✗ PostgreSQL connection failed:", err);
        return false;
    }
}
/**
 * Run several statements in ONE transaction on a SINGLE pooled connection.
 *
 * Why this is needed: `execute()` above takes whatever connection the pool hands
 * it, so two statements are never guaranteed to share a transaction — a
 * read-then-write across two `execute()` calls is a time-of-check/time-of-use
 * race. Ride acceptance is exactly that shape (read the ride, then claim it), so
 * two drivers could both "win" the same ride. Everything that must be all-or-
 * nothing (accept, offer->assign) goes through here with `FOR UPDATE` row locks.
 *
 * Usage:
 *   const result = await withTransaction(async (client) => {
 *     const r = await client.query("SELECT ... FOR UPDATE", [id]);
 *     ...
 *     return something;
 *   });
 */
async function withTransaction(fn) {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
    }
    catch (err) {
        try {
            await client.query("ROLLBACK");
        }
        catch {
            /* the original error matters more than a failed rollback */
        }
        throw err;
    }
    finally {
        client.release();
    }
}
exports.default = getPool;
//# sourceMappingURL=database.js.map