"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
exports.queryOne = queryOne;
exports.execute = execute;
exports.testConnection = testConnection;
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
exports.default = getPool;
//# sourceMappingURL=database.js.map