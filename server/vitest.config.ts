import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // No live Postgres or Redis is used: every test mocks ../config/database, so
    // the suite must never touch the network or a real database. The real-DB
    // integration suites are the exception (VURA_TEST_DB_PORT gated) and they
    // share ONE scratch container — config rows, drivers and rides — so test
    // FILES must not run in parallel or they race each other's fixtures.
    fileParallelism: false,
    // No-op unless VURA_SQL_EXEC_LOG is set — records which SQL really EXECUTEd.
    setupFiles: ["src/setupSqlExecLog.ts"],
    globals: false,
  },
});