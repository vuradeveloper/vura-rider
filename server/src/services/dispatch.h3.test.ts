// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1: H3 matching behind the h3_matching_enabled flag.
//
// EVERYTHING IN THIS FILE IS MOCKED: database, config, driver index, road-ETA.
// It proves BEHAVIOUR (which path runs, which radius, which driver gets the
// offer, what happens when the H3 path breaks) — not SQL validity.
// The real-Postgres counterparts live in dispatch.integration.test.ts, which
// only runs when VURA_TEST_DB_PORT is set.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  db,
  notify,
  makeIo,
  mockRide,
  traceStage,
  rideEvents,
  resetHarness,
  RIDE,
  setH3Enabled,
  patchConfig,
} from "./testHarness";

vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./notify", async () => (await import("./testHarness")).notify);
vi.mock("./vehicleImages", async () => (await import("./testHarness")).vehicleImages);
vi.mock("./config", async () => (await import("./testHarness")).appConfig);

import {
  findCandidates,
  offerToNextDriver,
  radiusForRound,
  h3MaxOfferRounds,
  decideH3Path,
  riderBucket,
} from "./dispatch";
import {
  getDriverIndex,
  setDriverIndex,
  type DriverIndex,
  type IndexedDriver,
} from "./driverIndex";
import { setRoadEtaImpl, resetRoadEtaImpl } from "./eta";
import { evictStaleIndexOnce } from "./offerWorker";
import { getCounters } from "./metrics";

const realIndex = getDriverIndex();

const SANDTON = { lat: -26.1076, lng: 28.0567 };

/** An index row as getDriversInCells would return it. */
function cellDriver(id: string, over: Partial<IndexedDriver> = {}): IndexedDriver {
  return {
    userId: id,
    lat: -26.1,
    lng: 28.05,
    heading: null,
    status: "available",
    tier: null,
    cell: "88bcc350e7fffff",
    lastSeenAt: new Date().toISOString(),
    ...over,
  };
}

/** An eligibility-SQL row (driver_profiles join result). */
function sqlDriver(id: string, distanceKm: number, over: Record<string, unknown> = {}) {
  return {
    id,
    firebase_uid: `fb-${id}`,
    current_lat: -26.1,
    current_lng: 28.05,
    distance_km: distanceKm,
    ...over,
  };
}

function makeIndex(
  rows: IndexedDriver[],
  over: Partial<DriverIndex> = {}
): DriverIndex {
  return {
    upsert: vi.fn(),
    getDriver: vi.fn(),
    getDriversInCells: vi.fn(async () => rows),
    remove: vi.fn(),
    evictStale: vi.fn(async () => 0),
    touch: vi.fn(async () => true),
    countFresh: vi.fn(async () => rows.length),
    ...over,
  };
}

/** The eligibility query dispatched for flag-ON (the one with driver_blocks). */
function h3CandidateCall(): any[] | undefined {
  return db.query.mock.calls.find((c: any[]) =>
    String(c[0]).includes("driver_blocks")
  );
}

/** The busy-lock query (FOR UPDATE SKIP LOCKED), captured via withTransaction. */
function captureTx() {
  const sqls: string[] = [];
  db.withTransaction.mockImplementation(async (fn: any) =>
    fn({
      query: async (sql: string) => {
        sqls.push(String(sql));
        return { rows: [], rowCount: 0 };
      },
    })
  );
  return sqls;
}

beforeEach(() => {
  resetHarness();
  setDriverIndex(makeIndex([]));
});

afterEach(() => {
  resetRoadEtaImpl();
  setDriverIndex(realIndex);
});

describe("flag OFF: the original haversine path runs, unchanged", () => {
  it("uses the pre-Module-1 query and never touches the H3 index", async () => {
    setH3Enabled(false);
    db.query.mockResolvedValueOnce([]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 3, false);

    expect(cands).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = String(db.query.mock.calls[0][0]);
    // Original shape: full scan over driver_profiles, literal 'available'.
    expect(sql).toContain("FROM driver_profiles dp");
    expect(sql).toContain("6371 * acos");
    expect(sql).toContain("= 'available'");
    // None of the Module 1 machinery leaks into the flag-off SQL.
    expect(sql).not.toContain("driver_blocks");
    expect(sql).not.toContain("= ANY($1::uuid[])");
    // Index and the FOR UPDATE SKIP LOCKED busy check are never invoked.
    expect(getDriverIndex().getDriversInCells).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();
    expect(traceStage("h3_candidates")).toHaveLength(0);
    expect(traceStage("h3_path_failed")).toHaveLength(0);
  });
});

describe("flag ON: H3 path shape", () => {
  it("drives matching from the index, locks pending offers, filters and ranks", async () => {
    setH3Enabled(true);
    const idx = makeIndex([cellDriver("driver-1")]);
    setDriverIndex(idx);
    const txSql = captureTx();
    db.query.mockResolvedValueOnce([sqlDriver("driver-1", 0.4)]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 1, false, 1);

    expect(cands.map((c) => c.id)).toEqual(["driver-1"]);
    // Index-first: only cell members can be candidates.
    expect(idx.getDriversInCells).toHaveBeenCalledTimes(1);
    // One-offer-per-driver pre-check: FOR UPDATE SKIP LOCKED in one tx.
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(txSql[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(txSql[0]).toContain("status = 'pending'");
    // Eligibility SQL: index ids + MATCHABLE_STATUSES + blocks + exact radius.
    const call = h3CandidateCall();
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("= ANY($1::uuid[])");
    expect(String(call![0])).toContain("driver_blocks");
    expect(String(call![0])).toContain("<= $10::double precision");
    expect(call![1][0]).toEqual(["driver-1"]); // ids from the index
    expect(call![1][1]).toEqual(["available"]); // MATCHABLE_STATUSES constant
    expect(call![1][9]).toBe(3); // round 1 -> 3km rung
    expect(traceStage("h3_candidates")).toHaveLength(1);
  });

  it("expands the radius ladder 3 -> 5 -> 7 km across rounds", async () => {
    expect(h3MaxOfferRounds({ search_timeout_ms: 90_000, offer_ttl_seconds: 15 })).toBe(6);
    expect(radiusForRound(1, [3, 5, 7], 6)).toBe(3);
    expect(radiusForRound(2, [3, 5, 7], 6)).toBe(3);
    expect(radiusForRound(3, [3, 5, 7], 6)).toBe(5);
    expect(radiusForRound(4, [3, 5, 7], 6)).toBe(5);
    expect(radiusForRound(5, [3, 5, 7], 6)).toBe(7);
    expect(radiusForRound(6, [3, 5, 7], 6)).toBe(7);
    expect(radiusForRound(7, [3, 5, 7], 6)).toBeNull();

    // And the radius really reaches the SQL on each rung.
    setH3Enabled(true);
    setDriverIndex(makeIndex([cellDriver("driver-1")]));
    for (const [round, radius] of [
      [1, 3],
      [3, 5],
      [5, 7],
    ] as const) {
      db.query.mockResolvedValueOnce([sqlDriver("driver-1", 0.4)]);
      await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 1, false, round);
      const call = h3CandidateCall();
      expect(call![1][9]).toBe(radius);
      db.query.mockReset();
    }
  });

  it("stops at the 90s budget with a rider-facing no_drivers result", async () => {
    setH3Enabled(true);
    mockRide();
    const { io, emitted } = makeIo();

    // Round 7 is past the 6-round (90s) budget.
    const res = await offerToNextDriver(io, "ride-1", 7);

    expect(res.offered).toBe(false);
    expect(res.reason).toBe("no_candidates");
    expect(traceStage("h3_search_timeout")).toHaveLength(1);
    expect(traceStage("h3_search_timeout")[0].max_rounds).toBe(6);
    // The RIDER is told — not a silent stop, and counted.
    expect(emitted.some((e) => e.event === "ride:no:drivers")).toBe(true);
    expect(rideEvents("no_drivers").length).toBe(1);
    expect(getCounters().no_drivers).toBe(1);
    // Budget already spent: the index is not even consulted.
    expect(getDriverIndex().getDriversInCells).not.toHaveBeenCalled();
  });
});

describe("flag ON: ranking", () => {
  it("ranks by road ETA even when the far driver is closer as the crow flies", async () => {
    setH3Enabled(true);
    setDriverIndex(makeIndex([cellDriver("near"), cellDriver("far")]));
    // SQL returns distance order: near(0.5km) then far(2.0km)...
    db.query.mockResolvedValueOnce([
      sqlDriver("near", 0.5, { current_lat: -26.105, current_lng: 28.055 }),
      sqlDriver("far", 2.0, { current_lat: -26.12, current_lng: 28.04 }),
    ]);
    // ...but by road the near driver is 10min away and the far one 3min.
    setRoadEtaImpl(async () => [10, 3]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 5, false, 1);

    expect(cands.map((c) => c.id)).toEqual(["far", "near"]);
  });

  it("falls back to haversine ranking when the road ETA provider fails", async () => {
    setH3Enabled(true);
    setDriverIndex(makeIndex([cellDriver("near"), cellDriver("far")]));
    db.query.mockResolvedValueOnce([
      sqlDriver("near", 0.5),
      sqlDriver("far", 2.0),
    ]);
    setRoadEtaImpl(async () => {
      throw new Error("OSRM down");
    });

    // Must not throw — order degrades to straight-line distance.
    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 5, false, 1);

    expect(cands.map((c) => c.id)).toEqual(["near", "far"]);
    expect(traceStage("h3_path_failed")).toHaveLength(0);
  });
});

describe("flag ON: failure falls back to the old path", () => {
  it("logs h3_path_failed and re-runs the haversine query when the H3 path throws", async () => {
    setH3Enabled(true);
    setDriverIndex(
      makeIndex([], {
        countFresh: vi.fn(async () => 10), // rollout guard passes...
        getDriversInCells: vi.fn(async () => {
          throw new Error("index exploded"); // ...then the path breaks
        }),
      })
    );
    db.query.mockResolvedValueOnce([sqlDriver("driver-9", 0.4)]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 1, false, 1);

    // The rider still gets candidates — from the OLD query.
    expect(cands.map((c) => c.id)).toEqual(["driver-9"]);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).not.toContain("driver_blocks"); // haversine shape, not H3
    // The failure is LOUD, not silent, and counted.
    const failed = traceStage("h3_path_failed");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].error)).toContain("index exploded");
    expect(getCounters().h3_path_failures).toBe(1);
    expect(getCounters().fallback_used).toBe(1);
  });

  it("rollout guard: cold index (0 fresh rows anywhere) uses the old path and says why", async () => {
    setH3Enabled(true);
    const idx = makeIndex([], { countFresh: vi.fn(async () => 0) });
    setDriverIndex(idx);
    db.query.mockResolvedValueOnce([sqlDriver("driver-9", 0.4)]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 1, false, 1);

    expect(cands).toHaveLength(1);
    expect(traceStage("h3_index_cold")).toHaveLength(1);
    // The guard fired before any cell work — no cells, no busy lock.
    expect(idx.getDriversInCells).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).not.toContain("driver_blocks"); // haversine fallback ran
    expect(getCounters().fallback_used).toBe(1);
  });

  it("falls back when the index is empty FOR THE AREA (globally fresh)", async () => {
    setH3Enabled(true);
    // Guard passes (rows exist elsewhere) but this pickup's cells are empty.
    setDriverIndex(makeIndex([], { countFresh: vi.fn(async () => 5) }));
    db.query.mockResolvedValueOnce([sqlDriver("driver-9", 0.4)]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 1, false, 1);

    expect(cands).toHaveLength(1);
    expect(traceStage("h3_index_empty")).toHaveLength(1);
    expect(traceStage("h3_index_cold")).toHaveLength(0);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).not.toContain("driver_blocks"); // haversine fallback ran
    expect(getCounters().fallback_used).toBe(1);
  });
});

describe("one offer per driver", () => {
  it("skips a driver holding a pending offer and offers the next candidate", async () => {
    setH3Enabled(true);
    setDriverIndex(makeIndex([cellDriver("driver-1"), cellDriver("driver-2")]));
    mockRide();
    // The busy-lock sees driver-1 already pending on ANOTHER ride...
    db.withTransaction.mockImplementation(async (fn: any) =>
      fn({
        query: async () => ({ rows: [{ driver_id: "driver-1" }], rowCount: 1 }),
      })
    );
    // ...the eligibility SQL mock still returns both (the real DB would have
    // excluded driver-1 via the $1 ids param), so the offer loop's own 001b
    // conflict handling is exercised too:
    db.query.mockResolvedValueOnce([
      sqlDriver("driver-1", 0.4),
      sqlDriver("driver-2", 0.9),
    ]);
    // queryOne Once-queue in call order: loadRide, INSERT(driver-1), INSERT(driver-2).
    db.queryOne
      .mockImplementationOnce(async () => ({ ...RIDE })) // loadRide
      .mockImplementationOnce(async () => {
        // INSERT driver-1: the 001b partial unique index refuses it.
        const e: any = new Error(
          'duplicate key value violates unique constraint "idx_ride_offers_one_active_per_driver"'
        );
        e.code = "23505";
        throw e;
      })
      .mockImplementationOnce(async () => ({
        id: "offer-2",
        expires_at: "2026-01-01T00:00:30Z",
      }));

    const { io } = makeIo();
    const res = await offerToNextDriver(io, "ride-1");

    expect(res.offered).toBe(true);
    expect(res.driverId).toBe("driver-2");
    expect(traceStage("offer_driver_busy")).toHaveLength(1);
    expect(getCounters().offer_driver_busy).toBe(1);
    // driver-1 was removed from the SQL ids param by the busy-lock filter.
    const call = h3CandidateCall();
    expect(call![1][0]).toEqual(["driver-2"]);
  });
});

describe("rollout control (h3_rollout_mode)", () => {
  it("allowlisted rider gets H3 while another rider gets legacy in the same minute", async () => {
    setH3Enabled(true); // master switch on, mode 'all' ...
    patchConfig({
      // ... then restrict: same cached config for BOTH calls below.
      h3_rollout_mode: "allowlist",
      h3_rollout_rider_ids: ["rider-a"],
    });
    const idx = makeIndex([cellDriver("driver-1")]);
    setDriverIndex(idx);
    db.query
      .mockResolvedValueOnce([sqlDriver("driver-1", 0.4)]) // H3 eligibility SQL
      .mockResolvedValueOnce([sqlDriver("driver-9", 0.4)]); // legacy haversine SQL

    const h3Rider = await findCandidates("ride-a", SANDTON.lat, SANDTON.lng, 1, false, 1, "rider-a");
    const otherRider = await findCandidates(
      "ride-b",
      SANDTON.lat,
      SANDTON.lng,
      1,
      false,
      1,
      "rider-b"
    );

    expect(h3Rider.map((c) => c.id)).toEqual(["driver-1"]);
    expect(otherRider.map((c) => c.id)).toEqual(["driver-9"]);
    // SQL shape proves which path served which rider.
    const sqlA = String(db.query.mock.calls[0][0]);
    const sqlB = String(db.query.mock.calls[1][0]);
    expect(sqlA).toContain("driver_blocks"); // rider-a -> H3
    expect(sqlB).not.toContain("driver_blocks"); // rider-b -> legacy
    expect(idx.getDriversInCells).toHaveBeenCalledTimes(1); // only rider-a
    // Both rides record path + reason.
    const paths = traceStage("matching_path");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatchObject({ path: "h3", reason: "rollout_allowlist" });
    expect(paths[1]).toMatchObject({ path: "legacy", reason: "rollout_not_allowlisted" });
  });

  it("percent mode is stable per rider and widens only at the boundary", () => {
    const base = {
      h3_matching_enabled: true,
      h3_rollout_mode: "percent" as const,
      h3_rollout_rider_ids: [],
      h3_rollout_percent: 50,
    };
    const findId = (pred: (b: number) => boolean): string => {
      for (let i = 0; i < 5000; i++) {
        const id = `rider-percent-${i}`;
        if (pred(riderBucket(id))) return id;
      }
      throw new Error("no rider id matched the bucket predicate");
    };
    const inside = findId((b) => b < 50);
    const outside = findId((b) => b >= 50);

    // Same rider, repeated decisions -> identical outcome (the bucket never
    // moves: a rider's path cannot flip between requests or deploys).
    for (let i = 0; i < 5; i++) {
      expect(decideH3Path(base, inside)).toEqual({
        useH3: true,
        reason: `rollout_percent_${riderBucket(inside)}`,
      });
      expect(decideH3Path(base, outside).useH3).toBe(false);
    }
    // Widening admits the outside rider; 0 excludes everyone; no rider id ->
    // legacy, never a coin flip.
    expect(decideH3Path({ ...base, h3_rollout_percent: 100 }, outside).useH3).toBe(true);
    expect(decideH3Path({ ...base, h3_rollout_percent: 0 }, inside).useH3).toBe(false);
    expect(decideH3Path(base, null)).toEqual({ useH3: false, reason: "rollout_percent_no_rider" });
    // Bucket is deterministic and in range.
    expect(riderBucket(inside)).toBe(riderBucket(inside));
    expect(riderBucket(inside)).toBeGreaterThanOrEqual(0);
    expect(riderBucket(inside)).toBeLessThan(100);
  });

  it("master kill switch overrides mode 'all' and the allowlist", () => {
    const off = {
      h3_matching_enabled: false,
      h3_rollout_mode: "all" as const,
      h3_rollout_rider_ids: ["rider-a"],
      h3_rollout_percent: 100,
    };
    expect(decideH3Path(off, "rider-a")).toEqual({ useH3: false, reason: "kill_switch_off" });
    expect(decideH3Path({ ...off, h3_rollout_mode: "allowlist" }, "rider-a")).toEqual({
      useH3: false,
      reason: "kill_switch_off",
    });
    // Switch back on -> mode decides again.
    expect(decideH3Path({ ...off, h3_matching_enabled: true }, "rider-a").useH3).toBe(true);
  });

  it("kill switch off serves legacy even in mode 'all', and records why", async () => {
    patchConfig({
      h3_matching_enabled: false,
      h3_rollout_mode: "all",
      h3_rollout_percent: 100,
    });
    const idx = makeIndex([cellDriver("driver-1")]);
    setDriverIndex(idx);
    db.query.mockResolvedValueOnce([sqlDriver("driver-9", 0.4)]);

    const cands = await findCandidates(
      "ride-1",
      SANDTON.lat,
      SANDTON.lng,
      1,
      false,
      1,
      "rider-a"
    );

    expect(cands.map((c) => c.id)).toEqual(["driver-9"]);
    expect(idx.getDriversInCells).not.toHaveBeenCalled();
    expect(traceStage("matching_path")[0]).toMatchObject({
      path: "legacy",
      reason: "kill_switch_off",
    });
  });

  it("seed default (enabled + mode 'off') serves legacy with reason rollout_off", async () => {
    patchConfig({ h3_matching_enabled: true }); // mode stays 'off' as seeded
    db.query.mockResolvedValueOnce([]);

    await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 3, false, 1, "rider-a");

    expect(traceStage("matching_path")[0]).toMatchObject({
      path: "legacy",
      reason: "rollout_off",
    });
  });
});

describe("stale eviction sweep", () => {
  it("evicts using stale_seconds from config", async () => {
    patchConfig({ stale_seconds: 40 });
    const idx = makeIndex([], { evictStale: vi.fn(async () => 3) });
    setDriverIndex(idx);

    const n = await evictStaleIndexOnce();

    expect(n).toBe(3);
    expect(idx.evictStale).toHaveBeenCalledWith(40);
  });

  it("never runs two instances at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const idx = makeIndex([], {
      evictStale: vi.fn(async () => {
        await gate;
        return 5;
      }),
    });
    setDriverIndex(idx);

    const first = evictStaleIndexOnce();
    const second = await evictStaleIndexOnce(); // previous run still going
    expect(second).toBe(0);

    release();
    expect(await first).toBe(5);
    expect(idx.evictStale).toHaveBeenCalledTimes(1);
  });
});
