// ─────────────────────────────────────────────────────────────────────────────
// LOAD / CONCURRENCY SIMULATION (real Postgres)
//
// GATED: skipped unless VURA_LOADTEST=1.
//
//   $env:VURA_LOADTEST='1'
//   npx vitest run src/services/loadSim.integration.test.ts
//
// This file uses a DEDICATED local database (vura_loadtest on 127.0.0.1:5432).
// It creates tables and fixtures, so it must never point at production.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "crypto";

vi.mock("./notify", () => ({ sendPushToUsers: vi.fn(async () => 1) }));
vi.mock("./vehicleImages", () => ({ attachVehicleImages: vi.fn(async (x: any) => x) }));
vi.mock("./pinService", () => ({ mintRidePin: vi.fn(async () => undefined) }));
vi.mock("./config", async () => (await import("./testHarness")).appConfig);

import { query, queryOne, execute } from "../config/database";
import { acceptRide, cancelPendingOffers, expireOffers, offerToNextDriver, reviveWaitingRides } from "./dispatch";
import { sendPushToUsers } from "./notify";
import { makeIo, patchDestinationConfig } from "./testHarness";

const enabled = process.env.VURA_LOADTEST === "1";
const DB_HOST = "127.0.0.1";
const DB_PORT = process.env.VURA_LOADTEST_DB_PORT || "5432";
const DB_NAME = process.env.VURA_LOADTEST_DB_NAME || "vura_loadtest";

const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE,
  full_name TEXT, phone TEXT, email TEXT,
  profile_photo_url TEXT, role TEXT DEFAULT 'passenger',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_online BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'offline',
  current_lat DOUBLE PRECISION, current_lng DOUBLE PRECISION,
  current_heading DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ, last_heartbeat_at TIMESTAMPTZ,
  rating_avg NUMERIC(3,2) DEFAULT 0,
  vehicle_category VARCHAR(40), vehicle_make TEXT, vehicle_model TEXT,
  vehicle_color TEXT, vehicle_year INT, body_type TEXT, license_plate TEXT,
  vehicle_categories JSONB DEFAULT '[]'::jsonb,
  vehicle_seats INTEGER,
  vehicle_suspended BOOLEAN DEFAULT FALSE,
  destination_lat DOUBLE PRECISION,
  destination_lng DOUBLE PRECISION,
  destination_label TEXT,
  destination_expires_at TIMESTAMPTZ,
  verification_status VARCHAR(20),
  updated_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID REFERENCES users(id),
  driver_id UUID REFERENCES users(id),
  pickup_address TEXT, pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
  destination_address TEXT, destination_lat DOUBLE PRECISION, destination_lng DOUBLE PRECISION,
  status VARCHAR(30) DEFAULT 'searching',
  estimated_fare NUMERIC(10,2), payment_method TEXT, device_id TEXT,
  waypoints JSONB, offer_round INT DEFAULT 0, version INT DEFAULT 0,
  tier VARCHAR(20) NOT NULL DEFAULT 'go',
  scheduled_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
  no_drivers_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ride_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  decline_reason TEXT, round INT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ride_id, driver_id)
);
CREATE TABLE IF NOT EXISTS ride_events (
  id BIGSERIAL PRIMARY KEY,
  ride_id UUID, driver_id UUID, event TEXT, detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const BASE = { lat: -26.1076, lng: 28.0567 };

async function seedDriver(i: number, lat = BASE.lat, lng = BASE.lng): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO users (id, firebase_uid, role, full_name) VALUES ($1, $2, 'driver', $3)`,
    [id, `fb-load-d-${i}-${id.slice(0, 8)}`, `Load Driver ${i}`]
  );
  await execute(
    `INSERT INTO driver_profiles
       (user_id, is_online, status, current_lat, current_lng, last_location_at,
        last_heartbeat_at, rating_avg, vehicle_category, vehicle_categories,
        vehicle_seats, body_type, updated_at)
     VALUES ($1, TRUE, 'available', $2, $3, NOW(), NOW(), 4.8, 'sedan',
             '["go"]'::jsonb, 4, 'sedan', NOW())`,
    [id, lat, lng]
  );
  return id;
}

async function seedRider(i: number): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO users (id, role, full_name) VALUES ($1, 'passenger', $2)`,
    [id, `Load Rider ${i}`]
  );
  return id;
}

async function seedRide(
  riderId: string,
  status = "searching",
  destination = { lat: -26.145, lng: 28.04 },
  pickup = BASE
): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO rides
       (id, passenger_id, pickup_address, pickup_lat, pickup_lng,
        destination_address, destination_lat, destination_lng,
        status, estimated_fare, payment_method, tier, version)
     VALUES ($1, $2, 'Pickup', $3, $4, 'Destination', $5, $6, $7, 120, 'cash', 'go', 0)`,
    [id, riderId, pickup.lat, pickup.lng, destination.lat, destination.lng, status]
  );
  return id;
}

async function setDriverDestination(
  driverId: string,
  lat: number,
  lng: number
): Promise<void> {
  await execute(
    `UPDATE driver_profiles
        SET destination_lat = $2, destination_lng = $3, destination_label = 'Load destination',
            destination_expires_at = NOW() + INTERVAL '2 hours'
      WHERE user_id = $1`,
    [driverId, lat, lng]
  );
}

beforeAll(async () => {
  process.env.DB_HOST = DB_HOST;
  process.env.DB_PORT = DB_PORT;
  process.env.DB_NAME = DB_NAME;
  process.env.DB_USER = process.env.VURA_LOADTEST_DB_USER || "vura_admin";
  process.env.DB_PASSWORD = process.env.VURA_LOADTEST_DB_PASSWORD || "vura2thinkdifferent";
  process.env.DB_SSL = "false";

  if (!enabled) return;
  if (DB_NAME !== "vura_loadtest") {
    throw new Error(`[loadsim] refusing to wipe ${DB_NAME}; use vura_loadtest only`);
  }

  await execute(CORE_SCHEMA);
  await execute(`
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'go';
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_categories JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_seats INTEGER;
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS body_type VARCHAR(30);
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_suspended BOOLEAN DEFAULT FALSE;
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION;
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION;
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_label TEXT;
    ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS destination_expires_at TIMESTAMPTZ;
  `);

  // Mirrors the production invariants.
  await execute(`DROP INDEX IF EXISTS idx_ride_offers_one_active_per_driver`);
  await execute(`
    CREATE UNIQUE INDEX idx_ride_offers_one_active_per_driver
      ON ride_offers (driver_id) WHERE status = 'pending'
  `);
  await execute(`DROP INDEX IF EXISTS idx_rides_one_active_per_driver`);
  await execute(`
    CREATE UNIQUE INDEX idx_rides_one_active_per_driver
      ON rides(driver_id)
      WHERE driver_id IS NOT NULL
        AND status IN ('accepted','driver_arrived','in_progress')
  `);
  await execute(`DROP INDEX IF EXISTS idx_rides_one_active_per_passenger`);
  await execute(`
    CREATE UNIQUE INDEX idx_rides_one_active_per_passenger
      ON rides(passenger_id)
      WHERE passenger_id IS NOT NULL
        AND status IN ('searching','scheduled','accepted','driver_arrived','in_progress')
  `);

  // Fresh run.
  await execute(`DELETE FROM ride_events`);
  await execute(`DELETE FROM ride_offers`);
  await execute(`DELETE FROM rides`);
  await execute(`DELETE FROM driver_profiles`);
  await execute(`DELETE FROM users`);
  await execute(`DELETE FROM app_config`);
});

describe.skipIf(!enabled)("Vura load / concurrency", () => {
  it("offers every ride when 100 riders hit 100 available drivers at once", async () => {
    const drivers: string[] = [];
    for (let i = 0; i < 100; i++) {
      // Spread them across ~5 km so each ride has a real local pool.
      drivers.push(await seedDriver(i, BASE.lat + (i % 20) * 0.002, BASE.lng + Math.floor(i / 20) * 0.002));
    }

    const rides: string[] = [];
    for (let i = 0; i < 100; i++) {
      const rider = await seedRider(i);
      rides.push(await seedRide(rider));
    }

    const io = makeIo(true).io;
    const results = await Promise.allSettled(
      rides.map((rideId) => offerToNextDriver(io, rideId))
    );

    const offered = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any).offered === true
    ).length;
    const conflicts = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any).reason === "offer_conflict"
    ).length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    const countOfferedRides = async () => {
      const rows = await query<{ n: string }>(
        `SELECT COUNT(DISTINCT ride_id)::text AS n FROM ride_offers`
      );
      return Number(rows[0]?.n || 0);
    };
    let distinct = await countOfferedRides();

    // The offer worker retries rides with no live offer every 2s. Simulate those
    // ticks here: the first retry is gated on the ride being 6s old.
    for (let attempt = 0; attempt < 12 && distinct < 100; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, attempt === 0 ? 7000 : 2000)
      );
      // Simulate the driver fleet heartbeating (production drivers send GPS +
      // heartbeat every few seconds; without this the 20s freshness window
      // correctly hides every seeded driver after the first 20 seconds).
      await execute(
        `UPDATE driver_profiles
            SET last_location_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()`
      );
      // The real worker does BOTH: reap expired offers, then revive waiting rides.
      await expireOffers(io);
      const revived = await reviveWaitingRides(io, 25);
      distinct = await countOfferedRides();
      console.log(
        `[loadsim] retry ${attempt + 1}: revived=${revived}, distinct_ride_offers=${distinct}`
      );
    }

    console.log(
      `[loadsim] 100 rides / 100 drivers -> initial_offered=${offered}, distinct_ride_offers=${distinct}, offer_conflict=${conflicts}, rejected=${rejected}`
    );

    // The load contract: every rider must eventually get an offer. The burst
    // itself only covers the first pool; the worker drains the rest.
    expect(distinct).toBe(100);
    expect(rejected).toBe(0);
  }, 120_000);

  it("never lets one driver accept two rides at once", async () => {
    const driver = await seedDriver(500, BASE.lat, BASE.lng);
    const r1 = await seedRide(await seedRider(500));
    const r2 = await seedRide(await seedRider(501));
    const io = makeIo(true).io;

    const results = await Promise.allSettled([
      acceptRide(io, { rideId: r1, driverId: driver }),
      acceptRide(io, { rideId: r2, driverId: driver }),
    ]);

    const ok = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any).ok === true
    ).length;
    const rejected = results.filter((r) => r.status === "rejected");
    const active = await query<{ id: string }>(
      `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('accepted','driver_arrived','in_progress')`,
      [driver]
    );

    console.log(
      `[loadsim] one driver / two rides -> ok=${ok}, active=${active.length}, rejected=${rejected.length}` +
        (rejected.length
          ? ` (${rejected.map((r) => String((r as PromiseRejectedResult).reason?.message || (r as PromiseRejectedResult).reason).slice(0, 120)).join(" | ")})`
          : "")
    );

    expect(active.length).toBe(1);
    expect(rejected.length).toBe(0); // a clash must be a clean business error, not a 500
  }, 60_000);

  it("never lets two drivers accept the same ride", async () => {
    const rider = await seedRider(600);
    const ride = await seedRide(rider);
    const d1 = await seedDriver(600, BASE.lat, BASE.lng);
    const d2 = await seedDriver(601, BASE.lat + 0.001, BASE.lng + 0.001);
    await execute(
      `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at, round)
       VALUES ($1, $2, 'pending', NOW() + INTERVAL '15 seconds', 1)`,
      [ride, d1]
    );
    const io = makeIo(true).io;

    const results = await Promise.allSettled([
      acceptRide(io, { rideId: ride, driverId: d1 }),
      acceptRide(io, { rideId: ride, driverId: d2 }),
    ]);

    const ok = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any).ok === true
    ).length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    const assigned = await query<{ driver_id: string }>(
      `SELECT driver_id FROM rides WHERE id = $1 AND driver_id IS NOT NULL`,
      [ride]
    );

    console.log(
      `[loadsim] two drivers / one ride -> ok=${ok}, assigned=${assigned.length}, rejected=${rejected}`
    );

    expect(ok).toBe(1);
    expect(assigned.length).toBe(1);
    expect(rejected).toBe(0);
  }, 60_000);

  it("creates one live ride per rider under a double-tap", async () => {
    const rider = await seedRider(700);
    const insert = `INSERT INTO rides
      (passenger_id, pickup_address, pickup_lat, pickup_lng,
       destination_address, destination_lat, destination_lng,
       status, estimated_fare, payment_method, tier, version)
      VALUES ($1, 'Sandton', $2, $3, 'Rosebank', $4, $5, 'searching', 120, 'cash', 'go', 0)
      RETURNING id`;

    // Mirrors the socket/REST booking path: try to insert, and on the
    // one-active-per-passenger unique violation reuse the winning ride.
    const request = async () => {
      try {
        return await queryOne<{ id: string }>(insert, [
          rider,
          BASE.lat,
          BASE.lng,
          -26.145,
          28.04,
        ]);
      } catch (err: any) {
        if (String(err?.code) === "23505") {
          return await queryOne<{ id: string }>(
            `SELECT id FROM rides WHERE passenger_id = $1
              AND status IN ('searching','scheduled','accepted','driver_arrived','in_progress')
              ORDER BY created_at DESC LIMIT 1`,
            [rider]
          );
        }
        throw err;
      }
    };

    const results = await Promise.all(Array.from({ length: 10 }, request));
    const ids = new Set(results.map((r) => r?.id).filter(Boolean));
    const active = await query<{ id: string }>(
      `SELECT id FROM rides WHERE passenger_id = $1
        AND status IN ('searching','scheduled','accepted','driver_arrived','in_progress')`,
      [rider]
    );

    console.log(
      `[loadsim] double-tap -> distinct_ids=${ids.size}, active_rides=${active.length}`
    );

    expect(ids.size).toBe(1);
    expect(active.length).toBe(1);
  }, 60_000);

  it("drops every other driver's offer the instant one driver accepts", async () => {
    const rider = await seedRider(800);
    const ride = await seedRide(rider);
    const winners = await Promise.all([
      seedDriver(800, BASE.lat, BASE.lng),
      seedDriver(801, BASE.lat + 0.001, BASE.lng + 0.001),
      seedDriver(802, BASE.lat + 0.002, BASE.lng + 0.002),
    ]);
    for (const driver of winners) {
      await execute(
        `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at, round)
         VALUES ($1, $2, 'pending', NOW() + INTERVAL '15 seconds', 1)`,
        [ride, driver]
      );
    }

    const { io, emitted } = makeIo(true);
    const won = await acceptRide(io, { rideId: ride, driverId: winners[0] });
    expect(won.ok).toBe(true);

    const offers = await query<{ driver_id: string; status: string }>(
      `SELECT driver_id, status FROM ride_offers WHERE ride_id = $1`,
      [ride]
    );
    const losers = offers.filter((o) => o.driver_id !== winners[0]);
    const drops = emitted.filter(
      (e) => e.event === "ride:offer:cancelled" && e.payload?.rideId === ride
    );

    console.log(
      `[loadsim] accept cleared offers -> expired=${losers.filter((o) => o.status === "expired").length}, drop_events=${drops.length}`
    );

    expect(losers.every((o) => o.status === "expired")).toBe(true);
    expect(drops.length).toBe(2);

    // The race is already over: a late Accept must get the precise reason,
    // not a generic "no longer available".
    const late = await acceptRide(io, { rideId: ride, driverId: winners[1] });
    console.log(`[loadsim] late accept -> ok=${late.ok}, error=${late.error || ""}`);
    expect(late.ok).toBe(false);
    expect(String(late.error)).toMatch(/already picked up/i);
  }, 60_000);

  it("refuses a cancelled ride with a rider-cancelled message", async () => {
    const rider = await seedRider(810);
    const ride = await seedRide(rider, "cancelled");
    const driver = await seedDriver(810, BASE.lat, BASE.lng);
    const { io } = makeIo(true);

    const refused = await acceptRide(io, { rideId: ride, driverId: driver });
    console.log(
      `[loadsim] cancelled accept -> ok=${refused.ok}, error=${refused.error || ""}`
    );

    expect(refused.ok).toBe(false);
    expect(String(refused.error)).toMatch(/rider already cancelled/i);
  }, 60_000);

  it("removes a pending offer on rider cancel without notifying the driver", async () => {
    const rider = await seedRider(820);
    const ride = await seedRide(rider);
    const driver = await seedDriver(820, BASE.lat, BASE.lng);
    await execute(
      `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at, round)
       VALUES ($1, $2, 'pending', NOW() + INTERVAL '15 seconds', 1)`,
      [ride, driver]
    );

    const { io, emitted } = makeIo(true);
    const before = vi.mocked(sendPushToUsers).mock.calls.length;
    const cancelled = await cancelPendingOffers(io, ride, "rider_cancelled");
    const after = vi.mocked(sendPushToUsers).mock.calls.length;
    const offer = await queryOne<{ status: string }>(
      `SELECT status FROM ride_offers WHERE ride_id = $1 AND driver_id = $2`,
      [ride, driver]
    );
    const drop = emitted.find(
      (e) => e.event === "ride:offer:cancelled" && e.payload?.rideId === ride
    );

    console.log(
      `[loadsim] rider cancel -> offers=${cancelled}, status=${offer?.status}, drop_event=${!!drop}, push_delta=${after - before}`
    );

    expect(cancelled).toBe(1);
    expect(offer?.status).toBe("expired");
    expect(!!drop).toBe(true);
    expect(after - before).toBe(0); // no "rider cancelled" push before acceptance
  }, 60_000);

  it("offers only rides heading toward a driver's set destination", async () => {
    patchDestinationConfig({
      destination_matching_enabled: true,
      destination_rollout_mode: "all",
      destination_rollout_driver_ids: [],
    });
    try {
      // Isolate this scenario: earlier tests leave available drivers behind, and
      // the legacy matcher does not apply a radius, so take them offline first.
      await execute(`UPDATE driver_profiles SET is_online = FALSE, status = 'offline'`);

      // Use a separate area (Pretoria) so drivers left over from earlier tests
      // are far outside the matching radius.
      const DEST_BASE = { lat: -25.75, lng: 28.2 };
      // Both drivers are in Pretoria and want to finish near the north side.
      const driverToward = await seedDriver(900, DEST_BASE.lat, DEST_BASE.lng);
      await setDriverDestination(driverToward, -25.64, DEST_BASE.lng);
      const driverAway = await seedDriver(901, DEST_BASE.lat + 0.001, DEST_BASE.lng + 0.001);
      await setDriverDestination(driverAway, -25.64, DEST_BASE.lng);

      // Toward: drop-off 2.2 km short of the destination; closer than pickup.
      const towardRide = await seedRide(
        await seedRider(900),
        "searching",
        { lat: -25.66, lng: DEST_BASE.lng },
        DEST_BASE
      );
      // Away: drop-off 22 km south; farther from the destination than pickup.
      const awayRide = await seedRide(
        await seedRider(901),
        "searching",
        { lat: -25.84, lng: DEST_BASE.lng },
        DEST_BASE
      );

      const { io } = makeIo(true);
      const toward = await offerToNextDriver(io, towardRide);
      const away = await offerToNextDriver(io, awayRide);
      const awayOffers = await query<{ id: string }>(
        `SELECT id FROM ride_offers WHERE ride_id = $1`,
        [awayRide]
      );
      const awayStatus = await queryOne<{ status: string }>(
        `SELECT status FROM rides WHERE id = $1`,
        [awayRide]
      );

      console.log(
        `[loadsim] destination mode -> toward=${toward.offered}, away=${away.offered}, away_offers=${awayOffers.length}, away_status=${awayStatus?.status}`
      );

      expect(toward.offered).toBe(true);
      expect(away.offered).toBe(false);
      expect(awayOffers.length).toBe(0);
      expect(awayStatus?.status).toBe("no_drivers");
    } finally {
      patchDestinationConfig({
        destination_matching_enabled: false,
        destination_rollout_mode: "allowlist",
        destination_rollout_driver_ids: [],
      });
    }
  }, 60_000);
});
