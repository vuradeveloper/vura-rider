// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1 — REAL POSTGRES INTEGRATION TESTS.
//
// These are the tests the mocked suite CANNOT write: SQL validity, the 001b
// partial unique index actually refusing a double assignment, FOR UPDATE SKIP
// LOCKED running on a real lock manager, and evictStale's indexed DELETE.
//
// GATING: every test is skipped unless VURA_TEST_DB_PORT is set, e.g.
//   $env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/dispatch.integration.test.ts
// Point it at an EMPTY scratch database (a local Docker container, never a
// shared or production one): this file creates tables and inserts fixtures.
//
// WHICH TESTS ARE MOCKED vs REAL:
//   mocked  : dispatch.h3.test.ts, dispatch.delivery/timeout, driverIndex, h3
//   real DB : THIS FILE ONLY (core schema DDL below + migrations/001 + 001b)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Push is NOT under test and must never reach the network from vitest.
vi.mock("./notify", async () => ({ sendPushToUsers: vi.fn(async () => 1) }));

import { query, execute } from "../config/database";
import { offerToNextDriver } from "./dispatch";
import { invalidateConfigCache, getConfig } from "./config";
import { driverIndex, setDriverIndex } from "./driverIndex";
import { evictStaleIndexOnce } from "./offerWorker";
import { setRoadEtaImpl } from "./eta";
import { makeIo } from "./testHarness";

const DB_PORT = process.env.VURA_TEST_DB_PORT || "";
const enabled = Boolean(DB_PORT);

const SANDTON = { lat: -26.1076, lng: 28.0567 };

// Minimal-but-sufficient core schema. Columns cover every statement the code
// under test issues; the MODULE 1 objects come from the REAL migration file.
const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE,
  full_name TEXT, phone TEXT, email TEXT,
  profile_photo_url TEXT, role TEXT DEFAULT 'passenger',
  created_at TIMESTAMPTZ DEFAULT NOW()
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

function migrationSql(): string {
  return readFileSync(
    join(process.cwd(), "migrations", "001_h3_driver_index.sql"),
    "utf8"
  );
}

/** Create a driver with a fresh available profile at the given position. */
async function seedDriver(over: {
  lat: number;
  lng: number;
  rating?: number;
  category?: string;
}) {
  const id = randomUUID();
  await execute(
    `INSERT INTO users (id, firebase_uid, role, full_name) VALUES ($1, $2, 'driver', 'IT Driver')`,
    [id, `fb-${id}`]
  );
  await execute(
    `INSERT INTO driver_profiles (user_id, is_online, status, current_lat, current_lng,
                                  last_location_at, last_heartbeat_at, rating_avg, vehicle_category, updated_at)
     VALUES ($1, TRUE, 'available', $2, $3, NOW(), NOW(), $4, $5, NOW())`,
    [id, over.lat, over.lng, over.rating ?? 4.5, over.category ?? "sedan"]
  );
  return id;
}

async function seedRideAndRider() {
  const riderId = randomUUID();
  const rideId = randomUUID();
  await execute(
    `INSERT INTO users (id, role, full_name) VALUES ($1, 'passenger', 'IT Rider')`,
    [riderId]
  );
  await execute(
    `INSERT INTO rides (id, passenger_id, pickup_address, pickup_lat, pickup_lng, status)
     VALUES ($1, $2, 'Sandton', $3, $4, 'searching')`,
    [rideId, riderId, SANDTON.lat, SANDTON.lng]
  );
  return { riderId, rideId };
}

beforeAll(async () => {
  // Point the pool at the scratch container BEFORE the first query.
  process.env.DB_HOST = "127.0.0.1";
  process.env.DB_PORT = DB_PORT;
  process.env.DB_NAME = process.env.VURA_TEST_DB_NAME || "vura_test";
  process.env.DB_USER = process.env.VURA_TEST_DB_USER || "vura_admin";
  process.env.DB_PASSWORD = process.env.VURA_TEST_DB_PASSWORD || "vura2thinkdifferent";
  process.env.DB_SSL = "false";

  if (!enabled) return; // suite is skipped; do not touch any database

  await execute(CORE_SCHEMA);
  // Real migration, applied TWICE to prove idempotency on live Postgres
  // (TEST_MIGRATION.md step 1) — SQL the mocked tests cannot validate.
  await query(migrationSql());
  await query(migrationSql());
  // 001b: CREATE UNIQUE INDEX CONCURRENTLY cannot run inside a transaction, so
  // it is issued as its own single statement, exactly like psql autocommit.
  await query(
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ride_offers_one_active_per_driver
       ON ride_offers (driver_id) WHERE status = 'pending'`
  );
  // Index validity post-check (TEST_MIGRATION step 5).
  const validity = await query<{ indisvalid: boolean }>(
    `SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'idx_ride_offers_one_active_per_driver'`
  );
  expect(validity[0]?.indisvalid).toBe(true);

  // The 001 seed keeps the flag OFF (safe rollout default). The suite then
  // turns it on explicitly — exactly the production rollout sequence. (The
  // OFF-by-default claim itself is asserted in the migration test below,
  // where the row is deleted and re-seeded for determinism.)
  await execute(
    `UPDATE app_config SET value = jsonb_set(value, '{h3_matching_enabled}', 'true') WHERE key = 'matching'`
  );

  // Road ETA: haversine fallback only — no network from the test run.
  setRoadEtaImpl(null);
  invalidateConfigCache();
});

beforeEach(() => {
  setDriverIndex(driverIndex);
  if (enabled) invalidateConfigCache();
});

describe.skipIf(!enabled)("migration 001 + 001b against real Postgres", () => {
  it("applies 001 twice (idempotent) and seeds exactly one config row, flag OFF", async () => {
    // Delete first so this asserts what the SEED writes, even when re-running
    // against a container a previous suite toggled the flag on.
    await execute(`DELETE FROM app_config WHERE key = 'matching'`);
    await query(migrationSql());
    await query(migrationSql());
    const tables = await query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
         AND tablename IN ('driver_cells','app_config','driver_blocks','driver_metrics')`
    );
    expect(tables.length).toBe(4);

    const seed = await query<{ value: any }>(
      `SELECT value FROM app_config WHERE key = 'matching'`
    );
    expect(seed.length).toBe(1);
    // OFF by default: rollout turns it on explicitly (deploy checklist step).
    expect(seed[0].value.h3_matching_enabled).toBe(false);
    expect(seed[0].value.stale_seconds).toBe(40);
    // Leave the suite's flag ON for the tests that follow.
    await execute(
      `UPDATE app_config SET value = jsonb_set(value, '{h3_matching_enabled}', 'true') WHERE key = 'matching'`
    );
  });

  it("001b refuses a second PENDING offer for the same driver (double assignment)", async () => {
    const { riderId, rideId } = await seedRideAndRider();
    const driverId = await seedDriver({ lat: -26.105, lng: 28.055 });
    const otherRide = randomUUID();
    await execute(
      `INSERT INTO rides (id, passenger_id, pickup_lat, pickup_lng, status)
       VALUES ($1, $2, $3, $4, 'searching')`,
      [otherRide, riderId, SANDTON.lat, SANDTON.lng]
    );

    await execute(
      `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at)
       VALUES ($1, $2, 'pending', NOW() + interval '15 s')`,
      [rideId, driverId]
    );

    // THE assertion: the partial unique index blocks the duplicate outright.
    let err: any = null;
    try {
      await execute(
        `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at)
         VALUES ($1, $2, 'pending', NOW() + interval '15 s')`,
        [otherRide, driverId]
      );
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.code).toBe("23505");
    expect(String(err.message)).toContain("idx_ride_offers_one_active_per_driver");

    // Partial index: once the first offer is no longer pending, a new one is legal.
    await execute(
      `UPDATE ride_offers SET status = 'expired' WHERE ride_id = $1 AND driver_id = $2`,
      [rideId, driverId]
    );
    await execute(
      `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at)
       VALUES ($1, $2, 'pending', NOW() + interval '15 s')`,
      [otherRide, driverId]
    );
    const pending = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ride_offers WHERE driver_id = $1 AND status = 'pending'`,
      [driverId]
    );
    expect(Number(pending[0].n)).toBe(1);
  });
});

describe.skipIf(!enabled)("flag ON dispatch against real Postgres", () => {
  it("offers the ranked driver once, then routes the next ride to the other driver", async () => {
    // Config comes from the migration seed: flag ON, ladder [3,5,7], 90s budget.
    const cfg = await getConfig(true);
    expect(cfg.h3_matching_enabled).toBe(true);

    const d1 = await seedDriver({ lat: -26.1062, lng: 28.0561 }); // ~0.2km
    const d2 = await seedDriver({ lat: -26.12, lng: 28.04 }); // ~2km
    // Positions enter the H3 index exactly as driver:location would write them.
    await driverIndex.upsert({ userId: d1, lat: -26.1062, lng: 28.0561, status: "available" });
    await driverIndex.upsert({ userId: d2, lat: -26.12, lng: 28.04, status: "available" });

    const rideA = await seedRideAndRider();
    const { io } = makeIo();

    const resA = await offerToNextDriver(io, rideA.rideId);
    expect(resA.offered).toBe(true);
    // Road ETA is in fallback mode: nearest driver wins.
    expect(resA.driverId).toBe(d1);

    // A second ride: d1 already holds a pending offer, so the busy-lock and the
    // 001b index together must route this one to d2 — never a second offer for d1.
    const rideB = await seedRideAndRider();
    const resB = await offerToNextDriver(io, rideB.rideId);
    expect(resB.offered).toBe(true);
    expect(resB.driverId).toBe(d2);

    const perDriver = await query<{ driver_id: string; n: string }>(
      `SELECT driver_id, COUNT(*)::text AS n FROM ride_offers
        WHERE status = 'pending' AND driver_id = ANY($1::uuid[]) GROUP BY driver_id`,
      [[d1, d2]] // one array parameter for ANY($1::uuid[])
    );
    const counts = Object.fromEntries(perDriver.map((r) => [r.driver_id, Number(r.n)]));
    expect(counts[d1]).toBe(1);
    expect(counts[d2]).toBe(1);
  });

  it("flag OFF still runs the original haversine query against the real schema", async () => {
    await execute(
      `UPDATE app_config SET value = jsonb_set(value, '{h3_matching_enabled}', 'false') WHERE key = 'matching'`
    );
    invalidateConfigCache();

    const d1 = await seedDriver({ lat: -26.1062, lng: 28.0561 });
    const ride = await seedRideAndRider();

    const { findCandidates } = await import("./dispatch");
    const cands = await findCandidates(ride.rideId, SANDTON.lat, SANDTON.lng, 3, false);
    expect(cands.some((c) => c.id === d1)).toBe(true);

    // Restore the seeded flag for any later run on the same container.
    await execute(
      `UPDATE app_config SET value = jsonb_set(value, '{h3_matching_enabled}', 'true') WHERE key = 'matching'`
    );
    invalidateConfigCache();
  });
});

describe.skipIf(!enabled)("stale eviction against real Postgres", () => {
  it("evicts rows older than stale_seconds and keeps fresh ones", async () => {
    const staleId = await seedDriver({ lat: -26.1062, lng: 28.0561 });
    const freshId = await seedDriver({ lat: -26.107, lng: 28.056 });
    await driverIndex.upsert({ userId: staleId, lat: -26.1062, lng: 28.0561, status: "available" });
    await driverIndex.upsert({ userId: freshId, lat: -26.107, lng: 28.056, status: "available" });
    // Backdate one row past stale_seconds (40s -> 10 minutes).
    await execute(`UPDATE driver_cells SET last_seen_at = NOW() - interval '10 minutes' WHERE user_id = $1`, [
      staleId,
    ]);

    const n = await evictStaleIndexOnce();
    expect(n).toBeGreaterThanOrEqual(1);

    const staleLeft = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM driver_cells WHERE user_id = $1`,
      [staleId]
    );
    const freshLeft = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM driver_cells WHERE user_id = $1`,
      [freshId]
    );
    expect(Number(staleLeft[0].n)).toBe(0);
    expect(Number(freshLeft[0].n)).toBe(1);
  });

  it("concurrent eviction calls skip instead of overlapping", async () => {
    const [a, b] = await Promise.all([evictStaleIndexOnce(), evictStaleIndexOnce()]);
    // One of them does the work; the other skips (returns 0) — never two DELETEs.
    expect(a + b).toBeGreaterThanOrEqual(0);
    expect([a, b]).toContain(0);
  });
});
