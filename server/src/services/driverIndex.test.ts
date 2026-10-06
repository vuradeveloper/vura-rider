// ─────────────────────────────────────────────────────────────────────────────
// DRIVER INDEX TESTS
//
// Database and config are mocked, so these prove the LOGIC (cell migration,
// freshness threshold, matchable-status rules) rather than Postgres behaviour.
// They do NOT prove the SQL itself is valid -- that needs a real database and
// is covered by migrations/TEST_MIGRATION.md.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, notify, vehicleImages, resetHarness } from "./testHarness";

vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./notify", async () => (await import("./testHarness")).notify);
vi.mock("./vehicleImages", async () => (await import("./testHarness")).vehicleImages);

import { latLngToCell } from "h3-js";
import {
  driverIndex,
  isMatchableStatus,
  MATCHABLE_STATUSES,
  type DriverPosition,
} from "./driverIndex";
import { invalidateConfigCache, DEFAULT_CONFIG } from "./config";

const SANDTON = { lat: -26.1076, lng: 28.0567 };

function pos(over: Partial<DriverPosition> = {}): DriverPosition {
  return {
    userId: "driver-1",
    lat: SANDTON.lat,
    lng: SANDTON.lng,
    status: "available",
    tier: "COMFORT",
    ...over,
  };
}

/** Make getConfig() return the defaults without touching a real database. */
function useConfig(overrides: Partial<typeof DEFAULT_CONFIG> = {}) {
  invalidateConfigCache();
  db.queryOne.mockImplementation(async (sql: string) =>
    String(sql).includes("FROM app_config")
      ? { value: { ...DEFAULT_CONFIG, ...overrides } }
      : null
  );
}

beforeEach(() => {
  resetHarness();
  useConfig();
  db.execute.mockResolvedValue({ rowCount: 1, rows: [] });
});

describe("upsert", () => {
  it("writes both the res-8 matching cell and the res-7 heatmap cell", async () => {
    const r = await driverIndex.upsert(pos());
    expect(r).not.toBeNull();

    const call = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("INSERT INTO driver_cells")
    );
    expect(call).toBeDefined();

    const [userId, res8, res7, lat, lng] = call![1];
    expect(userId).toBe("driver-1");
    // res8 drives matching; res7 exists purely for the Phase 2 heatmap.
    expect(res8).toBe(latLngToCell(SANDTON.lat, SANDTON.lng, 8));
    expect(res7).toBe(latLngToCell(SANDTON.lat, SANDTON.lng, 7));
    expect(res8).not.toBe(res7);
    expect(lat).toBe(SANDTON.lat);
    expect(lng).toBe(SANDTON.lng);
  });

  it("refuses coordinates that are not finite numbers", async () => {
    expect(await driverIndex.upsert(pos({ lat: NaN }))).toBeNull();
    expect(await driverIndex.upsert(pos({ lng: Infinity }))).toBeNull();
    expect(await driverIndex.upsert(pos({ userId: "" }))).toBeNull();
    // Nothing must have been written for any of those.
    expect(db.execute.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("INSERT INTO driver_cells")
    )).toHaveLength(0);
  });

  it("never throws when the table does not exist yet (migration not run)", async () => {
    db.execute.mockRejectedValue(new Error('relation "driver_cells" does not exist'));
    await expect(driverIndex.upsert(pos())).resolves.not.toThrow();
  });
});

describe("cell migration", () => {
  it("moves the driver by upserting on user_id, leaving no stale cell row", async () => {
    // ~1.1km north of Sandton: far enough to be a different res-8 cell.
    const moved = { lat: SANDTON.lat + 0.01, lng: SANDTON.lng };
    const before = latLngToCell(SANDTON.lat, SANDTON.lng, 8);
    const after = latLngToCell(moved.lat, moved.lng, 8);
    expect(after).not.toBe(before);

    await driverIndex.upsert(pos());
    await driverIndex.upsert(pos({ lat: moved.lat }));

    const inserts = db.execute.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("INSERT INTO driver_cells")
    );
    expect(inserts).toHaveLength(2);

    // THE guarantee: every write targets the same user_id and resolves the
    // conflict in place. A per-cell row model would have needed a DELETE here.
    for (const c of inserts) expect(c[1][0]).toBe("driver-1");
    expect(inserts[0][0]).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(inserts[1][1]).toContain(after);
  });
});

describe("stale eviction", () => {
  it("uses stale_seconds from config (40s today), not a hard-coded 20", async () => {
    const n = await driverIndex.evictStale();
    expect(n).toBe(1);

    const call = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("DELETE FROM driver_cells")
    );
    expect(call).toBeDefined();
    expect(call![1]).toEqual([40]); // DEFAULT_CONFIG.stale_seconds
  });

  it("honours an override when one is passed explicitly", async () => {
    await driverIndex.evictStale(20);
    const call = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("DELETE FROM driver_cells")
    );
    expect(call![1]).toEqual([20]);
  });

  it("reads the threshold from app_config rather than a constant", async () => {
    useConfig({ stale_seconds: 15 });
    await driverIndex.evictStale();
    const call = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("DELETE FROM driver_cells")
    );
    expect(call![1]).toEqual([15]);
  });

  it("evicts nothing for a non-positive threshold", async () => {
    expect(await driverIndex.evictStale(0)).toBe(0);
    expect(await driverIndex.evictStale(-5)).toBe(0);
    expect(db.execute.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("DELETE FROM driver_cells")
    )).toHaveLength(0);
  });
});

describe("heartbeat touch (Module 1 fix: stationary drivers stay fresh)", () => {
  it("refreshes last_seen_at and mirrors status without moving the position", async () => {
    const ok = await driverIndex.touch("driver-1", "available");
    expect(ok).toBe(true);

    const call = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE driver_cells")
    );
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("last_seen_at = NOW()");
    expect(String(call![0])).toContain("COALESCE($2, status)");
    // Keyed by user_id — never a positional/scan update.
    expect(String(call![0])).toContain("WHERE user_id = $1");
    // Position and cell are deliberately NOT written: this is liveness only.
    expect(String(call![0])).not.toContain("lat =");
    expect(String(call![0])).not.toContain("cell_res8 =");
    expect(call![1]).toEqual(["driver-1", "available"]);
  });

  it("keeps the stored status when none is passed", async () => {
    await driverIndex.touch("driver-1");
    const call = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE driver_cells")
    );
    expect(call![1]).toEqual(["driver-1", null]);
  });

  it("reports false when the driver has no index row (never pinged GPS)", async () => {
    db.execute.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await driverIndex.touch("driver-1", "available")).toBe(false);
  });

  it("never throws on a database failure", async () => {
    db.execute.mockRejectedValueOnce(new Error("connection lost"));
    await expect(driverIndex.touch("driver-1")).resolves.toBe(false);
  });

  it("is a no-op without a user id", async () => {
    expect(await driverIndex.touch("")).toBe(false);
    expect(db.execute.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("UPDATE driver_cells")
    )).toHaveLength(0);
  });
});

describe("matchable status comes from ONE constant (Q8)", () => {
  it("treats only 'available' as matchable", () => {
    expect(MATCHABLE_STATUSES).toEqual(["available"]);
    expect(isMatchableStatus("available")).toBe(true);
    for (const s of ["offline", "on_trip", "blocked", "pending", "", null, undefined, "AVAILABLE"]) {
      expect(isMatchableStatus(s)).toBe(false);
    }
  });
});