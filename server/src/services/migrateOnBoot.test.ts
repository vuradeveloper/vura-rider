// ─────────────────────────────────────────────────────────────────────────────
// RC4 Item 1 — migrate-on-boot runner (MOCKED database: no Docker needed).
//
// Proves the contract from the brief: default-off switch, exact order, the
// schema_migrations bookkeeping, the 001b outside-transaction + pre-check
// skip, per-migration rollback + continue on failure, and the never-throw /
// one-summary-line guarantees. Real-SQL coverage lives in the
// VURA_TEST_DB_PORT integration suite.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    connectError: null as Error | null,
    lockOk: true,
    appliedFiles: [] as string[], // schema_migrations rows
    dups: [] as Array<{ driver_id: string; pending_offers: number }>,
    invalidIndex: false,
    failOn: null as string | null, // substring of the migration SQL to fail on
    connectCount: 0,
    statements: [] as string[],
    inserted: [] as string[],
    rollbackCount: 0,
    locked: false,
  };
  function makeClient() {
    return {
      query: async (text: string, params?: any[]) => {
        const t = text.replace(/\s+/g, " ").trim();
        state.statements.push(t.slice(0, 60));
        if (t.startsWith("SELECT pg_try_advisory_lock")) {
          state.locked = state.lockOk;
          return { rows: [{ ok: state.lockOk }], rowCount: state.lockOk ? 1 : 0 };
        }
        if (t.startsWith("SELECT pg_advisory_unlock")) return { rows: [{ ok: true }], rowCount: 1 };
        if (t.startsWith("SELECT filename FROM schema_migrations")) {
          return { rows: state.appliedFiles.map((f) => ({ filename: f })), rowCount: state.appliedFiles.length };
        }
        if (t.includes("FROM ride_offers") && t.includes("HAVING COUNT")) {
          return { rows: state.dups, rowCount: state.dups.length };
        }
        if (t.includes("indisvalid")) {
          return { rows: [{ ok: !state.invalidIndex }], rowCount: 1 };
        }
        if (t === "BEGIN" || t === "COMMIT") return { rows: [], rowCount: 0 };
        if (t === "ROLLBACK") {
          state.rollbackCount++;
          return { rows: [], rowCount: 0 };
        }
        if (t.startsWith("INSERT INTO schema_migrations")) {
          if (params?.[0]) state.inserted.push(String(params[0]));
          return { rows: [], rowCount: 1 };
        }
        if (state.failOn && text.includes(state.failOn)) {
          throw new Error(`boom: ${state.failOn}`);
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
  }
  function reset() {
    state.connectError = null;
    state.lockOk = true;
    state.appliedFiles = [];
    state.dups = [];
    state.invalidIndex = false;
    state.failOn = null;
    state.connectCount = 0;
    state.statements = [];
    state.inserted = [];
    state.rollbackCount = 0;
    state.locked = false;
  }
  return { state, makeClient, reset };
});

vi.mock("../config/database", () => ({
  default: () => ({
    connect: async () => {
      h.state.connectCount++;
      if (h.state.connectError) throw h.state.connectError;
      return h.makeClient();
    },
  }),
}));

import { runMigrationsOnBoot, MIGRATION_ORDER, splitStatements } from "./migrateOnBoot";

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.reset();
  delete process.env.RUN_MIGRATIONS_ON_BOOT;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("runMigrationsOnBoot", () => {
  it("is OFF by default: no connection, nothing applied", async () => {
    const s = await runMigrationsOnBoot();
    expect(s.enabled).toBe(false);
    expect(s.applied).toBe(0);
    expect(h.state.connectCount).toBe(0);
    expect(logSpy.mock.calls.join("\n")).toContain("default off");
  });

  it("fresh database: applies 001 → 001b → 002 → 003 → 004 in order and records each", async () => {
    process.env.RUN_MIGRATIONS_ON_BOOT = "true";
    const s = await runMigrationsOnBoot();
    expect(s.failed).toBe(0);
    expect(s.applied).toBe(MIGRATION_ORDER.length);
    expect(s.results.map((r) => r.file)).toEqual([...MIGRATION_ORDER]);
    expect(h.state.inserted).toEqual([...MIGRATION_ORDER]);
    expect(h.state.locked).toBe(true);
    const lines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[migrate] summary"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`[migrate] summary applied=${MIGRATION_ORDER.length} skipped=0 failed=0`);
  });

  it("already-applied migrations are skipped, not re-run", async () => {
    process.env.RUN_MIGRATIONS_ON_BOOT = "true";
    h.state.appliedFiles = [...MIGRATION_ORDER];
    const s = await runMigrationsOnBoot();
    expect(s).toMatchObject({ applied: 0, skipped: MIGRATION_ORDER.length, failed: 0 });
    expect(h.state.inserted).toHaveLength(0);
  });

  it("001b pre-check finds duplicate pending offers → 001b SKIPPED (unrecorded), the rest still apply, no throw", async () => {
    process.env.RUN_MIGRATIONS_ON_BOOT = "true";
    h.state.dups = [{ driver_id: "11111111-1111-1111-1111-111111111111", pending_offers: 2 }];
    const s = await runMigrationsOnBoot();
    expect(s.failed).toBe(0);
    expect(s.applied).toBe(MIGRATION_ORDER.length - 1); // everything except 001b
    expect(s.skipped).toBe(1); // 001b
    const b = s.results.find((r) => r.file.startsWith("001b"));
    expect(b?.outcome).toBe("skipped");
    expect(h.state.inserted).not.toContain("001b_offer_unique_index.sql");
    expect(errSpy.mock.calls.join("\n")).toContain("duplicate pending offers");
    expect(errSpy.mock.calls.join("\n")).toContain("11111111-1111-1111-1111-111111111111(2)");
  });

  it("a failing migration rolls back ONLY itself, logs the exact error, and keeps going", async () => {
    process.env.RUN_MIGRATIONS_ON_BOOT = "true";
    h.state.failOn = "destination_sessions"; // inside 002
    const s = await runMigrationsOnBoot();
    expect(s.applied).toBe(MIGRATION_ORDER.length - 1); // all except the failed 002
    expect(s.failed).toBe(1);
    expect(s.results.find((r) => r.file.startsWith("002"))?.outcome).toBe("failed");
    expect(s.results.find((r) => r.file.startsWith("003"))?.outcome).toBe("applied");
    expect(h.state.rollbackCount).toBeGreaterThanOrEqual(1);
    expect(errSpy.mock.calls.join("\n")).toContain("boom: destination_sessions");
    const lines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[migrate] summary"));
    expect(lines[0]).toBe(`[migrate] summary applied=${MIGRATION_ORDER.length - 1} skipped=0 failed=1`);
  });

  it("never throws — connection failure still returns a summary and logs it", async () => {
    process.env.RUN_MIGRATIONS_ON_BOOT = "true";
    h.state.connectError = new Error("connection refused");
    const s = await runMigrationsOnBoot();
    expect(s.failed).toBeGreaterThanOrEqual(1);
    expect(errSpy.mock.calls.join("\n")).toContain("connection refused");
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("summary applied=");
  });

  it("advisory lock unavailable → skips cleanly instead of hanging boot", async () => {
    process.env.RUN_MIGRATIONS_ON_BOOT = "true";
    h.state.lockOk = false;
    // The runner sleeps 10×1s between lock attempts — run those timers
    // instantly so the test proves the SKIP path without waiting 10s.
    vi.useFakeTimers();
    try {
      const pending = runMigrationsOnBoot();
      await vi.runAllTimersAsync();
      const s = await pending;
      expect(s.applied).toBe(0);
      expect(s.skipped).toBe(MIGRATION_ORDER.length);
      expect(h.state.inserted).toHaveLength(0);
      expect(warnSpy.mock.calls.join("\n")).toContain("another instance is migrating");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("splitStatements", () => {
  it("splits on top-level semicolons only", () => {
    const parts = splitStatements("SELECT 'a;b'; -- c;\nSELECT 2;");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("'a;b'");
  });
  it("keeps dollar-quoted bodies intact", () => {
    const parts = splitStatements("CREATE FUNCTION f() AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql;");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("PERFORM 1;");
  });
});