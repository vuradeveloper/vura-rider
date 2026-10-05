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

/** Reset every mock and restore default behaviour between tests. */
export function resetHarness() {
  vi.clearAllMocks();
  db.execute.mockResolvedValue({ rowCount: 1, rows: [] });
  notify.sendPushToUsers.mockResolvedValue(1);
}

/** A fake io that records every (room, event, payload) emission. */
export function makeIo() {
  const emitted: { room: string; event: string; payload: any }[] = [];
  const io = {
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