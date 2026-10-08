// ─────────────────────────────────────────────────────────────────────────────
// DESTINATION FILTER — predicate wiring inside findCandidatesH3 ONLY
// (flag-OFF legacy path never executes it). Covers: flag gate, allowlist
// rollout, in/out of destination mode, fitting vs non-fitting drop-offs,
// null drop-off, and Q13 per-driver fail-closed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./notify", async () => (await import("./testHarness")).notify);
vi.mock("./vehicleImages", async () => (await import("./testHarness")).vehicleImages);
vi.mock("./config", async () => (await import("./testHarness")).appConfig);
vi.mock("./destinationFit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./destinationFit")>();
  return { ...mod, destinationFit: vi.fn(mod.destinationFit) };
});

import { findCandidates } from "./dispatch";
import { destinationFit } from "./destinationFit";
import { db, resetHarness, setH3Enabled, patchDestinationConfig, traceStage } from "./testHarness";
import { setDriverIndex } from "./driverIndex";
import { getCounters } from "./metrics";

const ROWS: any[] = [
  { id: "driver-1", firebase_uid: "fb-1", current_lat: -26.10, current_lng: 28.05, distance_km: 0.5 },
  { id: "driver-2", firebase_uid: "fb-2", current_lat: -26.105, current_lng: 28.055, distance_km: 1.0 },
];
// driver-1 heads to (−26.10, 28.06): 1.11 km north of its position.
const DEST_D1 = { destination_lat: -26.10, destination_lng: 28.06 };
const FITTING_X = { destination_lat: -26.10, destination_lng: 28.055 }; // 0.56 km before T → (c1)
const FAR_X = { destination_lat: -26.10, destination_lng: 27.95 }; // far behind → (b) fails
const PICKUP = { lat: -26.10, lng: 28.04 };

function fakeIndex(ids: string[]): void {
  const now = new Date().toISOString();
  setDriverIndex({
    getDriversInCells: vi.fn(async () => ids.map((id) => ({ userId: id, lastSeenAt: now }) as any)),
    countFresh: vi.fn(async () => ids.length), // rollout guard: index is warm
    upsert: vi.fn(async () => null),
    getDriver: vi.fn(async () => null),
    remove: vi.fn(async () => false),
    evictStale: vi.fn(async () => 0),
    touch: vi.fn(async () => false),
  } as any);
}

function routeDb(opts: { ride: any; dests: any[] }): void {
  db.queryOne.mockImplementation(async (sql: string) =>
    String(sql).includes("FROM rides") ? (opts.ride as any) : null
  );
  db.query.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("destination_lat IS NOT NULL")) return opts.dests as any; // destinations query
    if (s.includes("= ANY($1::uuid[])")) return ROWS as any; // eligibility SQL
    return [];
  });
}

const idsOf = (cands: { id: string }[]) => cands.map((c) => c.id);

beforeEach(() => {
  resetHarness();
  setH3Enabled(true);
  fakeIndex(["driver-1", "driver-2"]);
});

describe("destination-mode filter in findCandidatesH3", () => {
  it("flag OFF: no ride/destination queries and no destination_filter stage", async () => {
    patchDestinationConfig({
      destination_matching_enabled: false,
      destination_rollout_driver_ids: ["driver-1"],
    });
    routeDb({ ride: FITTING_X, dests: [{ user_id: "driver-1", ...DEST_D1 }] });

    const cands = await findCandidates("ride-x", PICKUP.lat, PICKUP.lng, 5, false, 1);

    expect(idsOf(cands).sort()).toEqual(["driver-1", "driver-2"]);
    expect(traceStage("destination_filter")).toHaveLength(0);
    expect(db.queryOne.mock.calls.some((c) => String(c[0]).includes("FROM rides"))).toBe(false);
    expect(getCounters().destination_filtered).toBe(0);
  });

  it("enabled + allowlisted + fitting drop-off: kept, trace records 0 removed", async () => {
    patchDestinationConfig({
      destination_matching_enabled: true,
      destination_rollout_driver_ids: ["driver-1"],
    });
    routeDb({ ride: FITTING_X, dests: [{ user_id: "driver-1", ...DEST_D1 }] });

    const cands = await findCandidates("ride-x", PICKUP.lat, PICKUP.lng, 5, false, 1);

    expect(idsOf(cands).sort()).toEqual(["driver-1", "driver-2"]);
    expect(traceStage("destination_filter")[0]).toMatchObject({
      considered: 1,
      removed: 0,
      kept: 2,
    });
    expect(getCounters().destination_filtered).toBe(0);
  });

  it("ride with NO drop-off: destination-mode driver skipped, plain driver untouched", async () => {
    patchDestinationConfig({
      destination_matching_enabled: true,
      destination_rollout_driver_ids: ["driver-1"],
    });
    routeDb({
      ride: { destination_lat: null, destination_lng: null },
      dests: [{ user_id: "driver-1", ...DEST_D1 }],
    });

    const cands = await findCandidates("ride-x", PICKUP.lat, PICKUP.lng, 5, false, 1);

    expect(idsOf(cands)).toEqual(["driver-2"]);
    expect(traceStage("destination_filter")[0]).toMatchObject({
      considered: 1,
      removed: 1,
      kept: 1,
    });
    expect(getCounters().destination_filtered).toBe(1);
  });

  it("non-fitting drop-off: destination-mode driver removed", async () => {
    patchDestinationConfig({
      destination_matching_enabled: true,
      destination_rollout_driver_ids: ["driver-1"],
    });
    routeDb({ ride: FAR_X, dests: [{ user_id: "driver-1", ...DEST_D1 }] });

    const cands = await findCandidates("ride-x", PICKUP.lat, PICKUP.lng, 5, false, 1);

    expect(idsOf(cands)).toEqual(["driver-2"]);
    expect(traceStage("destination_filter")[0]).toMatchObject({ considered: 1, removed: 1 });
    expect(getCounters().destination_filtered).toBe(1);
  });

  it("allowlisted driver NOT in destination mode passes through (considered 0)", async () => {
    patchDestinationConfig({
      destination_matching_enabled: true,
      destination_rollout_driver_ids: ["driver-1"],
    });
    routeDb({ ride: FITTING_X, dests: [] });

    const cands = await findCandidates("ride-x", PICKUP.lat, PICKUP.lng, 5, false, 1);

    expect(idsOf(cands).sort()).toEqual(["driver-1", "driver-2"]);
    expect(traceStage("destination_filter")[0]).toMatchObject({ considered: 0, removed: 0 });
    expect(getCounters().destination_filtered).toBe(0);
  });

  it("Q13: a throwing predicate removes THAT driver only and counts the error", async () => {
    patchDestinationConfig({
      destination_matching_enabled: true,
      destination_rollout_driver_ids: ["driver-1"],
    });
    routeDb({ ride: FITTING_X, dests: [{ user_id: "driver-1", ...DEST_D1 }] });
    vi.mocked(destinationFit).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const cands = await findCandidates("ride-x", PICKUP.lat, PICKUP.lng, 5, false, 1);

    expect(idsOf(cands)).toEqual(["driver-2"]); // ride still served by everyone else
    expect(traceStage("destination_filter")[0]).toMatchObject({
      considered: 1,
      removed: 0,
      errors: 1,
    });
    expect(getCounters().destination_predicate_error).toBe(1);
    expect(getCounters().destination_filtered).toBe(0);
  });
});
