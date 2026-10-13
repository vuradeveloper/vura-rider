"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const pg_1 = __importDefault(require("pg"));
/**
 * OPT-IN runtime SQL exec-log — used by the RC4 audit to prove which Module 1-3
 * statements were actually EXECUTEd against real Postgres during the test run
 * (the SQL-inventory test only PREPAREs them).
 *
 * Set VURA_SQL_EXEC_LOG=<path> and every real pool/client query text is
 * appended to <path> as JSON lines. With the variable unset this file does
 * NOTHING — zero effect on normal test runs. Statements are flushed
 * immediately: vitest workers exit without firing 'exit' hooks, so buffering
 * in memory would lose them.
 */
const outPath = process.env.VURA_SQL_EXEC_LOG;
if (outPath) {
    const record = (text) => {
        if (typeof text === "string" && text.trim().length > 0) {
            try {
                (0, fs_1.appendFileSync)(outPath, JSON.stringify(text.replace(/\s+/g, " ").trim()) + "\n", "utf8");
            }
            catch {
                /* logging must never break the test under it */
            }
        }
    };
    const wrapClient = (client) => {
        if (!client || client.__vuraLogged)
            return;
        client.__vuraLogged = true;
        const orig = client.query.bind(client);
        client.query = (...args) => {
            record(args[0]);
            return orig(...args);
        };
    };
    // Static import (no connection is opened by importing pg) so the prototype
    // patch is installed before any test queries.
    const PGCtor = pg_1.default.Pool ?? pg_1.default.default?.Pool;
    const origPoolQuery = PGCtor.prototype.query;
    PGCtor.prototype.query = function (...args) {
        record(args[0]);
        return origPoolQuery.apply(this, args);
    };
    const origConnect = PGCtor.prototype.connect;
    PGCtor.prototype.connect = function (...args) {
        const cb = typeof args[0] === "function" ? args[0] : undefined;
        if (cb) {
            const wrapped = (err, client, done) => {
                if (client)
                    wrapClient(client);
                cb(err, client, done);
            };
            return origConnect.call(this, wrapped);
        }
        return origConnect.apply(this, []).then((client) => {
            wrapClient(client);
            return client;
        });
    };
}
//# sourceMappingURL=setupSqlExecLog.js.map