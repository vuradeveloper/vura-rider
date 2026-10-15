// ─────────────────────────────────────────────────────────────────────────────
// RC4 PRODUCTION-BUG SUITE — REAL POSTGRES, ALL FEATURES ON.
//
// Why this exists: the mocked suites (and even the Module 1 real-DB suite)
// never ran the SQL that broke in production after rollout-for-everyone:
//   BUG 1  `make_interval(mins => …::double precision)` — `mins` is int, so
//          Set Destination / trip-completed threw 42883 on every call.
//   BUG 2  `SELECT r.*` expands the rides table's REAL `distance_km` column,
//          and the computed `… END AS distance_km` gave the output list TWO
//          columns with that name, so `ORDER BY distance_km` was ambiguous
//          (42702) and /api/rides/available 500'd on every 2s driver poll.
//          The Module 1 CORE_SCHEMA has no rides.distance_km column, which is
//          exactly why the old real-DB suite could not see it.
//
// This file uses the PRODUCTION bootstrap schema (rides.distance_km included),
// turns matching/destination/tier all ON with rollout mode 'all', and runs:
//   1. GET /api/rides/available as a driver — with/without an active
//      destination session and with a tier row (real Express router).
//   2. destination activate / change / clear / trip-completed / sweep.
//   3. findCandidatesH3 end-to-end with the tier tie-break + offer delivery.
//   4. the dispatch loop's own statements (accept/expire/revive/demote).
//   5. the tier recalculation job (manual + nightly gates).
//   6. an SQL INVENTORY: every SQL literal in the Module 1-3 sources is
//      PREPAREd against real Postgres (same parse/analyze/plan path the pg
//      driver uses) — the build fails if ANY statement errors.
//
// GATING (same as the Module 1 suite): every test is skipped unless
// VURA_TEST_DB_PORT is set, e.g.
//   $env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/rc4.integration.test.ts
// Point it at the EMPTY scratch container only — the guard refuses anything
// else. See integrationGuard.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join, basename } from "path";
import { randomUUID } from "crypto";
import type { Server as HttpServer } from "http";
import express from "express";

// Push must never reach the network from vitest.
vi.mock("./notify", async () => ({ sendPushToUsers: vi.fn(async () => 1) }));
// The real rides router pulls in vehicleImages -> lib/s3; attachVehicleImages
// is not used by /available, but the import must not explode without AWS env.
vi.mock("./vehicleImages", async () => ({ attachVehicleImages: vi.fn(async () => undefined) }));
// requireAuth verifies a Firebase ID token; the route test replaces ONLY this
// middleware, so everything past authentication is the production code path.
const authUid = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!authUid.value) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    req.userId = authUid.value;
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import { query, execute, queryOne, withTransaction } from "../config/database";
import { assertScratchDatabase, SCRATCH_DB } from "./integrationGuard";
import { invalidateConfigCache } from "./config";
import { driverIndex, setDriverIndex } from "./driverIndex";
import { makeIo } from "./testHarness";
import { setRoadEtaImpl } from "./eta";
import {
  activateDestination,
  clearDestination,
  getDestinationStatus,
  noteDestinationTripCompleted,
  sweepDestinationSessionsOnce,
} from "./destinationSession";
import {
  acceptRide,
  expireOffers,
  findCandidates,
  markNoDrivers,
  offerToNextDriver,
  reviveWaitingRides,
  sweepStaleDrivers,
} from "./dispatch";
import { recalculatePerformanceTiers, runNightlyIfDue } from "./performanceTier";

const DB_PORT = process.env.VURA_TEST_DB_PORT || "";
const enabled = Boolean(DB_PORT);
const SANDTON = { lat: -26.1076, lng: 28.0567 };

// ── Production-shaped schema ────────────────────────────────────────────────
// The bootstrap DDL from src/index.ts (the shape production actually has) plus
// the columns the Module 1-3 statements read. THE POINT: `distance_km
// NUMERIC(10,2)` on rides is present — the column whose collision with the
// SELECT alias caused the 42702.
const PROD_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(128) UNIQUE,
  full_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(20) DEFAULT 'passenger',
  profile_photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID REFERENCES users(id),
  driver_id UUID,
  pickup_address TEXT,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  destination_address TEXT,
  destination_lat DOUBLE PRECISION,
  destination_lng DOUBLE PRECISION,
  waypoints JSONB,
  status VARCHAR(20) DEFAULT 'searching',
  estimated_fare NUMERIC(10,2),
  actual_fare NUMERIC(10,2),
  platform_fee NUMERIC(10,2),
  distance_km NUMERIC(10,2),
  duration_mins NUMERIC(10,2),
  cancelled_by VARCHAR(50),
  cancel_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  payment_status VARCHAR(20),
  payment_method VARCHAR(20),
  scheduled_at TIMESTAMPTZ,
  tier VARCHAR(20) DEFAULT 'x',
  announced BOOLEAN DEFAULT FALSE,
  no_drivers_at TIMESTAMPTZ,
  offer_round INT DEFAULT 0,
  version INT DEFAULT 0,
  accepted_at TIMESTAMPTZ,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_body_type TEXT,
  license_plate TEXT,
  device_id TEXT,
  route_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  license_number VARCHAR(50),
  vehicle_make VARCHAR(100),
  vehicle_model VARCHAR(100),
  vehicle_year INTEGER,
  vehicle_color VARCHAR(50),
  body_type VARCHAR(50),
  license_plate VARCHAR(20),
  vehicle_category VARCHAR(40),
  is_online BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'offline',
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  current_heading DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  rating_avg NUMERIC(3,2) DEFAULT 0,
  verification_status VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ride_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  decline_reason TEXT,
  round INT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ride_id, driver_id)
);
CREATE TABLE IF NOT EXISTS ride_events (
  id BIGSERIAL PRIMARY KEY,
  ride_id UUID, driver_id UUID, event TEXT, detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id),
  passenger_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ride_id, passenger_id)
);
CREATE TABLE IF NOT EXISTS driver_blocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rider_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (rider_id, driver_id)
);
`;

/**
 * The scratch container PERSISTS between runs, and the Module 1 suite creates
 * an OLDER rides shape (no scheduled_at/distance_km/…). CREATE TABLE IF
 * NOT EXISTS is then a no-op, so the production columns must be added
 * additively — exactly how production got them.
 */
const PROD_ALTERS = `
ALTER TABLE rides ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'x';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS announced BOOLEAN DEFAULT FALSE;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10,2);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS duration_mins NUMERIC(10,2);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS actual_fare NUMERIC(10,2);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10,2);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS vehicle_color TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS vehicle_body_type TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS license_plate TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(10,2);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_category VARCHAR(40);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS body_type VARCHAR(50);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'offline';
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20);
-- 002 changed after the container first applied it (4h-fix3): the session row
-- gained destination_expires_at. The scratch DB keeps the OLD shape, exactly
-- like a production DB that applied 002 before that commit — add it additively.
ALTER TABLE destination_sessions ADD COLUMN IF NOT EXISTS destination_expires_at TIMESTAMPTZ;
ALTER TABLE destination_sessions ADD COLUMN IF NOT EXISTS trips_completed INT NOT NULL DEFAULT 0;
-- Same story for the Module 1 dispatch columns: if another suite (adminV2)
-- created the shared rides table first, these are missing and every offer/
-- expire/revive/no_drivers statement fails. Additive only, no-op when present.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_data JSONB;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS offer_round INT DEFAULT 0;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS version INT DEFAULT 0;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS no_drivers_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS current_heading DOUBLE PRECISION;
`;

function migrationSql(file: string): string {
  return readFileSync(join(process.cwd(), "migrations", file), "utf8");
}

/** RC4 production state: every feature ON for everyone. */
async function enableAllFeatures(): Promise<void> {
  await execute(
    `UPDATE app_config SET value = jsonb_set(jsonb_set(value, '{h3_matching_enabled}', 'true'),
                                              '{h3_rollout_mode}', '"all"')
      WHERE key = 'matching'`
  );
  await execute(
    `UPDATE app_config SET value = jsonb_set(jsonb_set(value, '{destination_matching_enabled}', 'true'),
                                              '{destination_rollout_mode}', '"all"')
      WHERE key = 'destination'`
  );
  await execute(
    `UPDATE app_config SET value = jsonb_set(jsonb_set(value, '{performance_tier_enabled}', 'true'),
                                              '{performance_tier_rollout_mode}', '"all"')
      WHERE key = 'performance_tier'`
  );
  invalidateConfigCache();
}

/** Driver with a fresh available profile at a position (+ H3 index + tier row). */
async function seedDriver(over: {
  lat: number;
  lng: number;
  rating?: number;
  category?: string;
  tier?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO users (id, firebase_uid, role, full_name) VALUES ($1, $2, 'driver', 'IT Driver')`,
    [id, `fb-${id}`]
  );
  await execute(
    `INSERT INTO driver_profiles (user_id, is_online, status, current_lat, current_lng,
                                  last_location_at, last_heartbeat_at, rating_avg,
                                  vehicle_category, updated_at)
     VALUES ($1, TRUE, 'available', $2, $3, NOW(), NOW(), $4, $5, NOW())`,
    [id, over.lat, over.lng, over.rating ?? 4.5, over.category ?? "sedan"]
  );
  if (over.tier) {
    await execute(
      `INSERT INTO driver_tiers (driver_id, tier, window_start, window_end)
       VALUES ($1, $2, (now() AT TIME ZONE 'Africa/Johannesburg')::date,
               (now() AT TIME ZONE 'Africa/Johannesburg')::date)`,
      [id, over.tier]
    );
  }
  await driverIndex.upsert({ userId: id, lat: over.lat, lng: over.lng, status: "available" });
  return id;
}

async function seedRide(over: {
  lat?: number | null;
  lng?: number | null;
  status?: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  scheduledAt?: Date | null;
}): Promise<{ riderId: string; rideId: string }> {
  const riderId = randomUUID();
  const rideId = randomUUID();
  await execute(`INSERT INTO users (id, role, full_name) VALUES ($1, 'passenger', 'IT Rider')`, [
    riderId,
  ]);
  await execute(
    `INSERT INTO rides (id, passenger_id, pickup_address, pickup_lat, pickup_lng,
                        destination_lat, destination_lng, status, scheduled_at)
     VALUES ($1, $2, 'Sandton', $3, $4, $5, $6, $7, $8)`,
    [
      rideId,
      riderId,
      over.lat ?? SANDTON.lat,
      over.lng ?? SANDTON.lng,
      over.destinationLat ?? null,
      over.destinationLng ?? null,
      over.status ?? "searching",
      over.scheduledAt ?? null,
    ]
  );
  return { riderId, rideId };
}

/** Give a seeded driver the firebase_uid the stubbed requireAuth will send. */
async function bindAuthUid(driverId: string): Promise<string> {
  const uid = randomUUID();
  await execute(`UPDATE users SET firebase_uid = $2 WHERE id = $1`, [driverId, uid]);
  return uid;
}

/**
 * Demote every OTHER driver out of candidacy. The scratch DB persists across
 * tests (and test runs), and drivers seeded by earlier tests can still be
 * fresh — without this, "the offer goes to THIS driver" would be a coin flip.
 */
async function demoteOthers(keep: string | string[]): Promise<void> {
  const keepIds = Array.isArray(keep) ? keep : [keep];
  await execute(
    `UPDATE driver_profiles SET status = 'offline', is_online = FALSE, updated_at = NOW()
      WHERE NOT (user_id = ANY($1::uuid[]))`,
    [keepIds]
  );
}

// ── Real HTTP against the REAL /api/rides/available router ──────────────────
let httpServer: HttpServer | null = null;
let baseUrl = "";

async function startRidesServer(): Promise<void> {
  const { default: ridesRouter } = await import("../routes/rides");
  const app = express();
  app.use("/api/rides", ridesRouter);
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer!.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopRidesServer(): Promise<void> {
  if (!httpServer) return;
  await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  httpServer = null;
}

async function getAvailable(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/rides/available`, {
    headers: authUid.value ? { Authorization: `Bearer it-${authUid.value}` } : {},
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}


beforeAll(async () => {
  process.env.DB_HOST = "127.0.0.1";
  process.env.DB_PORT = DB_PORT;
  process.env.DB_NAME = process.env.VURA_TEST_DB_NAME || SCRATCH_DB.name;
  process.env.DB_USER = process.env.VURA_TEST_DB_USER || "vura_admin";
  process.env.DB_PASSWORD = process.env.VURA_TEST_DB_PASSWORD || "vura2thinkdifferent";
  process.env.DB_SSL = "false";

  if (!enabled) return; // suite skipped — touch nothing

  assertScratchDatabase(
    process.env.DB_HOST ?? "",
    process.env.DB_PORT ?? "",
    process.env.DB_NAME ?? ""
  );

  await execute(PROD_SCHEMA);
  await execute(PROD_ALTERS);
  // Real migrations, applied TWICE where the file documents idempotency,
  // exactly like the Module 1 suite.
  await query(migrationSql("001_h3_driver_index.sql"));
  await query(migrationSql("001_h3_driver_index.sql"));
  // 001b: only the index itself — CREATE UNIQUE INDEX CONCURRENTLY refuses a
  // transaction block, so the file (pre-check + index) cannot run whole. Same
  // approach as dispatch.integration.test.ts.
  await query(
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ride_offers_one_active_per_driver
       ON ride_offers (driver_id) WHERE status = 'pending'`
  );
  await query(migrationSql("002_destination_mode.sql"));
  await query(migrationSql("002_destination_mode.sql"));
  await query(migrationSql("003_performance_tier.sql"));
  await query(migrationSql("003_performance_tier.sql"));

  await enableAllFeatures();

  // Road ETA: haversine fallback only — no network from the test run.
  setRoadEtaImpl(null);
  setDriverIndex(driverIndex);
});

beforeEach(() => {
  setDriverIndex(driverIndex);
  authUid.value = null;
  if (enabled) {
    invalidateConfigCache();
    return enableAllFeatures(); // every test starts from "all features ON"
  }
});

afterEach(async () => {
  await stopRidesServer();
});


describe.skipIf(!enabled)("GET /api/rides/available (real router, real SQL, all features ON)", () => {
  it("returns nearest-first rides for a driver WITH an active destination session and a tier row (Bug 2 regression)", async () => {
    const driverId = await seedDriver({ lat: SANDTON.lat, lng: SANDTON.lng, tier: "gold" });
    authUid.value = await bindAuthUid(driverId);

    // A destination session is ACTIVE for this driver — the exact state the
    // driver app polls in. The endpoint must ignore it and still 200.
    await execute(
      `INSERT INTO destination_sessions (driver_id, lat, lng, label)
       VALUES ($1, $2, $3, 'Sandton Central')`,
      [driverId, -26.2, 28.1]
    );

    const near = await seedRide({ lat: -26.11, lng: 28.057 });
    const mid = await seedRide({ lat: -26.13, lng: 28.057 });
    // NOTE: the radius filter applies to scheduled rides too — this one must
    // sit inside DISPATCH_RADIUS_KM (3) of the driver, or it is filtered out.
    const sched = await seedRide({
      lat: -26.125,
      lng: 28.06,
      status: "scheduled",
      scheduledAt: new Date(Date.now() + 3600_000),
    });

    await startRidesServer();
    const { status, body } = await getAvailable();

    // THE BUG 2 ASSERTION: this exact query 500'd with 42702
    // (ORDER BY "distance_km" is ambiguous) because `r.*` expands the real
    // rides.distance_km column AND the SELECT computed `END AS distance_km`.
    expect(status).toBe(200);
    expect(Array.isArray(body.rides)).toBe(true);
    expect(body.scoped).toBe(true);
    expect(body.radius_km).toBeGreaterThan(0);

    const ids = body.rides.map((r: any) => r.id);
    expect(ids).toContain(near.rideId);
    expect(ids).toContain(mid.rideId);
    expect(ids).toContain(sched.rideId);
    // Scheduled first, then nearest-first among live rides.
    expect(ids.indexOf(sched.rideId)).toBeLessThan(ids.indexOf(near.rideId));
    expect(ids.indexOf(near.rideId)).toBeLessThan(ids.indexOf(mid.rideId));
    // The computed pickup distance is published under the historical name the
    // app reads (backend.ts distanceKm <- r.distance_km).
    const nearRow = body.rides.find((r: any) => r.id === near.rideId);
    expect(Number(nearRow.distance_km)).toBeGreaterThan(0);
    expect(Number(nearRow.distance_km)).toBeLessThan(3);
  });

  it("returns 200 WITHOUT an active destination session and without a tier row", async () => {
    const driverId = await seedDriver({ lat: SANDTON.lat, lng: SANDTON.lng });
    authUid.value = await bindAuthUid(driverId);
    const ride = await seedRide({ lat: -26.11, lng: 28.057 });

    await startRidesServer();
    const { status, body } = await getAvailable();

    expect(status).toBe(200);
    expect(body.rides.map((r: any) => r.id)).toContain(ride.rideId);
  });

  it("returns 200 (unfiltered, scoped:false) for a driver with no GPS fix", async () => {
    const id = randomUUID();
    authUid.value = randomUUID();
    await execute(
      `INSERT INTO users (id, firebase_uid, role, full_name) VALUES ($1, $2, 'driver', 'NoFix')`,
      [id, authUid.value]
    );
    // Profile row exists but has never had a position.
    await execute(
      `INSERT INTO driver_profiles (user_id, is_online, status, updated_at)
       VALUES ($1, TRUE, 'available', NOW())`,
      [id]
    );
    const ride = await seedRide({ lat: null, lng: null });

    await startRidesServer();
    const { status, body } = await getAvailable();

    expect(status).toBe(200);
    expect(body.scoped).toBe(false);
    expect(body.radius_km).toBeNull();
    expect(body.rides.map((r: any) => r.id)).toContain(ride.rideId);
  });

  it("answers 401 without an auth token (route still guarded)", async () => {
    await startRidesServer();
    const { status } = await getAvailable();
    expect(status).toBe(401);
  });
});


describe.skipIf(!enabled)("destination lifecycle (activate / change / clear / sweep)", () => {
  it("activates, changes, trip-resets and clears — every statement runs (Bug 1 regression)", async () => {
    const driverId = await seedDriver({ lat: SANDTON.lat, lng: SANDTON.lng });
    const io = makeIo().io;

    // Activate. Pre-fix this threw 42883 (`make_interval(mins => …::double
    // precision)` — mins is int), surfacing as internal/500 to the app.
    const a = await activateDestination(driverId, {
      lat: -26.2,
      lng: 28.1,
      label: "Sandton Central",
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.status.active).toBe(true);
    expect(a.status.label).toBe("Sandton Central");
    // Idle timer armed ~180 min out (destination_max_minutes_without_trip).
    const exp = new Date(a.status.expires_at!).getTime();
    const deltaMin = (exp - Date.now()) / 60000;
    expect(deltaMin).toBeGreaterThan(170);
    expect(deltaMin).toBeLessThan(190);

    // Status reflects the active session.
    const st = await getDestinationStatus(driverId);
    expect(st.active).toBe(true);
    expect(st.banner).toContain("Sandton Central");

    // A COMPLETED trip resets the idle clock on both rows (also make_interval).
    const ride = await seedRide({ lat: SANDTON.lat, lng: SANDTON.lng });
    expect(await noteDestinationTripCompleted(driverId, ride.rideId)).toBe(true);

    // Change to a different destination = new use (old row end_reason 'changed').
    const changed = await activateDestination(driverId, {
      lat: -26.15,
      lng: 28.2,
      label: "Rosebank",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.status.label).toBe("Rosebank");
    const old = await query<{ end_reason: string }>(
      `SELECT end_reason FROM destination_sessions
        WHERE driver_id = $1 AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`,
      [driverId]
    );
    expect(old[0]?.end_reason).toBe("changed");

    // Clear (L7b). Idempotent; profile destination columns wiped.
    const cleared = await clearDestination(driverId);
    expect(cleared.ok).toBe(true);
    expect(cleared.status.active).toBe(false);
    const after = await getDestinationStatus(driverId);
    expect(after.active).toBe(false);
    const prof = await queryOne<{ destination_lat: number | null }>(
      `SELECT destination_lat FROM driver_profiles WHERE user_id = $1`,
      [driverId]
    );
    expect(prof?.destination_lat).toBeNull();

    // The sweep ran without throwing (it reads destination_expires_at).
    expect(await sweepDestinationSessionsOnce(io)).toBeGreaterThanOrEqual(0);
  });

  it("sweep ends an expired session as timeout_3h and wipes the profile", async () => {
    const driverId = await seedDriver({ lat: SANDTON.lat, lng: SANDTON.lng });
    const io = makeIo().io;
    const a = await activateDestination(driverId, { lat: -26.2, lng: 28.1, label: "Timeout me" });
    expect(a.ok).toBe(true);

    // Force the expiry into the past → sweep must classify timeout_3h.
    await execute(
      `UPDATE destination_sessions SET destination_expires_at = NOW() - interval '1 minute'
        WHERE driver_id = $1 AND ended_at IS NULL`,
      [driverId]
    );
    expect(await sweepDestinationSessionsOnce(io)).toBeGreaterThanOrEqual(1);

    const rows = await query<{ end_reason: string }>(
      `SELECT end_reason FROM destination_sessions WHERE driver_id = $1 AND ended_at IS NOT NULL`,
      [driverId]
    );
    expect(rows.map((r) => r.end_reason)).toContain("timeout_3h");
    const st = await getDestinationStatus(driverId);
    expect(st.active).toBe(false);
  });

  it("sweep ends an arrived session (fresh fix inside the arrival radius)", async () => {
    const driverId = await seedDriver({ lat: SANDTON.lat, lng: SANDTON.lng });
    const io = makeIo().io;
    // Must start OUTSIDE the 1km reject radius, then drive the last ~2km.
    const a = await activateDestination(driverId, { lat: -26.13, lng: 28.057, label: "Arrived" });
    expect(a.ok).toBe(true);

    // Fresh position ~50m from the destination.
    await execute(
      `UPDATE driver_profiles SET current_lat = $2, current_lng = $3, last_location_at = NOW()
        WHERE user_id = $1`,
      [driverId, -26.1305, 28.0575]
    );
    expect(await sweepDestinationSessionsOnce(io)).toBeGreaterThanOrEqual(1);
    const rows = await query<{ end_reason: string }>(
      `SELECT end_reason FROM destination_sessions WHERE driver_id = $1 AND ended_at IS NOT NULL`,
      [driverId]
    );
    expect(rows.map((r) => r.end_reason)).toContain("arrived");
  });

  it("sweep ends a session whose driver was removed from the rollout (feature_disabled)", async () => {
    const driverId = await seedDriver({ lat: SANDTON.lat, lng: SANDTON.lng });
    const io = makeIo().io;
    const a = await activateDestination(driverId, { lat: -26.2, lng: 28.1, label: "Paused" });
    expect(a.ok).toBe(true);

    // Ops action mid-session: flip destination OFF (feature_disabled wins FIRST).
    await execute(
      `UPDATE app_config SET value = jsonb_set(value, '{destination_matching_enabled}', 'false')
        WHERE key = 'destination'`
    );
    invalidateConfigCache();

    expect(await sweepDestinationSessionsOnce(io)).toBeGreaterThanOrEqual(1);
    const rows = await query<{ end_reason: string }>(
      `SELECT end_reason FROM destination_sessions WHERE driver_id = $1 AND ended_at IS NOT NULL`,
      [driverId]
    );
    expect(rows.map((r) => r.end_reason)).toContain("feature_disabled");
  });
});


describe.skipIf(!enabled)("findCandidatesH3 end-to-end with tie-breaking (all features ON)", () => {
  it("uses the H3 path, respects radius, and orders the equal-ETA tie by tier", async () => {
    const ride = await seedRide({ lat: SANDTON.lat, lng: SANDTON.lng });
    // EXACT same position for both drivers => bit-identical haversine distance
    // => a strict eta tie (symmetric ±offsets are NOT exact negatives in
    // floating point and would differ by an ulp, silently skipping the tie).
    const bronze = await seedDriver({ lat: -26.1176, lng: 28.0567, rating: 5, tier: "bronze" });
    const gold = await seedDriver({ lat: -26.1176, lng: 28.0567, rating: 5, tier: "gold" });
    // One driver far outside the 3km radius must not appear.
    const far = await seedDriver({ lat: -26.5, lng: 28.5, rating: 5, tier: "platinum" });

    const cands = await findCandidates(ride.rideId, SANDTON.lat, SANDTON.lng, 5, false, 1);
    const ids = cands.map((c) => c.id);

    expect(ids).toContain(bronze);
    expect(ids).toContain(gold);
    expect(ids).not.toContain(far);

    // THE TIE-BREAK: with performance_tier ON and both ETAs equal, gold must
    // be offered before bronze (stable sort keeps pool order for equal tiers).
    expect(ids.indexOf(gold)).toBeLessThan(ids.indexOf(bronze));
  });

  it("leaves the candidate pool untouched when the tier flag is off (fails open)", async () => {
    await execute(
      `UPDATE app_config SET value = jsonb_set(value, '{performance_tier_enabled}', 'false')
        WHERE key = 'performance_tier'`
    );
    invalidateConfigCache();

    const ride = await seedRide({ lat: SANDTON.lat, lng: SANDTON.lng });
    const bronze = await seedDriver({ lat: -26.1176, lng: 28.0567, rating: 5, tier: "bronze" });
    const gold = await seedDriver({ lat: -26.0976, lng: 28.0567, rating: 5, tier: "gold" });

    const cands = await findCandidates(ride.rideId, SANDTON.lat, SANDTON.lng, 5, false, 1);
    const ids = cands.map((c) => c.id);
    expect(ids).toContain(bronze);
    expect(ids).toContain(gold);
    // No crash, no filtering — flag off must not change WHO is offered.
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("filters a destination-mode driver whose destination does not fit the ride", async () => {
    const ride = await seedRide({
      lat: SANDTON.lat,
      lng: SANDTON.lng,
      destinationLat: -26.2,
      destinationLng: 28.1, // ride drops off ~12km south-west of pickup
    });
    // Driver heading the OPPOSITE way (destination ~25km north-east): every
    // destinationFit check rejects. A driver without a destination passes.
    const destd = await seedDriver({ lat: -26.1076, lng: 28.0567, rating: 5 });
    await execute(
      `UPDATE driver_profiles SET destination_lat = $2, destination_lng = $3,
                                  destination_label = 'North East'
        WHERE user_id = $1`,
      [destd, -25.9, 28.5]
    );
    const plain = await seedDriver({ lat: -26.1176, lng: 28.0567, rating: 5 });

    const cands = await findCandidates(ride.rideId, SANDTON.lat, SANDTON.lng, 10, false, 1);
    const ids = cands.map((c) => c.id);
    expect(ids).toContain(plain);
    expect(ids).not.toContain(destd);
  });
});


describe.skipIf(!enabled)("dispatch loop statements (offer / accept / expire / revive / demote)", () => {
  it("delivers a real offer to the ranked candidate and accepts it (offer + accept SQL)", async () => {
    const io = makeIo().io as any;
    const ride = await seedRide({ lat: SANDTON.lat, lng: SANDTON.lng });
    const driverId = await seedDriver({ lat: -26.1176, lng: 28.0567, rating: 5 });
    await demoteOthers(driverId);

    // offerToNextDriver: candidates query + offer INSERT + offer_round UPDATE.
    const offered = await offerToNextDriver(io, ride.rideId, 1);
    expect(offered.offered).toBe(true);
    expect(offered.driverId).toBe(driverId);
    const offerRows = await query<{ status: string }>(
      `SELECT status FROM ride_offers WHERE ride_id = $1 AND driver_id = $2`,
      [ride.rideId, driverId]
    );
    expect(offerRows[0]?.status).toBe("pending");

    // acceptRide: FOR UPDATE transaction + offer accept + ride claim + losers.
    const accepted = await acceptRide(io, { rideId: ride.rideId, driverId });
    expect(accepted.ok).toBe(true);
    const rideRow = await queryOne<{ status: string; driver_id: string }>(
      `SELECT status, driver_id FROM rides WHERE id = $1`,
      [ride.rideId]
    );
    expect(rideRow?.status).toBe("accepted");
    expect(rideRow?.driver_id).toBe(driverId);
    const prof = await queryOne<{ status: string }>(
      `SELECT status FROM driver_profiles WHERE user_id = $1`,
      [driverId]
    );
    expect(prof?.status).toBe("on_trip");
  });

  it("expires a due offer, re-offers to the NEXT driver, never the one who let it lapse", async () => {
    const io = makeIo().io as any;
    // expireOffers scans LIMIT 40 oldest-due pending offers; the persistent
    // scratch DB accumulates them across runs, so clear old ones first or the
    // fixture below is never reached.
    await execute(
      `UPDATE ride_offers SET status = 'expired', decline_reason = 'it_setup'
        WHERE status = 'pending'`
    );
    const ride = await seedRide({ lat: SANDTON.lat, lng: SANDTON.lng });
    const holder = await seedDriver({ lat: -26.1176, lng: 28.0567, rating: 5 });
    const nextUp = await seedDriver({ lat: -26.1076, lng: 28.0667, rating: 5 });
    await demoteOthers([holder, nextUp]);
    await execute(
      `INSERT INTO ride_offers (ride_id, driver_id, status, expires_at)
       VALUES ($1, $2, 'pending', NOW() - interval '1 second')`,
      [ride.rideId, holder]
    );

    // expireOffers: due scan + expired UPDATE + re-offer. A driver who already
    // has an offer row for this ride is NEVER re-asked (ignorePreviousOffers
    // false + NOT EXISTS on ANY status), so the re-offer must land on nextUp.
    expect(await expireOffers(io)).toBeGreaterThanOrEqual(1);
    const held = await queryOne<{ status: string }>(
      `SELECT status FROM ride_offers WHERE ride_id = $1 AND driver_id = $2`,
      [ride.rideId, holder]
    );
    expect(held?.status).toBe("expired");
    const reoffer = await query<{ driver_id: string; status: string }>(
      `SELECT driver_id, status FROM ride_offers WHERE ride_id = $1`,
      [ride.rideId]
    );
    const fresh = reoffer.filter((o) => o.status === "pending");
    expect(fresh.length).toBeGreaterThanOrEqual(1);
    expect(fresh[0]?.driver_id).toBe(nextUp);
    // The ride keeps looking (re-offer succeeded => NOT parked).
    const rideRow = await queryOne<{ status: string }>(
      `SELECT status FROM rides WHERE id = $1`,
      [ride.rideId]
    );
    expect(rideRow?.status).toBe("searching");
  });

  it("revives a waiting ride that was never offered (revive scan + offer SQL)", async () => {
    const io = makeIo().io as any;
    // reviveWaitingRides scans waiting rides newest-first LIMIT 5 — leftover
    // 'searching' rides from earlier tests would crowd our fixture out. Park
    // them all so this fixture is the only waiting ride. The ride must also be
    // >6s old (churn guard) and carry NO offer history (a prior offer row would
    // make the fresh candidates query skip every driver who received one).
    const ride = await seedRide({ lat: SANDTON.lat, lng: SANDTON.lng });
    const driver = await seedDriver({ lat: -26.1176, lng: 28.0567, rating: 5 });
    await demoteOthers([driver]);
    await execute(
      `UPDATE rides SET status = 'expired'
        WHERE status IN ('searching', 'no_drivers') AND id <> $1`,
      [ride.rideId]
    );
    await execute(`UPDATE rides SET created_at = NOW() - interval '30 seconds' WHERE id = $1`, [
      ride.rideId,
    ]);

    const revived = await reviveWaitingRides(io, 5);
    expect(revived).toBeGreaterThanOrEqual(1);
    const pending = await query<{ driver_id: string }>(
      `SELECT driver_id FROM ride_offers WHERE ride_id = $1 AND status = 'pending'`,
      [ride.rideId]
    );
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it("demotes a silent driver and parks a ride with no drivers (sweep + no_drivers SQL)", async () => {
    const io = makeIo().io as any;
    const silent = await seedDriver({ lat: SANDTON.lat, lng: SANDTON.lng });
    // 60s of silence: past DRIVER_STALE_SECONDS (20s) but well inside the
    // 15-min safety timeout — so the STALE sweep (the one that returns the
    // demoted count) does the work, not the safety path.
    await execute(
      `UPDATE driver_profiles SET last_location_at = NOW() - interval '60 seconds',
                                  last_heartbeat_at = NOW() - interval '60 seconds'
        WHERE user_id = $1`,
      [silent]
    );
    expect(await sweepStaleDrivers(io)).toBeGreaterThanOrEqual(1);
    const prof = await queryOne<{ status: string }>(
      `SELECT status FROM driver_profiles WHERE user_id = $1`,
      [silent]
    );
    // The 20s stale demote flips status only; is_online is turned off by the
    // separate 15-min safety sweep (both statements ran above).
    expect(prof?.status).toBe("offline");

    // markNoDrivers: parked UPDATE.
    const ride = await seedRide({ lat: SANDTON.lat, lng: SANDTON.lng });
    await markNoDrivers(io, ride.rideId);
    const parked = await queryOne<{ status: string }>(
      `SELECT status FROM rides WHERE id = $1`,
      [ride.rideId]
    );
    expect(parked?.status).toBe("no_drivers");
  });
});


// ── SQL INVENTORY: every Module 1-3 statement, validated against real PG ─────
// PREPARE runs the SAME parse → analyze → plan path the pg driver uses for
// every query, so it catches exactly the bug classes that hit production:
// missing functions/arg types (42883), ambiguous columns (42702), missing
// tables/columns (42P01/42703) and bad casts — WITHOUT needing fixture rows.
// (PREPARE accepts SELECT/INSERT/UPDATE/DELETE only; the two idempotent ALTERs
// from rides.ts run directly, inside the same transaction.) Any failure here
// fails the build.
const SQL_SOURCES = [
  "src/services/dispatch.ts",
  "src/services/driverIndex.ts",
  "src/services/destinationSession.ts",
  "src/services/performanceTier.ts",
  "src/services/SchedulingService.ts",
  "src/routes/rides.ts",
];

/** Extract every backtick SQL literal from a TS source file. */
function extractSqlLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let sql = m[1]
      // rides.ts interpolates a numeric const into INTERVAL '… minutes'.
      .replace(/\$\{ACTIVE_RIDE_MAX_AGE_MINUTES\}/g, "240")
      .trim();
    if (/^\s*--[^\n]*\n/i.test(sql)) sql = sql.replace(/^\s*--[^\n]*\n/gm, "").trim();
    if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH|ALTER|CREATE)\b/i.test(sql)) continue;
    if (sql.includes("${")) continue; // dynamic SQL — cannot validate statically
    out.push(sql.replace(/,\s*$/, ""));
  }
  return out;
}

describe.skipIf(!enabled)("SQL inventory (every Module 1-3 statement against real Postgres)", () => {
  it("validates every SQL statement from the Module 1-3 sources (fails the build on ANY error)", async () => {
    const all: { src: string; sql: string }[] = [];
    const seen = new Set<string>();
    for (const rel of SQL_SOURCES) {
      const srcText = readFileSync(join(process.cwd(), rel), "utf8");
      for (const sql of extractSqlLiterals(srcText)) {
        const key = sql.replace(/\s+/g, " ");
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ src: basename(rel), sql });
      }
    }

    // Sanity: the extractor must actually find the statements (a refactor that
    // breaks it must fail loudly, not silently shrink coverage).
    expect(all.length).toBeGreaterThanOrEqual(50);
    expect(all.some((s) => s.sql.includes("pickup_distance_km"))).toBe(true); // Bug 2 fix
    expect(all.some((s) => s.sql.includes("interval '1 minute'"))).toBe(true); // Bug 1 fix

    // ONE connection: prepared statements are session-scoped, so PREPARE and
    // DEALLOCATE must share it — withTransaction pins a single client. Each
    // statement runs under its own SAVEPOINT so one failure cannot poison the
    // rest of the transaction (otherwise every later statement reports 25P02).
    const problems: { src: string; sql: string; error: string }[] = [];
    await withTransaction(async (client) => {
      for (let i = 0; i < all.length; i++) {
        const { src, sql } = all[i];
        const name = `vura_inv_${i}`;
        await client.query(`SAVEPOINT inv_${i}`);
        try {
          if (/^(ALTER|CREATE)\b/i.test(sql)) {
            await client.query(sql); // idempotent IF NOT EXISTS — runs for real
          } else {
            await client.query(`PREPARE ${name} AS ${sql}`);
            await client.query(`DEALLOCATE ${name}`);
          }
          await client.query(`RELEASE SAVEPOINT inv_${i}`);
        } catch (err: any) {
          problems.push({ src, sql, error: `${err?.code ?? ""} ${err?.message ?? err}`.trim() });
          await client.query(`ROLLBACK TO SAVEPOINT inv_${i}`);
        }
      }
      // Everything above is validation only — never leave inventory rows behind.
      throw new Error("ROLLBACK_INVENTORY");
    }).catch((err) => {
      if (err?.message !== "ROLLBACK_INVENTORY") throw err;
    });

    if (problems.length > 0) {
      const detail = problems
        .map((p) => `\n--- ${p.src} ---\n${p.error}\n${p.sql.slice(0, 400)}`)
        .join("\n");
      throw new Error(
        `[sql-inventory] ${problems.length}/${all.length} statements FAILED against real Postgres:${detail}`
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[sql-inventory] ${all.length} unique SQL statements validated OK against real Postgres`
    );
  }, 60_000);
});









