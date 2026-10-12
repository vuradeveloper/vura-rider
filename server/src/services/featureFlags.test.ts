// ─────────────────────────────────────────────────────────────────────────────
// RC4 Items 1/1b — feature-flag service (MOCKED database).
//
// The brief's hard requirement: admin-only, validated keys only, audit
// logged, one-call enable by id/email/phone, and never a money column.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const db = vi.hoisted(() => {
  const app_config = new Map<string, any>();
  const users: any[] = [];
  function matchUsers(emails: string[], phones: string[]) {
    return users.filter(
      (u) =>
        emails.includes(String(u.email ?? "").toLowerCase()) ||
        phones.includes(String(u.phone ?? "").replace(/[^0-9]/g, "")),
    );
  }
  return {
    app_config,
    users,
    matchUsers,
    reset() {
      app_config.clear();
      users.length = 0;
    },
  };
});

vi.mock("../config/database", () => ({
  queryOne: async (sql: string, params?: any[]) => {
    if (sql.includes("FROM app_config WHERE key")) {
      const k = String(params?.[0]);
      return db.app_config.has(k) ? { value: JSON.parse(JSON.stringify(db.app_config.get(k))) } : null;
    }
    if (sql.includes("FROM users")) {
      const [emails, phones] = params as [string[], string[]];
      return db.matchUsers(emails, phones);
    }
    return null;
  },
  query: async (sql: string, params?: any[]) => {
    if (sql.includes("FROM users")) {
      const [emails, phones] = params as [string[], string[]];
      return db.matchUsers(emails, phones);
    }
    return []; // ride_events / recent paths
  },
  execute: async (sql: string, params?: any[]) => {
    if (sql.includes("UPDATE app_config")) {
      db.app_config.set(String(params?.[0]), JSON.parse(String(params?.[1])));
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  },
}));

const invalidate = vi.hoisted(() => vi.fn());
vi.mock("./config", () => ({ invalidateConfigCache: invalidate }));
vi.mock("./offerWorker", () => ({ getBuildCommit: () => "abc1234" }));

import {
  FeatureFlagError,
  disableAllFeatures,
  enableForAccounts,
  readFeatures,
  updateFeature,
  validateField,
} from "./featureFlags";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  invalidate.mockClear();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => logSpy.mockRestore());

function seed() {
  db.app_config.set("matching", {
    h3_matching_enabled: false,
    h3_rollout_mode: "off",
    h3_rollout_rider_ids: [],
    h3_rollout_percent: 0,
    match_radius_km: [3, 5, 7],
  });
  db.app_config.set("destination", {
    destination_matching_enabled: false,
    destination_rollout_driver_ids: [],
  });
  db.app_config.set("performance_tier", {
    performance_tier_enabled: false,
    performance_tier_rollout_driver_ids: [],
  });
}

describe("validateField — validated keys only", () => {
  it("rejects unknown fields with the allowed list", () => {
    expect(() => validateField("matching", "base_fare", 1)).toThrow(FeatureFlagError);
    expect(() => validateField("destination", "per_km", 1)).toThrow(/allowed:/);
    expect(() => validateField("performance_tier", "commission_percent", 10)).toThrow(FeatureFlagError);
  });
  it("type-checks booleans, modes, percents and id lists", () => {
    expect(validateField("matching", "h3_matching_enabled", true)).toBe(true);
    expect(() => validateField("matching", "h3_matching_enabled", "yes")).toThrow(/true\/false/);
    expect(validateField("matching", "h3_rollout_mode", "allowlist")).toBe("allowlist");
    expect(() => validateField("matching", "h3_rollout_mode", "everything")).toThrow(/one of/);
    expect(validateField("matching", "h3_rollout_percent", 42)).toBe(42);
    expect(() => validateField("matching", "h3_rollout_percent", 142)).toThrow(/0..100/);
    expect(validateField("destination", "destination_rollout_driver_ids", [" DRIVER-1 ", "driver-1"])).toEqual(["driver-1"]);
    expect(() => validateField("destination", "destination_rollout_driver_ids", [1])).toThrow(/invalid id/);
  });
});

describe("updateFeature", () => {
  it("unknown key / empty changes → validation error (400 path)", async () => {
    seed();
    await expect(updateFeature("fares", { anything: 1 }, "admin@x")).rejects.toThrow(/key must be one of/);
    await expect(updateFeature("matching", {}, "admin@x")).rejects.toThrow(/empty/);
    await expect(updateFeature("matching", { hacked: true }, "admin@x")).rejects.toThrow(/unknown field/);
  });

  it("missing config row → structured no_row error, no write", async () => {
    await expect(updateFeature("matching", { h3_matching_enabled: true }, "admin@x")).rejects.toMatchObject({
      code: "no_row",
    });
  });

  it("happy path: merges the patch, invalidates the cache, audits the change", async () => {
    seed();
    const out = await updateFeature("matching", { h3_matching_enabled: true, h3_rollout_mode: "all" }, "admin@x");
    expect((out.flags as any).matching.h3_matching_enabled).toBe(true);
    expect((out.flags as any).matching.h3_rollout_mode).toBe("all");
    expect(db.app_config.get("matching").h3_matching_enabled).toBe(true);
    expect(db.app_config.get("matching").match_radius_km).toEqual([3, 5, 7]); // untouched fields survive
    expect(invalidate).toHaveBeenCalled();
    const auditLine = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"audit":"features"'));
    expect(auditLine).toContain('"actor":"admin@x"');
    expect(auditLine).toContain('"action":"update"');
  });
});

describe("enableForAccounts — one call, no SQL", () => {
  it("resolves drivers by email, enables all three, matching → 'all' without rider ids", async () => {
    seed();
    db.users.push({ id: "UUID-DRIVER-1", role: "driver", email: "driver@test.dev", phone: "+27821112222" });
    const out = await enableForAccounts({ driverEmails: ["DRIVER@TEST.DEV"] }, "admin@x");
    const resolved = out.resolved as any;
    expect(resolved.driver_users).toHaveLength(1);
    expect(resolved.driver_ids).toEqual(["uuid-driver-1"]);
    const flags = out.flags as any;
    expect(flags.destination.destination_matching_enabled).toBe(true);
    expect(flags.destination.destination_rollout_driver_ids).toEqual(["uuid-driver-1"]);
    expect(flags.performance_tier.performance_tier_enabled).toBe(true);
    expect(flags.performance_tier.performance_tier_rollout_driver_ids).toEqual(["uuid-driver-1"]);
    expect(flags.matching.h3_matching_enabled).toBe(true);
    expect(flags.matching.h3_rollout_mode).toBe("all");
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("rider ids switch matching to allowlist mode and merge (never clobber) the list", async () => {
    seed();
    db.app_config.get("matching").h3_rollout_rider_ids = ["existing-rider"];
    const out = await enableForAccounts({ riderIds: ["NEW-RIDER"], features: ["matching"] }, "admin@x");
    const flags = out.flags as any;
    expect(flags.matching.h3_rollout_mode).toBe("allowlist");
    expect(flags.matching.h3_rollout_rider_ids).toEqual(["existing-rider", "new-rider"]);
    // features subset honoured: destination untouched
    expect(db.app_config.get("destination").destination_matching_enabled).toBe(false);
  });

  it("phone lookup normalises to digits", async () => {
    seed();
    db.users.push({ id: "UUID-2", role: "driver", email: null, phone: "+27 82 111 2222" });
    const out = await enableForAccounts({ driverPhones: ["+27821112222"], features: ["destination"] }, "admin@x");
    expect((out.resolved as any).driver_ids).toEqual(["uuid-2"]);
    expect((out.flags as any).destination.destination_rollout_driver_ids).toEqual(["uuid-2"]);
  });

  it("unknown feature name → validation error", async () => {
    seed();
    await expect(enableForAccounts({ features: ["fares"] }, "admin@x")).rejects.toThrow(/unknown feature/);
  });
});

describe("readFeatures", () => {
  it("returns all three sections + build + recent paths (empty table tolerated)", async () => {
    seed();
    const out = (await readFeatures()) as any;
    expect(out.server_build).toBe("abc1234");
    expect(out.flags.matching.exists).toBe(true);
    expect(out.flags.destination.destination_matching_enabled).toBe(false);
    expect(out.flags.performance_tier.performance_tier_rollout_driver_ids).toEqual([]);
    expect(out.recent_matching_paths).toEqual([]);
  });
  it("missing rows report exists:false instead of inventing config", async () => {
    const out = (await readFeatures()) as any;
    expect(out.flags.matching.exists).toBe(false);
  });
});

// ── RC4 rollout-for-everyone: destination/tier gained an explicit mode ───────
describe("rollout modes — destination/tier 'all', matching keeps its ladder", () => {
  it("accepts allowlist|all for destination/tier; rejects anything else", () => {
    expect(validateField("destination", "destination_rollout_mode", "all")).toBe("all");
    expect(validateField("destination", "destination_rollout_mode", "allowlist")).toBe("allowlist");
    expect(validateField("performance_tier", "performance_tier_rollout_mode", "all")).toBe("all");
    // drivers have no percent bucketing and no 'off' (the boolean is the kill switch)
    expect(() => validateField("destination", "destination_rollout_mode", "percent")).toThrow(/allowlist\|all/);
    expect(() => validateField("destination", "destination_rollout_mode", "off")).toThrow(/allowlist\|all/);
    expect(() => validateField("performance_tier", "performance_tier_rollout_mode", 1)).toThrow(/allowlist\|all/);
    // matching's four-step ladder is untouched
    expect(validateField("matching", "h3_rollout_mode", "percent")).toBe("percent");
    expect(validateField("matching", "h3_rollout_mode", "off")).toBe("off");
  });

  it("enable with NO account ids turns all three ON for everyone (modes 'all')", async () => {
    seed();
    const out = await enableForAccounts({}, "admin@x");
    const flags = out.flags as any;
    expect(flags.matching).toMatchObject({ h3_matching_enabled: true, h3_rollout_mode: "all" });
    expect(flags.destination).toMatchObject({
      destination_matching_enabled: true,
      destination_rollout_mode: "all",
      destination_rollout_driver_ids: [], // no ids given ⇒ nothing to merge
    });
    expect(flags.performance_tier).toMatchObject({
      performance_tier_enabled: true,
      performance_tier_rollout_mode: "all",
      performance_tier_rollout_driver_ids: [],
    });
  });

  it("enable WITH account ids pins destination/tier to allowlist — never 'all'", async () => {
    seed();
    const out = await enableForAccounts({ driverIds: ["D-9"], riderIds: ["R-9"] }, "admin@x");
    const flags = out.flags as any;
    expect(flags.destination.destination_rollout_mode).toBe("allowlist");
    expect(flags.destination.destination_rollout_driver_ids).toEqual(["d-9"]);
    expect(flags.performance_tier.performance_tier_rollout_mode).toBe("allowlist");
    expect(flags.matching.h3_rollout_mode).toBe("allowlist");
  });

  it("a row seeded WITHOUT the mode fields reads back as 'allowlist' (default unchanged)", async () => {
    seed(); // seed() rows carry no *_rollout_mode key at all — pre-RC4 posture
    const out = (await readFeatures()) as any;
    expect(out.flags.destination.destination_rollout_mode).toBe("allowlist");
    expect(out.flags.performance_tier.performance_tier_rollout_mode).toBe("allowlist");
    expect(out.flags.matching.h3_rollout_mode).toBe("off"); // matching unchanged
  });

  it("disableAllFeatures kills all three and restores the seed posture", async () => {
    seed();
    await enableForAccounts({ driverIds: ["D-1"], riderIds: ["R-1"] }, "admin@x");
    invalidate.mockClear();

    const out = await disableAllFeatures("admin@x");
    const flags = out.flags as any;
    expect(flags.matching).toMatchObject({ h3_matching_enabled: false, h3_rollout_mode: "off" });
    expect(flags.destination).toMatchObject({
      destination_matching_enabled: false,
      destination_rollout_mode: "allowlist",
    });
    expect(flags.performance_tier).toMatchObject({
      performance_tier_enabled: false,
      performance_tier_rollout_mode: "allowlist",
    });
    // Recorded allowlists survive (they cover nobody while the switch is off)
    expect(db.app_config.get("destination").destination_rollout_driver_ids).toEqual(["d-1"]);
    expect(invalidate).toHaveBeenCalledTimes(3); // one per section write
    const auditLine = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes('"action":"disable"'));
    expect(auditLine).toContain('"actor":"admin@x"');
  });
});