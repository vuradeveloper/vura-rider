// ─────────────────────────────────────────────────────────────────────────────
// SHARED TEST HARNESS
//
// There is no test framework in this repo, so this module provides the mocks
// every dispatch test needs: a fake database (no live Postgres, so the suite
// cannot mutate production data) and a fake socket.io server that RECORDS what
// was emitted instead of sending it.
//
// Why mocks rather than a real database: these tests must run in milliseconds,
// in CI and on a laptop, with no credentials and no network. They pin BEHAVIOUR
// (who gets offered, over which channel, what the rider is told) rather than
// exact SQL text -- pinning SQL strings would fail on harmless rewording while
// still missing the real risk, which is a behavioural regression.
// ─────────────────────────────────────────────────────────────────────────────
import { vi } from "vitest";
import { setRoadEtaImpl } from "./eta";
import { resetCounters } from "./metrics";

// NOTE ON vi.hoisted: these mocks CANNOT be created with vi.hoisted() here,
// because hoisted variables may not be exported from a helper module ("Cannot
// export hoisted variable"). Plain vi.fn() at module scope is fine, and the test
// files mock with an async factory -- `vi.mock(p, async () => (await import(...)).db)`
// -- which is evaluated after hoisting, so the reference resolves correctly.
export const db = {
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(),
};

export const notify = { sendPushToUsers: vi.fn() };

export const vehicleImages = { attachVehicleImages: vi.fn() };

// ── CONFIG MOCK (flag-OFF by default) ────────────────────────────────────────
// dispatch.getConfig must NOT hit db.queryOne: the real config module would
// consume the mockImplementationOnce queue that loadRide/queueOffer rely on,
// and its DEFAULT flag is ON, which would silently flip the legacy tests onto
// the H3 path. Test files therefore add:
//   vi.mock("./config", async () => (await import("./testHarness")).appConfig);
// Flag-on tests call setH3Enabled(true); everything resets to OFF in
// resetHarness() (beforeEach).
export const TEST_CONFIG = {
  h3_matching_enabled: false,
  match_radius_km: [3, 5, 7] as number[],
  search_timeout_ms: 90_000,
  still_looking_msg_ms: 30_000,
  h3_match_res: 8,
  h3_heatmap_res: 7,
  stale_seconds: 40,
  max_position_age_seconds: 300,
  offer_ttl_seconds: 15,
  avg_speed_kmh: 40,
  min_driver_rating: 0,
  required_vehicle_category: null as string | null,
  h3_rollout_mode: "off" as "off" | "allowlist" | "percent" | "all",
  h3_rollout_rider_ids: [] as string[],
  h3_rollout_percent: 0,
};

// ── Module 2 config mock (flag OFF by default; seed = 002) ───────────────────
export const TEST_DEST_CONFIG = {
  destination_matching_enabled: false,
  destination_rollout_driver_ids: [] as string[],
  destination_max_activations_per_day: 2,
  destination_reject_radius_km: 1,
  destination_arrival_radius_km: 0.5,
  destination_offline_grace_seconds: 300,
  destination_timeout_hours: 3,
  destination_match_dropoff_radius_km: 3,
  destination_match_cross_track_km: 5,
  destination_match_along_tolerance_km: 0.5,
};

let destConfigState = { ...TEST_DEST_CONFIG };

/** Change any destination config value for one test. */
export function patchDestinationConfig(patch: Partial<typeof TEST_DEST_CONFIG>): void {
  Object.assign(destConfigState, patch);
}

let configState = { ...TEST_CONFIG };

export const appConfig = {
  getConfig: vi.fn(async (_force?: boolean) => ({ ...configState })),
  getDestinationConfig: vi.fn(async (_force?: boolean) => ({ ...destConfigState })),
  h3MatchingEnabled: vi.fn(async () => configState.h3_matching_enabled),
  invalidateConfigCache: vi.fn(),
  seedConfig: vi.fn(async () => undefined),
  allConfig: vi.fn(async () => ({ matching: { ...configState } })),
  DEFAULT_CONFIG: { ...TEST_CONFIG },
};

/**
 * Flip the master kill-switch for one test.
 * `true` also sets rollout mode 'all' (flag-on tests exercise full rollout;
 * use patchConfig({ h3_rollout_mode, ... }) for allowlist/percent scenarios).
 * `false` mirrors the seed: mode back to 'off'.
 */
export function setH3Enabled(on: boolean): void {
  configState.h3_matching_enabled = on;
  configState.h3_rollout_mode = on ? "all" : "off";
}

/** Change any config value for one test (stale_seconds, ladder, ...). */
export function patchConfig(patch: Partial<typeof TEST_CONFIG>): void {
  Object.assign(configState, patch);
}

/** Reset every mock and restore default behaviour between tests. */
export function resetHarness() {
  vi.clearAllMocks();
  db.execute.mockResolvedValue({ rowCount: 1, rows: [] });
  notify.sendPushToUsers.mockResolvedValue(1);
  // Flag OFF + default thresholds: legacy tests exercise the haversine path.
  configState = { ...TEST_CONFIG };
  destConfigState = { ...TEST_DEST_CONFIG };
  destConfigState = { ...TEST_DEST_CONFIG };
  // Dispatch counters start at zero for every test.
  resetCounters();
  // No network under vitest: road ETA always uses the haversine fallback
  // unless a test injects its own provider via setRoadEtaImpl().
  setRoadEtaImpl(null);
  // withTransaction is only exercised by the flag-ON busy-lock; default to a
  // fake client reporting "no pending offers anywhere".
  db.withTransaction.mockImplementation(async (fn: any) =>
    fn({
      query: async () => ({ rows: [], rowCount: 0 }),
    })
  );
}

/**
 * A fake io that records every (room, event, payload) emission.
 *
 * `connected` mirrors the socket.io v4 adapter: dispatch.hasLiveSocket reads
 * io.sockets.adapter.rooms.get(room) to decide socket_connected at emit time.
 *   true (default) -> every room has a live socket (a healthy, connected driver)
 *   false          -> nobody is connected anywhere
 *   fn(room)       -> per-room control, e.g. makeIo((r) => r === "user:fb-d2")
 */
export function makeIo(connected: boolean | ((room: string) => boolean) = true) {
  const emitted: { room: string; event: string; payload: any }[] = [];
  const isConnected = typeof connected === "function" ? connected : () => connected;
  const rooms = {
    get: (room: string): { size: number } | undefined =>
      isConnected(room) ? { size: 1 } : undefined,
  };
  const io = {
    sockets: { adapter: { rooms } },
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
  return { io: io as any, emitted };
}

export const RIDE = {
  id: "ride-1",
  status: "searching",
  passenger_id: "rider-1",
  pickup_address: "Sandton",
  pickup_lat: -26.1076,
  pickup_lng: 28.0567,
  destination_address: "Rosebank",
  destination_lat: -26.145,
  destination_lng: 28.04,
  estimated_fare: 120,
  payment_method: "cash",
  waypoints: [],
  offer_round: 0,
  version: 1,
  passenger_fb: "fb-rider",
};

export const DRIVER_NEAR = {
  id: "driver-1",
  firebase_uid: "fb-d1",
  current_lat: -26.1,
  current_lng: 28.05,
  distance_km: 0.4,
};

/** Point loadRide() at a ride row. */
export function mockRide(overrides: Partial<typeof RIDE> = {}) {
  db.queryOne.mockImplementation(async (sql: string) => {
    if (String(sql).includes("FROM rides r")) return { ...RIDE, ...overrides };
    return null;
  });
}

/** Queue the candidates query, then the ride_offers INSERT. */
export function queueOffer(candidates: any[] = [DRIVER_NEAR]) {
  db.query.mockResolvedValueOnce(candidates);
  db.queryOne
    .mockImplementationOnce(async () => ({ ...RIDE }))
    .mockImplementationOnce(async () => ({ id: "offer-1", expires_at: "2026-01-01T00:00:15Z" }));
}

/**
 * Rows written by trace(), already parsed.
 *
 * Kept deliberately separate from logRideEvent() rows because the two writers put
 * the stage in DIFFERENT parameter slots:
 *   trace()          -> [rideId, `trace:<stage>`, detailJson]   (index 1)
 *   logRideEvent()   -> [rideId, driverId, event, detailJson]  (index 2)
 * A single loose matcher silently returns the logRideEvent row first (it is
 * written earlier in the flow) and JSON.parse then blows up on a bare string.
 */
export function traceStage(stage: string): any[] {
  return db.execute.mock.calls
    .filter((c: any[]) =>
      String(c[0]).includes("INSERT INTO ride_events") && c[1]?.[1] === `trace:${stage}`
    )
    .map((c: any[]) => JSON.parse(c[1][2]));
}

/** Rows written by logRideEvent() for an exact event name. */
export function rideEvents(name: string) {
  return db.execute.mock.calls.filter((c: any[]) =>
    String(c[0]).includes("INSERT INTO ride_events") && c[1]?.[2] === name
  );
}