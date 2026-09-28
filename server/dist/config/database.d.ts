import { Pool, PoolClient } from "pg";
declare function getPool(): Pool;
export declare function query<T = any>(text: string, params?: any[]): Promise<T[]>;
export declare function queryOne<T = any>(text: string, params?: any[]): Promise<T | null>;
export declare function execute(text: string, params?: any[]): Promise<{
    rowCount: number | null;
    rows: any[];
}>;
export declare function testConnection(): Promise<boolean>;
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
export declare function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
export default getPool;
//# sourceMappingURL=database.d.ts.map