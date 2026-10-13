// ─────────────────────────────────────────────────────────────────────────────
// SHARED SCRATCH-DATABASE GUARD
//
// Extracted from dispatch.integration.test.ts so every real-Postgres suite
// (Module 1, RC4 bug-fix suite, …) refuses the same target with the same
// message. These suites CREATE schema and DELETE driver rows, so they may only
// ever talk to the local scratch container — never a shared or production DB.
// ─────────────────────────────────────────────────────────────────────────────

/** The ONLY database a real-PG integration suite may touch. */
export const SCRATCH_DB = { host: "127.0.0.1", port: "55432", name: "vura_test" } as const;

/**
 * SAFETY GUARD — call BEFORE the first statement (schema creation included).
 * Throws loudly when the env points anywhere except the scratch container.
 */
export function assertScratchDatabase(host: string, port: string, dbName: string): void {
  const hostOk = host === "127.0.0.1" || host === "localhost";
  if (hostOk && port === SCRATCH_DB.port && dbName === SCRATCH_DB.name) return;
  throw new Error(
    `[integration] REFUSING to run against ${host || "(none)"}:${port}/${dbName} — ` +
      `this suite creates tables and deletes driver rows, so it only accepts the ` +
      `scratch container (localhost:${SCRATCH_DB.port}/${SCRATCH_DB.name}, docker ` +
      `container vura-module1-db). Point VURA_TEST_DB_PORT at ${SCRATCH_DB.port} ` +
      `or unset it to skip the suite entirely.`
  );
}

/**
 * Point the shared database pool at the scratch container. Must run BEFORE the
 * first query (the pool reads env lazily on first use) and, for suites that
 * import route modules with import-time SQL, before those imports execute.
 */
export function useScratchDatabaseEnv(): void {
  process.env.DB_HOST = "127.0.0.1";
  process.env.DB_PORT = process.env.VURA_TEST_DB_PORT || SCRATCH_DB.port;
  process.env.DB_NAME = process.env.VURA_TEST_DB_NAME || SCRATCH_DB.name;
  process.env.DB_USER = process.env.VURA_TEST_DB_USER || "vura_admin";
  process.env.DB_PASSWORD = process.env.VURA_TEST_DB_PASSWORD || "vura2thinkdifferent";
  process.env.DB_SSL = "false";
}
