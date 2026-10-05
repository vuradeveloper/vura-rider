import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // No live Postgres or Redis is used: every test mocks ../config/database, so
    // the suite must never touch the network or a real database.
    globals: false,
  },
});