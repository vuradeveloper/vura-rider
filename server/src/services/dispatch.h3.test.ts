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
} from "./dispatch";
import {
  getDriverIndex,
  setDriverIndex,
  type DriverIndex,
  type IndexedDriver,
} from "./driverIndex";
import { setRoadEtaImpl, resetRoadEtaImpl } from "./eta";
import { evictStaleIndexOnce } from "./offerWorker";

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
    // The RIDER is told — not a silent stop.
    expect(emitted.some((e) => e.event === "ride:no:drivers")).toBe(true);
    expect(rideEvents("no_drivers").length).toBe(1);
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
        getDriversInCells: vi.fn(async () => {
          throw new Error("index exploded");
        }),
      })
    );
    db.query.mockResolvedValueOnce([sqlDriver("driver-9", 0.4)]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 1, false, 1);

    // The rider still gets candidates — from the OLD query.
    expect(cands.map((c) => c.id)).toEqual(["driver-9"]);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).not.toContain("driver_blocks"); // haversine shape, not H3
    // The failure is LOUD, not silent.
    const failed = traceStage("h3_path_failed");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].error)).toContain("index exploded");
  });

  it("falls back when the index is empty instead of reporting false no-drivers", async () => {
    setH3Enabled(true);
    setDriverIndex(makeIndex([])); // nobody pinged since boot
    db.query.mockResolvedValueOnce([sqlDriver("driver-9", 0.4)]);

    const cands = await findCandidates("ride-1", SANDTON.lat, SANDTON.lng, 1, false, 1);

    expect(cands).toHaveLength(1);
    expect(traceStage("h3_index_empty")).toHaveLength(1);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).not.toContain("driver_blocks"); // haversine fallback ran
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
    // driver-1 was removed from the SQL ids param by the busy-lock filter.
    const call = h3CandidateCall();
    expect(call![1][0]).toEqual(["driver-2"]);
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
