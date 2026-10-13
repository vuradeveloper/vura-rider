import { appendFileSync } from "fs";
import pg from "pg";
import type { Pool, PoolClient } from "pg";

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
  const record = (text: unknown) => {
    if (typeof text === "string" && text.trim().length > 0) {
      try {
        appendFileSync(outPath, JSON.stringify(text.replace(/\s+/g, " ").trim()) + "\n", "utf8");
      } catch {
        /* logging must never break the test under it */
      }
    }
  };
  const wrapClient = (client: any) => {
    if (!client || client.__vuraLogged) return;
    client.__vuraLogged = true;
    const orig = client.query.bind(client);
    client.query = (...args: any[]) => {
      record(args[0]);
      return orig(...args);
    };
  };

  // Static import (no connection is opened by importing pg) so the prototype
  // patch is installed before any test queries.
  const PGCtor = (pg as any).Pool ?? (pg as any).default?.Pool;
  const origPoolQuery = PGCtor.prototype.query;
  PGCtor.prototype.query = function (this: Pool, ...args: any[]) {
    record(args[0]);
    return origPoolQuery.apply(this, args);
  };
  const origConnect = PGCtor.prototype.connect;
  PGCtor.prototype.connect = function (this: Pool, ...args: any[]) {
    const cb = typeof args[0] === "function" ? args[0] : undefined;
    if (cb) {
      const wrapped = (err: any, client: PoolClient, done: any) => {
        if (client) wrapClient(client);
        cb(err, client, done);
      };
      return origConnect.call(this, wrapped as any);
    }
    return (origConnect.apply(this, []) as Promise<PoolClient>).then((client) => {
      wrapClient(client);
      return client;
    });
  };
}

export {};