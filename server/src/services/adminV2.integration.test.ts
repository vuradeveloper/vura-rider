// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ADMIN V2 (Phase 0) â€” REAL POSTGRES integration suite.
//
// WHY REAL DB (the two production bugs â€” make_interval 42883, ambiguous
// column 42702 â€” were both invisible to mocks):
//   â€¢ migration 004 (admin_users + admin_audit_log) applied TWICE (idempotent),
//   â€¢ every new SQL statement executed for real (insert/upsert/update/select),
//   â€¢ the role â†’ permission matrix enforced per role (each allowed AND denied),
//   â€¢ audit rows written for every action, with old/new values,
//   â€¢ missing-table behaviour: the routes answer 503, never throw.
//
// GATING (same as the other suites): skipped unless VURA_TEST_DB_PORT is set,
// and the guard refuses anything but the scratch container.
//   $env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/adminV2.integration.test.ts
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Server as HttpServer } from "http";
import express from "express";

// The route test replaces ONLY Firebase token verification; everything past
// authentication (role resolution, permission matrix, SQL, audit) is real.
const authUser = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!authUser.email) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    req.userId = "test-uid";
    req.user = { uid: "test-uid", email: authUser.email };
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import { query, execute, queryOne } from "../config/database";
import { assertScratchDatabase, SCRATCH_DB } from "./integrationGuard";
import {
  ROLE_PERMISSIONS,
  roleHasPermission,
  resolveAdminRole,
  writeAudit,
} from "./adminAuth";
import { recordVehicleRequestMiss, vehicleImageCacheKey, autoFillMissingColours } from "./vehicleImages";
import { verifyDocument } from "./docVerification";
import { getObjectFromS3 } from "../lib/s3";
import adminV2Router from "../routes/adminV2";

// S3 is not reachable from the scratch harness — mock it so the seed/upload
// paths (processVehicleImage → sharp runs FOR REAL, only the bucket is faked)
// can be exercised end-to-end without AWS.
vi.mock("../lib/s3", () => ({
  DOCUMENT_TYPES: ["id_document", "drivers_license", "prdp", "criminal_record", "carscan_report"],
  isDocumentType: () => true,
  getObjectFromS3: vi.fn(async () => Buffer.from("fake")),
  documentKey: vi.fn(() => "fake-key"),
  uploadToS3: vi.fn(async () => ({ Location: "https://fake.s3.local/fake-key" })),
  getPresignedViewUrl: vi.fn(async () => "https://fake.s3.local/signed"),
  deleteFromS3: vi.fn(async () => undefined),
  s3: { send: vi.fn(async () => ({})) },
}));

// Point the pool at the scratch container FIRST (the pool reads env lazily on
// first query), then assert it â€” same contract as rc4.integration.test.ts.
const enabled = !!process.env.VURA_TEST_DB_PORT;
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.VURA_TEST_DB_PORT || "";
process.env.DB_NAME = process.env.VURA_TEST_DB_NAME || SCRATCH_DB.name;
process.env.DB_USER = process.env.VURA_TEST_DB_USER || "vura_admin";
process.env.DB_PASSWORD = process.env.VURA_TEST_DB_PASSWORD || "vura2thinkdifferent";
process.env.DB_SSL = "false";
// The recolour ENGINE in tests is sharp-only: spawning the bundled python
// script (which may download ML models on first run) would blow the 5s test
// timeout. Production leaves RECOLOUR_PYTHON unset → python preferred.
process.env.RECOLOUR_PYTHON = "off";
if (enabled) {
  assertScratchDatabase(process.env.DB_HOST, process.env.DB_PORT, process.env.DB_NAME);
}

/**
 * Minimal base schema â€” the scratch container is shared, so the base tables
 * must exist before migrations 004/005 (which ALTER users/driver_profiles/
 * driver_documents and FK driver_tiers â†’ users). Same shapes as the rc4
 * PROD_SCHEMA, only the columns this suite reads.
 */
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(128) UNIQUE,
  full_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(20) DEFAULT 'passenger',
  profile_photo_url TEXT,
  id_number VARCHAR(50),
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
  vehicle_tier VARCHAR(20),
  is_online BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'offline',
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  rating_avg NUMERIC(3,2) DEFAULT 0,
  cancellations_count INT DEFAULT 0,
  verification_status VARCHAR(20),
  last_location_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Self-heal: live snapshot selects lifecycle_status.
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(30);
CREATE TABLE IF NOT EXISTS driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id),
  doc_type VARCHAR(60) NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(120),
  s3_key TEXT,
  s3_bucket TEXT,
  size_bytes BIGINT,
  status VARCHAR(30) DEFAULT 'pending_review',
  note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS driver_tiers (
  driver_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'bronze',
  points INT NOT NULL DEFAULT 0,
  at_risk BOOLEAN NOT NULL DEFAULT FALSE,
  demote_after DATE,
  window_start DATE NOT NULL DEFAULT CURRENT_DATE,
  window_end DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Self-heal to the full 003 shape (routes select rating_avg, accept_percent…).
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(4,2) NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS accept_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS cancel_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS rides_completed INT NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS offers_received INT NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS offers_accepted INT NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS offers_timedout INT NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS driver_cancels INT NOT NULL DEFAULT 0;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS demote_pending_tier TEXT;
ALTER TABLE driver_tiers ADD COLUMN IF NOT EXISTS last_eval_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Phase 2: rides (rider stats) + app_config (rider_gate flag seed).
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID REFERENCES users(id),
  driver_id UUID,
  status VARCHAR(20) DEFAULT 'searching',
  pickup_address TEXT,
  destination_address TEXT,
  distance_km NUMERIC(8,2),
  actual_fare NUMERIC(10,2),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Self-heal: containers created with an OLDER stand-in shape get the columns
-- seedTrip and the trip routes rely on (IF NOT EXISTS → idempotent).
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_address TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_address TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS distance_km NUMERIC(8,2);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS duration_mins INT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS estimated_fare NUMERIC(10,2);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Phase 3: dispatch timeline for trip detail.
CREATE TABLE IF NOT EXISTS ride_events (
  id BIGSERIAL PRIMARY KEY,
  ride_id UUID,
  driver_id UUID,
  event VARCHAR(60) NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Phase 6: money tables (created lazily in prod by payments/payouts/index).
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  ride_id UUID REFERENCES rides(id),
  reference VARCHAR(100),
  amount NUMERIC(10,2),
  currency VARCHAR(3) DEFAULT 'ZAR',
  status VARCHAR(20),
  provider VARCHAR(20),
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id),
  bank_code VARCHAR(20),
  account_number VARCHAR(30),
  bank_name VARCHAR(100),
  recipient_code VARCHAR(100),
  amount NUMERIC(10,2),
  reference VARCHAR(100),
  transfer_code VARCHAR(100),
  status VARCHAR(20),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS driver_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id),
  ride_id UUID,
  gross_amount NUMERIC(10,2) DEFAULT 0,
  fee NUMERIC(10,2) DEFAULT 0,
  request_fee NUMERIC(10,2) DEFAULT 0,
  net_amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS driver_earnings_paid (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id UUID NOT NULL REFERENCES driver_earnings(id),
  payout_id UUID REFERENCES payouts(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(earning_id)
);
-- Phase 7: vehicle image cache (mirrors ensureVehicleImageTables DDL).
CREATE TABLE IF NOT EXISTS vehicle_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key VARCHAR(160) NOT NULL UNIQUE,
  make VARCHAR(60),
  model VARCHAR(80),
  year INTEGER,
  colour VARCHAR(40),
  image_url TEXT,
  storage_key TEXT,
  source_url TEXT,
  context_link TEXT,
  licence_note TEXT,
  width INTEGER,
  height INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  api_calls_used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  year_range VARCHAR(24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS carsxe_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key VARCHAR(160),
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result_count INTEGER,
  http_status INTEGER,
  note TEXT
);
-- The scratch container PERSISTS: earlier suites created users/driver_profiles
-- with OLDER shapes, so CREATE TABLE IF NOT EXISTS is a no-op and the columns
-- this suite reads must be added additively (same pattern as the rc4 suite).
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number VARCHAR(50);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_tier VARCHAR(20);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS license_number VARCHAR(50);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_category VARCHAR(40);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS body_type VARCHAR(50);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3,2) DEFAULT 0;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS cancellations_count INT DEFAULT 0;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
`;

// â”€â”€ HTTP harness (same pattern as rc4.integration.test.ts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let server: HttpServer;
let base: string;

async function request(
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* csv etc. */
  }
  return { status: res.status, json };
}

/** Seed an admin_users row directly (as if invited earlier). */
async function seedAdmin(email: string, role: string, disabled = false): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_users (email, role, disabled) VALUES ($1, $2, $3) RETURNING id`,
    [email.toLowerCase(), role, disabled]
  );
  return row!.id;
}

describe.skipIf(!enabled)("ADMIN V2 against real Postgres", () => {
  beforeAll(async () => {
    // Base schema first (shared scratch container), then the migrations the way
    // migrate-on-boot does: files in order, TWICE (idempotence proof). 003 must
    // be here too — on a FRESH scratch container (recreated docker) the tier
    // tables (performance_tier_thresholds, driver_tier_history) come only from
    // it, and the tier/trips/snapshot suites 503 without them.
    await execute(BASE_SCHEMA);
    for (const file of [
      "003_performance_tier.sql",
      "004_admin_v2.sql",
      "005_admin_drivers.sql",
      "006_admin_riders.sql",
      "007_admin_trips.sql",
      "008_admin_messaging.sql",
      "009_admin_vehicle_requests.sql",
      "010_doc_verification.sql",
    ]) {
      const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
      const statements = sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((s) =>
          s
            .split("\n")
            .filter((l) => !l.trim().startsWith("--"))
            .join("\n")
            .trim()
        )
        .filter((s) => s.length > 0);
      for (const stmt of statements) await execute(stmt);
      for (const stmt of statements) await execute(stmt);
    }

    const app = express();
    app.use(express.json());
    app.use("/api/admin/v2", adminV2Router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    // Clean slate between tests (the scratch container persists).
    await execute(`DELETE FROM admin_audit_log`);
    await execute(`DELETE FROM admin_users`);
    await execute(`DELETE FROM rider_notes`);
    await execute(`DELETE FROM rider_status_history`);
    await execute(`DELETE FROM rider_moderation`);
    // Money tables FK → users/rides: delete them BEFORE users/rides below.
    await execute(`DELETE FROM admin_vehicle_requests`);
    await execute(`DELETE FROM vehicle_images`);
    await execute(`DELETE FROM carsxe_usage_log`);
    // Documents FK → users (Phase 8 seeds per-driver docs; no cascade).
    await execute(`DELETE FROM driver_documents`);
    await execute(`DELETE FROM driver_earnings_paid`);
    await execute(`DELETE FROM driver_earnings`);
    await execute(`DELETE FROM payments`);
    await execute(`DELETE FROM payouts`);
    await execute(
      `DELETE FROM rides WHERE passenger_id IN (SELECT id FROM users WHERE email LIKE '%@phase2.test')`
    );
    await execute(`DELETE FROM users WHERE email LIKE '%@phase2.test'`);
    await execute(`DELETE FROM support_ticket_messages`);
    await execute(`DELETE FROM support_tickets`);
    await execute(`DELETE FROM ride_events`);
    await execute(`DELETE FROM admin_campaigns`);
    // schema_migrations may not exist in the scratch container (it is created
    // by migrateOnBoot, which this suite does not run) — best-effort cleanup.
    await execute(`DELETE FROM schema_migrations`).catch(() => undefined);
    authUser.email = null;
  });

  it("migration 004 is additive + idempotent (ran twice in beforeAll)", async () => {
    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('admin_users', 'admin_audit_log')`
    );
    expect(tables.map((t) => t.table_name).sort()).toEqual(["admin_audit_log", "admin_users"]);
  });

  it("role matrix: finance is read-only; every permission is a dotted string", () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of perms) expect(typeof p, `${role} â†’ ${p}`).toBe("string");
      if (role === "finance") {
        expect(perms.some((p) => p.endsWith(".write") || p === "admins.manage")).toBe(false);
      }
    }
  });

  it("/me resolves the ADMIN_EMAILS fallback to super_admin with the full matrix", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const res = await request("GET", "/api/admin/v2/me");
      expect(res.status).toBe(200);
      expect(res.json.role).toBe("super_admin");
      expect(res.json.permissions).toEqual(ROLE_PERMISSIONS.super_admin);
      expect(res.json.email).toBe("boss@vura.test");
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("/me 403s a non-admin email and 401s no token", async () => {
    authUser.email = "nobody@vura.test";
    expect((await request("GET", "/api/admin/v2/me")).status).toBe(403);
    authUser.email = null;
    expect((await request("GET", "/api/admin/v2/me")).status).toBe(401);
  });

  it("permission gates: each role allowed AND denied on the right routes", async () => {
    process.env.ADMIN_EMAILS = "";
    try {
      await seedAdmin("support@vura.test", "support_agent");
      authUser.email = "support@vura.test";
      expect((await request("GET", "/api/admin/v2/audit")).status).toBe(403);
      expect((await request("GET", "/api/admin/v2/admins")).status).toBe(403);

      await seedAdmin("review@vura.test", "onboarding_reviewer");
      authUser.email = "review@vura.test";
      expect((await request("GET", "/api/admin/v2/audit")).status).toBe(200);
      expect((await request("GET", "/api/admin/v2/admins")).status).toBe(403);

      await seedAdmin("root@vura.test", "super_admin");
      authUser.email = "root@vura.test";
      expect((await request("GET", "/api/admin/v2/admins")).status).toBe(200);
      expect((await request("GET", "/api/admin/v2/audit")).status).toBe(200);

      // DISABLED admin resolves to nothing.
      await seedAdmin("gone@vura.test", "super_admin", true);
      authUser.email = "gone@vura.test";
      expect((await request("GET", "/api/admin/v2/admins")).status).toBe(403);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("invite + role change + disable, each writing an audit row with old/new", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const inv = await request("POST", "/api/admin/v2/admins", {
        email: "Ops@Vura.test",
        role: "operations",
      });
      expect(inv.status).toBe(201);
      expect(inv.json.admin.email).toBe("ops@vura.test"); // normalized
      expect(inv.json.admin.role).toBe("operations");
      expect(inv.json.admin.invited_by).toBe("boss@vura.test");

      const inviteAudit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'admin.invite'`
      );
      expect(inviteAudit).toBeTruthy();
      expect(inviteAudit.actor_email).toBe("boss@vura.test");
      expect(inviteAudit.entity_type).toBe("admin_user");
      expect(inviteAudit.new_value).toMatchObject({ role: "operations", disabled: false });
      expect(inviteAudit.old_value).toBeNull();

      const chg = await request("PATCH", `/api/admin/v2/admins/${inv.json.admin.id}`, {
        role: "support_agent",
      });
      expect(chg.status).toBe(200);
      expect(chg.json.admin.role).toBe("support_agent");
      const chgAudit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'admin.role_change' ORDER BY id DESC LIMIT 1`
      );
      expect(chgAudit.old_value).toMatchObject({ role: "operations", disabled: false });
      expect(chgAudit.new_value).toMatchObject({ role: "support_agent" });

      // Disable â†’ the row no longer resolves.
      await request("PATCH", `/api/admin/v2/admins/${inv.json.admin.id}`, { disabled: true });
      authUser.email = "ops@vura.test";
      expect((await request("GET", "/api/admin/v2/me")).status).toBe(403);

      // Validation: bad email, bad role.
      authUser.email = "boss@vura.test";
      expect((await request("POST", "/api/admin/v2/admins", { email: "nope", role: "operations" })).status).toBe(400);
      expect((await request("POST", "/api/admin/v2/admins", { email: "x@y.co", role: "wizard" })).status).toBe(400);
      expect((await request("PATCH", `/api/admin/v2/admins/${inv.json.admin.id}`, { role: "finance" })).status).toBe(200);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("audit log: filters, newest first, CSV export writes an audit.export row", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      await writeAudit({ email: "boss@vura.test", role: "super_admin" }, {
        action: "driver.suspend",
        entityType: "driver",
        entityId: "11111111-1111-1111-1111-111111111111",
        oldValue: { status: "active" },
        newValue: { status: "suspended" },
        reason: "test suspension",
      });
      await writeAudit({ email: "other@vura.test", role: "operations" }, {
        action: "rider.suspend",
        entityType: "rider",
        entityId: "22222222-2222-2222-2222-222222222222",
      });

      const all = await request("GET", "/api/admin/v2/audit");
      expect(all.status).toBe(200);
      expect(all.json.total).toBe(2);
      expect(all.json.entries[0].action).toBe("rider.suspend"); // newest first

      const filtered = await request("GET", "/api/admin/v2/audit?action=driver.&actor=boss@vura.test");
      expect(filtered.json.total).toBe(1);
      expect(filtered.json.entries[0].reason).toBe("test suspension");
      expect(filtered.json.entries[0].old_value).toMatchObject({ status: "active" });

      const csvRes = await fetch(`${base}/api/admin/v2/audit?format=csv`);
      expect(csvRes.status).toBe(200);
      const csv = await csvRes.text();
      expect(csv.split("\n")[0]).toContain("actor_email");
      expect(csv).toContain("driver.suspend");
      const exportAudit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'audit.export'`
      );
      expect(exportAudit).toBeTruthy();
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("resolveAdminRole: disabled row loses, env fallback wins over a disabled row", async () => {
    process.env.ADMIN_EMAILS = "always@vura.test";
    try {
      await seedAdmin("always@vura.test", "support_agent", true); // disabled row
      // Env fallback wins â€” the table cannot lock out operators.
      expect(await resolveAdminRole("always@vura.test")).toBe("super_admin");
      await seedAdmin("half@vura.test", "operations", true);
      expect(await resolveAdminRole("half@vura.test")).toBeNull();
      await seedAdmin("ok@vura.test", "finance");
      expect(await resolveAdminRole("ok@vura.test")).toBe("finance");
      expect(await resolveAdminRole(null)).toBeNull();
      expect(await resolveAdminRole("")).toBeNull();
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("roleHasPermission agrees with the matrix for every role/permission pair", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      for (const perm of ["drivers.read", "money.read", "admins.manage", "audit.read"] as const) {
        expect(roleHasPermission(role, perm)).toBe(ROLE_PERMISSIONS[role].includes(perm));
      }
    }
  });

  // â”€â”€ Phase 1: drivers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function seedDriver(lifecycle = "ACTIVE"): Promise<string> {
    const u = await queryOne<{ id: string }>(
      `INSERT INTO users (firebase_uid, full_name, email, phone, role)
       VALUES ($1, $2, $3, $4, 'driver') RETURNING id`,
      [`fd-${Math.random().toString(36).slice(2)}`, "Test Driver", `drv-${Math.random().toString(36).slice(2)}@vura.test`, "0821234567"]
    );
    await execute(
      `INSERT INTO driver_profiles (user_id, lifecycle_status, status, is_online)
       VALUES ($1, $2, 'offline', FALSE)`,
      [u!.id, lifecycle]
    );
    return u!.id;
  }

  it("driver list masks phones (POPIA) and the profile reveals with audit", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedDriver();
      const list = await request("GET", "/api/admin/v2/drivers");
      expect(list.status).toBe(200);
      const found = list.json.drivers.find((d: any) => d.driver_id === id);
      expect(found).toBeTruthy();
      expect(found.phone).toBe("082***4567"); // masked in the LIST

      const prof = await request("GET", `/api/admin/v2/drivers/${id}`);
      expect(prof.status).toBe(200);
      expect(prof.json.driver.phone).toBe("0821234567"); // revealed
      const reveal = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'driver.reveal' ORDER BY id DESC LIMIT 1`
      );
      expect(reveal?.entity_id).toBe(id);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("lifecycle: legal transitions pass, illegal ones 409, reasons enforced", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedDriver("UNDER_REVIEW");

      const ok1 = await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, {
        to: "CHANGES_REQUESTED",
        reason: "Licence scan is blurry",
      });
      expect(ok1.status).toBe(200);
      expect(ok1.json).toEqual({ from: "UNDER_REVIEW", to: "CHANGES_REQUESTED" });

      // To APPROVED needs all required docs â€” seed them first
      await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "DOCUMENTS_SUBMITTED" });
      await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "UNDER_REVIEW" });
      const required = await query<{ doc_type: string }>(
        `SELECT doc_type FROM admin_required_docs WHERE active = TRUE`
      );
      for (const r of required) {
        await execute(
          `INSERT INTO driver_documents (driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, status)
           VALUES ($1, $2, 'f.pdf', 'application/pdf', 'k', 'b', 'approved')`,
          [id, r.doc_type]
        );
      }
      expect((await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "APPROVED" })).status).toBe(200);
      expect((await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "ACTIVE" })).status).toBe(200);

      // Illegal: ACTIVE â†’ DOCUMENTS_SUBMITTED
      const bad = await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "DOCUMENTS_SUBMITTED" });
      expect(bad.status).toBe(409);
      expect(bad.json.allowed).toContain("SUSPENDED");

      // SUSPENDED requires a reason
      expect((await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "SUSPENDED" })).status).toBe(400);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("suspend takes the driver offline, records history/audit, reinstate works, BLOCKED is terminal", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedDriver("ACTIVE");
      await execute(`UPDATE driver_profiles SET is_online = TRUE, status = 'available' WHERE user_id = $1`, [id]);
      const susp = await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, {
        to: "SUSPENDED",
        reason: "Rider complaints pending investigation",
        ends_at: "2026-11-01T00:00:00Z",
      });
      expect(susp.status).toBe(200);
      const prof = await queryOne<any>(
        `SELECT is_online, status, suspended_until FROM driver_profiles WHERE user_id = $1`,
        [id]
      );
      expect(prof.is_online).toBe(false);
      expect(prof.suspended_until).toBeTruthy();

      const hist = await query(
        `SELECT from_status, to_status FROM driver_status_history WHERE driver_id = $1`,
        [id]
      );
      expect(hist.length).toBe(1);
      expect(hist[0]).toMatchObject({ from_status: "ACTIVE", to_status: "SUSPENDED" });
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'driver.lifecycle.suspended' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.reason).toContain("Rider complaints");

      expect((await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "ACTIVE" })).status).toBe(200);
      await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "BLOCKED", reason: "Fraud confirmed" });
      expect((await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "ACTIVE" })).status).toBe(409);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("APPROVED is refused until every required document is approved", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedDriver("UNDER_REVIEW");
      const res = await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, { to: "APPROVED" });
      expect(res.status).toBe(409);
      expect(res.json.missing.length).toBeGreaterThan(0);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("onboarding queue oldest-first with waiting seconds; expiring docs list", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedDriver("UNDER_REVIEW");
      await execute(
        `INSERT INTO driver_documents (driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, status, created_at)
         VALUES ($1, 'id_document', 'id.pdf', 'application/pdf', 'k', 'b', 'pending_review', NOW() - interval '2 hours')`,
        [id]
      );
      const q = await request("GET", "/api/admin/v2/onboarding");
      expect(q.status).toBe(200);
      const row = q.json.queue.find((x: any) => x.driver_id === id);
      expect(row).toBeTruthy();
      expect(row.pending_docs).toBe(1);
      expect(row.waiting_seconds).toBeGreaterThanOrEqual(7000); // ~2h
      // Outside-status ingredients for the drivers list badge.
      expect(row.required_total).toBeGreaterThan(0);
      expect(row.required_approved).toBe(0); // only a pending doc so far
      await execute(
        `INSERT INTO driver_documents (driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, status)
         VALUES ($1, 'drivers_license', 'lic.pdf', 'application/pdf', 'k2', 'b', 'approved')`,
        [id]
      );
      const q2 = await request("GET", "/api/admin/v2/onboarding");
      const row2 = q2.json.queue.find((x: any) => x.driver_id === id);
      expect(row2.required_approved).toBe(1); // approved + required + unexpired
      expect(q.json.required.length).toBeGreaterThan(0);
      expect(q.json.rejectReasons.length).toBeGreaterThan(0);

      await execute(
        `UPDATE driver_documents SET expires_at = NOW() + interval '10 days' WHERE driver_id = $1`,
        [id]
      );
      const exp = await request("GET", "/api/admin/v2/documents/expiring?days=30");
      expect(exp.status).toBe(200);
      const mine = exp.json.documents.find((d: any) => d.driver_id === id);
      expect(mine).toBeTruthy();
      expect(mine.phone).toBe("082***4567"); // POPIA masked
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("support_agent is denied drivers.write; operations is allowed", async () => {
    process.env.ADMIN_EMAILS = "";
    try {
      const id = await seedDriver("ACTIVE");
      await seedAdmin("support@vura.test", "support_agent");
      authUser.email = "support@vura.test";
      const denied = await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, {
        to: "SUSPENDED",
        reason: "not allowed to do this",
      });
      expect(denied.status).toBe(403);

      await seedAdmin("ops@vura.test", "operations");
      authUser.email = "ops@vura.test";
      const allowed = await request("POST", `/api/admin/v2/drivers/${id}/lifecycle`, {
        to: "SUSPENDED",
        reason: "policy violation",
      });
      expect(allowed.status).toBe(200);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("vehicles list joins driver + vehicle tier + doc expiry", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedDriver();
      await execute(
        `UPDATE driver_profiles SET license_plate = 'GP 123-456', vehicle_make = 'Toyota',
                vehicle_tier = 'go' WHERE user_id = $1`,
        [id]
      );
      const res = await request("GET", "/api/admin/v2/vehicles");
      expect(res.status).toBe(200);
      const row = res.json.vehicles.find((v: any) => v.driver_id === id);
      expect(row).toBeTruthy();
      expect(row.license_plate).toBe("GP 123-456");
      expect(row.vehicle_tier).toBe("go"); // vehicle_tier, NOT performance tier
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("tier view reads metrics+thresholds; super-admin override requires reason and audits", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedDriver();

      const view = await request("GET", `/api/admin/v2/drivers/${id}/tier`);
      expect(view.status).toBe(200);
      expect(view.json.tier).toBeNull(); // no row yet
      expect(view.json.thresholds.length).toBe(4); // bronze..platinum
      expect(view.json.thresholds[0].display_name).toBe("Bronze");

      // Bad tier, missing reason
      expect((await request("POST", `/api/admin/v2/drivers/${id}/tier`, { tier: "diamond" })).status).toBe(400);
      expect((await request("POST", `/api/admin/v2/drivers/${id}/tier`, { tier: "gold" })).status).toBe(400);

      // Valid override
      const ok = await request("POST", `/api/admin/v2/drivers/${id}/tier`, {
        tier: "gold",
        reason: "Manual correction after promotion batch failure",
      });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({ tier: "gold", previous: null });

      // History + audit rows
      const hist = await query(
        `SELECT old_tier, new_tier, reason FROM driver_tier_history WHERE driver_id = $1`,
        [id]
      );
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ old_tier: "bronze", new_tier: "gold" });
      expect(String(hist[0].reason)).toContain("admin_override");
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'driver.tier_override' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.reason).toContain("Manual correction");
      expect(audit?.old_value).toMatchObject({ tier: null });
      expect(audit?.new_value).toMatchObject({ tier: "gold" });

      // operations (non-super) is denied the override even with admins.manage absent
      await seedAdmin("ops2@vura.test", "operations");
      authUser.email = "ops2@vura.test";
      expect((await request("POST", `/api/admin/v2/drivers/${id}/tier`, { tier: "bronze", reason: "x org" })).status).toBe(403);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  // â”€â”€ Phase 2: riders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function seedRider(): Promise<string> {
    const u = await queryOne<{ id: string }>(
      `INSERT INTO users (firebase_uid, full_name, email, phone, role)
       VALUES ($1, $2, $3, $4, 'passenger') RETURNING id`,
      [
        `fr-${Math.random().toString(36).slice(2)}`,
        "Test Rider",
        `rdr-${Math.random().toString(36).slice(2)}@phase2.test`,
        "082 111 2233",
      ]
    );
    return u!.id;
  }

  it("rider list masks phones (POPIA); detail reveals raw with a rider.reveal audit row", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedRider();

      const list = await request("GET", "/api/admin/v2/riders");
      expect(list.status).toBe(200);
      expect(list.json.total).toBeGreaterThanOrEqual(1);
      const row = list.json.riders.find((r: any) => r.id === id);
      expect(row.phone).toBe("082***2233");
      expect(row.moderation_status).toBe("active");

      const detail = await request("GET", `/api/admin/v2/riders/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.json.rider.phone).toBe("082 111 2233"); // raw for support
      expect(detail.json.rider.stats).toBeTruthy();
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'rider.reveal' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.entity_id).toBe(id);
      expect((await request("GET", "/api/admin/v2/riders/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("moderation: reason required, illegal transitions 409, history+audit rows, unban works", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedRider();

      const noReason = await request("POST", `/api/admin/v2/riders/${id}/moderation`, {
        status: "suspended",
      });
      expect(noReason.status).toBe(400); // reason required to suspend

      const badStatus = await request("POST", `/api/admin/v2/riders/${id}/moderation`, {
        status: "shadowbanned",
      });
      expect(badStatus.status).toBe(400); // unknown status

      const sus = await request("POST", `/api/admin/v2/riders/${id}/moderation`, {
        status: "suspended",
        reason: "Chargeback abuse reported by finance",
      });
      expect(sus.status).toBe(200);
      expect(sus.json).toMatchObject({ from: "active", to: "suspended" });
      const hist = await query(`SELECT * FROM rider_status_history WHERE rider_id = $1`, [id]);
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ from_status: "active", to_status: "suspended" });
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'rider.moderation' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.old_value).toMatchObject({ status: "active" });
      expect(audit?.new_value).toMatchObject({ status: "suspended" });
      expect(audit?.reason).toContain("Chargeback");

      const ban = await request("POST", `/api/admin/v2/riders/${id}/moderation`, {
        status: "banned",
        reason: "Repeated safety violations",
      });
      expect(ban.status).toBe(200);
      expect(ban.json).toMatchObject({ from: "suspended", to: "banned" });

      // banned â†’ suspended is illegal (only unban is allowed from banned)
      const illegal = await request("POST", `/api/admin/v2/riders/${id}/moderation`, {
        status: "suspended",
        reason: "cannot suspend a banned rider",
      });
      expect(illegal.status).toBe(409);

      const unban = await request("POST", `/api/admin/v2/riders/${id}/moderation`, {
        status: "active",
      });
      expect(unban.status).toBe(200);
      expect(unban.json).toMatchObject({ from: "banned", to: "active" });

      expect(
        (await request("POST", "/api/admin/v2/riders/00000000-0000-0000-0000-000000000000/moderation", {
          status: "suspended",
          reason: "x",
        })).status
      ).toBe(404);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("rider notes: written + audited; support_agent reads but cannot write, finance denied entirely", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedRider();

      expect(
        (await request("POST", `/api/admin/v2/riders/${id}/notes`, { note: "no" })).status
      ).toBe(400); // too short
      const ok = await request("POST", `/api/admin/v2/riders/${id}/notes`, {
        note: "Called rider about repeated no-shows; warned next is suspension.",
      });
      expect(ok.status).toBe(201);
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'rider.note_add' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.entity_id).toBe(id);
      const detail = await request("GET", `/api/admin/v2/riders/${id}`);
      expect(detail.json.rider.notes).toHaveLength(1);

      // support_agent: riders.read yes, riders.write no
      await seedAdmin("sup@vura.test", "support_agent");
      authUser.email = "sup@vura.test";
      expect((await request("GET", "/api/admin/v2/riders")).status).toBe(200);
      expect(
        (await request("POST", `/api/admin/v2/riders/${id}/moderation`, {
          status: "suspended",
          reason: "not allowed",
        })).status
      ).toBe(403);
      expect(
        (await request("POST", `/api/admin/v2/riders/${id}/notes`, { note: "not allowed" })).status
      ).toBe(403);

      // finance: no riders.* at all
      await seedAdmin("fin@vura.test", "finance");
      authUser.email = "fin@vura.test";
      expect((await request("GET", "/api/admin/v2/riders")).status).toBe(403);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("rider_gate: seeded OFF (book allowed); armed â†’ suspended/banned blocked, until honoured", async () => {
    const { assertRiderCanBook, riderGateEnabled } = await import("./adminRiders");
    const id = await seedRider();

    // Flag row exists and is OFF after migration 006 (idempotent seed).
    const row = await queryOne<{ value: any }>(
      `SELECT value FROM app_config WHERE key = 'rider_gate'`
    );
    expect(row?.value?.enabled).toBe(false);
    await riderGateEnabled(true); // refresh cache from DB
    await expect(assertRiderCanBook(id)).resolves.toBeUndefined();

    // Arm the gate, suspend the rider â†’ booking blocked.
    await execute(`UPDATE app_config SET value = '{"enabled": true}'::jsonb WHERE key = 'rider_gate'`);
    await riderGateEnabled(true);
    await execute(
      `INSERT INTO rider_moderation (rider_id, status, reason, actor_email)
       VALUES ($1, 'suspended', 'test suspension', 'boss@vura.test')`,
      [id]
    );
    await expect(assertRiderCanBook(id)).rejects.toThrow(/suspended/i);

    // Suspension with a FUTURE `until` is still serving â†’ blocked.
    await execute(
      `UPDATE rider_moderation SET until = NOW() + INTERVAL '2 days' WHERE rider_id = $1`,
      [id]
    );
    await expect(assertRiderCanBook(id)).rejects.toThrow(/suspended/i);

    // An EXPIRED `until` releases the rider (state latches until reset).
    await execute(
      `UPDATE rider_moderation SET until = NOW() - INTERVAL '1 day' WHERE rider_id = $1`,
      [id]
    );
    await expect(assertRiderCanBook(id)).resolves.toBeUndefined();

    // Banned is absolute (until is only informational) â†’ still blocked.
    await execute(
      `UPDATE rider_moderation SET status = 'banned', until = NOW() + INTERVAL '9 days' WHERE rider_id = $1`,
      [id]
    );
    await expect(assertRiderCanBook(id)).rejects.toThrow(/banned/i);

    // Disarm â†’ everyone books again (default posture restored).
    await execute(`UPDATE app_config SET value = '{"enabled": false}'::jsonb WHERE key = 'rider_gate'`);
    await riderGateEnabled(true);
    await expect(assertRiderCanBook(id)).resolves.toBeUndefined();
  });


  // â”€â”€ Phase 3: trips + support inbox â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function seedTrip(status = "completed"): Promise<string> {
    const u = await queryOne<{ id: string }>(
      `INSERT INTO users (firebase_uid, full_name, email, phone, role)
       VALUES ($1, 'Trip Rider', $2, '0829998877', 'passenger') RETURNING id`,
      [`ft-${Math.random().toString(36).slice(2)}`, `trip-${Math.random().toString(36).slice(2)}@phase2.test`]
    );
    const d = await queryOne<{ id: string }>(
      `INSERT INTO users (firebase_uid, full_name, email, phone, role)
       VALUES ($1, 'Trip Driver', $2, '0827776655', 'driver') RETURNING id`,
      [`ftd-${Math.random().toString(36).slice(2)}`, `tripdrv-${Math.random().toString(36).slice(2)}@phase2.test`]
    );
    const r = await queryOne<{ id: string }>(
      `INSERT INTO rides (passenger_id, driver_id, pickup_address, destination_address,
                           status, actual_fare, distance_km, completed_at)
       VALUES ($1, $2, 'Sandton City', 'OR Tambo', $3::varchar, 185.50, 22.4,
               CASE WHEN $3::varchar = 'completed' THEN NOW() ELSE NULL END)
       RETURNING id`,
      [u!.id, d!.id, status]
    );
    return r!.id;
  }

  it("trip list filters + search; detail includes the dispatch timeline; 404 unknown", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const id = await seedTrip("completed");
      await execute(
        `INSERT INTO ride_events (ride_id, event, detail) VALUES ($1, 'ride_requested', '{"x":1}'), ($1, 'ride_accepted', NULL)`,
        [id]
      );

      const list = await request("GET", "/api/admin/v2/trips?status=completed");
      expect(list.status).toBe(200);
      const row = list.json.trips.find((t: any) => t.id === id);
      expect(row).toBeTruthy();
      expect(row.rider_name).toBe("Trip Rider");
      expect(row.actual_fare).toBeTruthy(); // display-only money

      const search = await request("GET", "/api/admin/v2/trips?search=Sandton");
      expect(search.json.trips.some((t: any) => t.id === id)).toBe(true);

      const detail = await request("GET", `/api/admin/v2/trips/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.json.trip.events).toHaveLength(2);
      expect(detail.json.trip.events[0].event).toBe("ride_requested");
      expect(detail.json.trip.rider_email).toContain("@phase2.test");

      expect((await request("GET", "/api/admin/v2/trips/00000000-0000-0000-0000-000000000000")).status).toBe(404);

      const stats = await request("GET", "/api/admin/v2/trips/stats");
      expect(stats.status).toBe(200);
      expect(stats.json.stats.total).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("live snapshot returns online drivers + active rides", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      await seedTrip("in_progress");
      const live = await request("GET", "/api/admin/v2/trips/live");
      expect(live.status).toBe(200);
      expect(Array.isArray(live.json.drivers)).toBe(true);
      expect(Array.isArray(live.json.rides)).toBe(true);
      expect(live.json.rides.length).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });




  it("support inbox: create → reply → resolve, all audited; permissions enforced", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";

      // Validation
      expect((await request("POST", "/api/admin/v2/tickets", { subject: "ab", body: "cd" })).status).toBe(400);
      expect(
        (await request("POST", "/api/admin/v2/tickets", {
          subject: "Rider cannot log in",
          body: "Rider called about OTP loop.",
          priority: "asap",
        })).status
      ).toBe(400);

      // Create
      const created = await request("POST", "/api/admin/v2/tickets", {
        subject: "Rider cannot log in",
        body: "Rider called about OTP loop on 082.",
        priority: "high",
        rider_name: "Sipho",
        rider_email: "sipho@example.com",
      });
      expect(created.status).toBe(201);
      const ticket = created.json.ticket;
      expect(ticket.reference).toMatch(/^VURA-[A-Z2-9]{6}$/);
      expect(ticket.status).toBe("open");
      const audit1 = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'ticket.create' ORDER BY id DESC LIMIT 1`
      );
      expect(audit1?.entity_id).toBe(ticket.id);

      // List + search (subject and rider_email are both search columns)
      const list = await request("GET", "/api/admin/v2/tickets?search=sipho");
      expect(list.json.tickets.some((t: any) => t.id === ticket.id)).toBe(true);

      // Reply + internal note
      expect(
        (await request("POST", `/api/admin/v2/tickets/${ticket.id}/messages`, { message: "" })).status
      ).toBe(400);
      expect(
        (await request("POST", `/api/admin/v2/tickets/${ticket.id}/messages`, {
          message: "Asked rider to clear app data and retry.",
        })).status
      ).toBe(201);
      expect(
        (await request("POST", `/api/admin/v2/tickets/${ticket.id}/messages`, {
          message: "Internal: third OTP complaint today.",
          is_internal: true,
        })).status
      ).toBe(201);

      // Resolve (audited old→new)
      const resolved = await request("PATCH", `/api/admin/v2/tickets/${ticket.id}`, {
        status: "resolved",
        reason: "Rider advised",
      });
      expect(resolved.status).toBe(200);
      expect(resolved.json.ticket.status).toBe("resolved");
      expect(resolved.json.ticket.resolved_at).toBeTruthy();
      const audit2 = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'ticket.update' ORDER BY id DESC LIMIT 1`
      );
      expect(audit2?.old_value).toMatchObject({ status: "open" });
      expect(audit2?.new_value).toMatchObject({ status: "resolved" });

      expect(
        (await request("PATCH", `/api/admin/v2/tickets/${ticket.id}`, { status: "on_fire" })).status
      ).toBe(400);

      // Detail includes the 3-message thread
      const detail = await request("GET", `/api/admin/v2/tickets/${ticket.id}`);
      expect(detail.json.ticket.messages).toHaveLength(3);
      expect(detail.json.ticket.messages[0].author_email).toBe("boss@vura.test");

      // support_agent: tickets read+write allowed
      await seedAdmin("sup2@vura.test", "support_agent");
      authUser.email = "sup2@vura.test";
      expect((await request("GET", "/api/admin/v2/tickets")).status).toBe(200);

      // onboarding_reviewer: no tickets.* → 403
      await seedAdmin("onb@vura.test", "onboarding_reviewer");
      authUser.email = "onb@vura.test";
      expect((await request("GET", "/api/admin/v2/tickets")).status).toBe(403);
      expect(
        (await request("POST", "/api/admin/v2/tickets", { subject: "nope", body: "nope" })).status
      ).toBe(403);

      // finance: no trips.* → 403
      await seedAdmin("fin3@vura.test", "finance");
      authUser.email = "fin3@vura.test";
      expect((await request("GET", "/api/admin/v2/trips")).status).toBe(403);
      expect((await request("GET", "/api/admin/v2/trips/live")).status).toBe(403);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  // ── Phase 4: messaging campaigns ────────────────────────────────────────────

  it("campaigns: compose validated + audited; send once only; audience counts", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      await seedRider();
      await seedRider();

      // Validation
      expect(
        (await request("POST", "/api/admin/v2/campaigns", { name: "ab", title: "t", body: "b" })).status
      ).toBe(400);
      expect(
        (await request("POST", "/api/admin/v2/campaigns", {
          name: "Winter promo",
          title: "Save 20%",
          body: "Use code WINTER",
          audience: "aliens",
        })).status
      ).toBe(400);

      // Compose a draft
      const created = await request("POST", "/api/admin/v2/campaigns", {
        name: "Winter promo",
        title: "Save 20% this winter",
        body: "Use code WINTER at checkout.",
        audience: "riders",
      });
      expect(created.status).toBe(201);
      const c = created.json.campaign;
      expect(c.status).toBe("draft");
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'campaign.create' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.entity_id).toBe(c.id);

      // Send: no push tokens exist in the scratch DB → recipient_count = riders,
      // delivered counts depend on the (absent) token table — the send COMPLETES.
      const sent = await request("POST", `/api/admin/v2/campaigns/${c.id}/send`);
      expect(sent.status).toBe(200);
      expect(sent.json.campaign.status).toBe("sent");
      expect(sent.json.campaign.recipient_count).toBeGreaterThanOrEqual(2);
      expect(sent.json.campaign.sent_by).toBe("boss@vura.test");
      const sendAudit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'campaign.send' ORDER BY id DESC LIMIT 1`
      );
      expect(sendAudit?.old_value).toMatchObject({ status: "draft" });
      expect(sendAudit?.new_value).toMatchObject({ status: "sent" });

      // Second send → 409 (the claim UPDATE only fires on draft)
      expect((await request("POST", `/api/admin/v2/campaigns/${c.id}/send`)).status).toBe(409);

      // Detail carries the delivery breakdown
      const detail = await request("GET", `/api/admin/v2/campaigns/${c.id}`);
      expect(detail.status).toBe(200);
      expect(detail.json.campaign.delivery).toBeTruthy();

      // List shows it
      const list = await request("GET", "/api/admin/v2/campaigns");
      expect(list.json.campaigns.some((x: any) => x.id === c.id)).toBe(true);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("campaigns: operations+super_admin may send; support/finance/onboarding denied", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const c = (
        await request("POST", "/api/admin/v2/campaigns", {
          name: "Perm check",
          title: "Perm check",
          body: "Perm check body.",
          audience: "drivers",
        })
      ).json.campaign;

      // support_agent: no messaging.send
      await seedAdmin("sup4@vura.test", "support_agent");
      authUser.email = "sup4@vura.test";
      expect((await request("GET", "/api/admin/v2/campaigns")).status).toBe(403);
      expect((await request("POST", "/api/admin/v2/campaigns", { name: "x", title: "y", body: "z" })).status).toBe(403);
      expect((await request("POST", `/api/admin/v2/campaigns/${c.id}/send`)).status).toBe(403);

      // finance: no messaging.send
      await seedAdmin("fin4@vura.test", "finance");
      authUser.email = "fin4@vura.test";
      expect((await request("GET", "/api/admin/v2/campaigns")).status).toBe(403);

      // operations: messaging.send present → allowed
      await seedAdmin("ops5@vura.test", "operations");
      authUser.email = "ops5@vura.test";
      expect((await request("GET", "/api/admin/v2/campaigns")).status).toBe(200);
      const sent = await request("POST", `/api/admin/v2/campaigns/${c.id}/send`);
      expect(sent.status).toBe(200);
      expect(sent.json.campaign.sent_by).toBe("ops5@vura.test");
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("features: flat flag read + permission gate + audited write", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";

      // Seed the RC4 config row (production gets it from migration 001; the
      // scratch suite only applies 004+).
      await execute(
        `INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [
          "matching",
          JSON.stringify({
            h3_matching_enabled: false,
            h3_rollout_mode: "off",
            h3_rollout_rider_ids: [],
            h3_rollout_percent: 0,
          }),
        ]
      );

      const read = await request("GET", "/api/admin/v2/features");
      expect(read.status).toBe(200);
      expect(read.json.flags.matching.exists).toBe(true);
      expect(read.json.flags.destination).toBeTruthy();
      expect(read.json.flags.performance_tier).toBeTruthy();
      // rider_gate seeded by migration 006 — default OFF.
      expect(read.json.flags.rider_gate.enabled).toBe(false);

      // Validation: unknown key → 400, unknown field → 400, empty → 400.
      expect(
        (await request("PUT", "/api/admin/v2/features/rider_gate", { changes: { x: 1 } })).status
      ).toBe(400);
      expect(
        (await request("PUT", "/api/admin/v2/features/matching", { changes: { nope: 1 } })).status
      ).toBe(400);
      expect(
        (await request("PUT", "/api/admin/v2/features/matching", { changes: {} })).status
      ).toBe(400);

      // Write: flip matching on with audit old→new.
      const write = await request("PUT", "/api/admin/v2/features/matching", {
        changes: { h3_matching_enabled: true },
      });
      expect(write.status).toBe(200);
      expect(write.json.flags.matching.h3_matching_enabled).toBe(true);
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'feature.update' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.entity_id).toBe("matching");
      expect(audit?.old_value).toMatchObject({ h3_matching_enabled: false });
      expect(audit?.new_value).toMatchObject({ h3_matching_enabled: true });

      // Permission: operations may READ, only super_admin may WRITE.
      await seedAdmin("ops6@vura.test", "operations");
      authUser.email = "ops6@vura.test";
      expect((await request("GET", "/api/admin/v2/features")).status).toBe(200);
      expect(
        (await request("PUT", "/api/admin/v2/features/matching", {
          changes: { h3_matching_enabled: false },
        })).status
      ).toBe(403);

      // finance: no features.read at all.
      await seedAdmin("fin6@vura.test", "finance");
      authUser.email = "fin6@vura.test";
      expect((await request("GET", "/api/admin/v2/features")).status).toBe(403);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("settings: required docs + reject reasons read, audited edit, gated", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";

      const read = await request("GET", "/api/admin/v2/settings");
      expect(read.status).toBe(200);
      expect(read.json.required_docs.map((d: any) => d.doc_type)).toContain("prdp");
      expect(read.json.reject_reasons.map((r: any) => r.code)).toContain("blurry");

      // Unknown rows → 404, known row → audited update.
      expect(
        (await request("PATCH", "/api/admin/v2/settings/required-docs/ghost", { active: false }))
          .status
      ).toBe(404);
      expect(
        (await request("PATCH", "/api/admin/v2/settings/reject-reasons/ghost", { active: false }))
          .status
      ).toBe(404);

      const upd = await request("PATCH", "/api/admin/v2/settings/required-docs/prdp", {
        label: "PRDP Police Clear",
        active: false,
      });
      expect(upd.status).toBe(200);
      expect(upd.json.doc.label).toBe("PRDP Police Clear");
      expect(upd.json.doc.active).toBe(false);
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'settings.required_doc_update'
          ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.entity_id).toBe("prdp");
      expect(audit?.old_value).toMatchObject({ active: true });

      // Permission: operations has settings.read but NOT settings.write.
      await seedAdmin("ops7@vura.test", "operations");
      authUser.email = "ops7@vura.test";
      expect((await request("GET", "/api/admin/v2/settings")).status).toBe(200);
      expect(
        (await request("PATCH", "/api/admin/v2/settings/reject-reasons/blurry", { active: false }))
          .status
      ).toBe(403);

      // support_agent has neither.
      await seedAdmin("sup7@vura.test", "support_agent");
      authUser.email = "sup7@vura.test";
      expect((await request("GET", "/api/admin/v2/settings")).status).toBe(403);

      // Restore the seeded defaults (scratch DB persists across suites).
      await execute(
        `UPDATE admin_required_docs SET active = TRUE, label = 'PRDP' WHERE doc_type = 'prdp'`
      );
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("status: db ok, migrations list, counts — features.read gated", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      // boss resolves via the ADMIN_EMAILS env fallback (no admin_users row);
      // beforeEach wipes the table — seed one so the count is non-zero.
      await seedAdmin("boss@vura.test", "super_admin");
      const res = await request("GET", "/api/admin/v2/status");
      expect(res.status).toBe(200);
      expect(res.json.status.db_ok).toBe(true);
      expect(Array.isArray(res.json.status.migrations_applied)).toBe(true);
      expect(res.json.status.flags.rider_gate).toBeTruthy();
      const c = res.json.status.counts;
      expect(c.admins).toBeGreaterThanOrEqual(1);
      expect(c.riders).toBeGreaterThanOrEqual(0);

      await seedAdmin("fin8@vura.test", "finance");
      authUser.email = "fin8@vura.test";
      expect((await request("GET", "/api/admin/v2/status")).status).toBe(403);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("money: read-only overview/payments/payouts/earnings, masked + gated", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";

      // Seed money rows the way prod would have them.
      const rider = await queryOne<{ id: string }>(
        `INSERT INTO users (email, phone, full_name, role) VALUES ('cash@phase2.test', '+27821234567', 'Cash Rider', 'passenger') RETURNING id`
      );
      const driver = await queryOne<{ id: string }>(
        `INSERT INTO users (email, phone, full_name, role) VALUES ('paid@phase2.test', '+27827654321', 'Paid Driver', 'driver') RETURNING id`
      );
      const ride = await queryOne<{ id: string }>(
        `INSERT INTO rides (passenger_id, status, actual_fare) VALUES ($1, 'completed', 89.50) RETURNING id`,
        [rider!.id]
      );
      await execute(
        `INSERT INTO payments (user_id, ride_id, reference, amount, status, provider) VALUES
           ($1, $2, 'PAY-OK', 89.50, 'success', 'paystack'),
           ($1, $2, 'PAY-FAIL', 89.50, 'failed', 'paystack')`,
        [rider!.id, ride!.id]
      );
      await execute(
        `INSERT INTO payouts (driver_id, amount, reference, status, bank_name, account_number)
         VALUES ($1, 500, 'PO-1', 'success', 'FNB', '62123456789')`,
        [driver!.id]
      );
      await execute(
        `INSERT INTO driver_earnings (driver_id, ride_id, gross_amount, fee, request_fee, net_amount)
         VALUES ($1, $2, 89.50, 10, 2, 77.50)`,
        [driver!.id, ride!.id]
      );

      // Overview aggregates real rows, states its currency + read-only stance.
      const ov = await request("GET", "/api/admin/v2/money/overview");
      expect(ov.status).toBe(200);
      const o = ov.json.overview;
      expect(o.currency).toBe("ZAR");
      expect(o.rides_completed).toBe(1);
      expect(Number(o.gross_fare_zar)).toBeCloseTo(89.5, 2);
      expect(o.payments_success).toBe(1);
      expect(o.payments_failed).toBe(1);
      expect(o.payouts_paid).toBe(1);
      expect(Number(o.earnings_net_zar)).toBeCloseTo(77.5, 2);
      expect(o.note).toMatch(/read-only/i);

      // Payments mask the rider phone (POPIA) — last 7 visible, prefix kept.
      const pay = await request("GET", "/api/admin/v2/money/payments");
      expect(pay.status).toBe(200);
      const p = pay.json.payments.find((x: any) => x.reference === "PAY-OK");
      expect(p.status).toBe("success");
      expect(p.rider_name).toBe("Cash Rider");
      expect(p.rider_phone_masked).not.toContain("821234567");
      expect(p.rider_phone_masked).toMatch(/\*\*\*/);

      // Payouts mask the bank account to the last 4 digits.
      const po = await request("GET", "/api/admin/v2/money/payouts");
      expect(po.status).toBe(200);
      const po1 = po.json.payouts[0];
      expect(po1.account_masked).toBe("****6789");
      expect(po1.account_masked).not.toContain("621234");

      // Earnings ledger per driver.
      const er = await request("GET", "/api/admin/v2/money/earnings");
      expect(er.status).toBe(200);
      const e = er.json.earnings.find((x: any) => x.driver_name === "Paid Driver");
      expect(Number(e.net)).toBeCloseTo(77.5, 2);
      expect(Number(e.gross)).toBeCloseTo(89.5, 2);

      // Permission: finance may read money; support_agent (no money.read) 403.
      await seedAdmin("fin9@vura.test", "finance");
      authUser.email = "fin9@vura.test";
      expect((await request("GET", "/api/admin/v2/money/overview")).status).toBe(200);

      await seedAdmin("sup9@vura.test", "support_agent");
      authUser.email = "sup9@vura.test";
      for (const path of ["overview", "payments", "payouts", "earnings"]) {
        expect((await request("GET", `/api/admin/v2/money/${path}`)).status).toBe(403);
      }
      // There are NO money action endpoints — the router has no POST/PATCH
      // under /money; this test exercises only GETs by design.
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("car db: miss recorded once + alerted once; listed; manual resolve audited", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const driver = await queryOne<{ id: string }>(
        `INSERT INTO users (email, full_name, role) VALUES ('cardb1@phase2.test', 'Car DB Driver', 'driver') RETURNING id`
      );
      const v = { make: "Toyota", model: "Etios", year: 2017, colour: "blue" };
      const key = vehicleImageCacheKey(v);

      // The exact hook noteDriverVehicle runs on a Car-DB miss — twice.
      await recordVehicleRequestMiss(driver!.id, v, key);
      await recordVehicleRequestMiss(driver!.id, v, key);
      const rows = await query<any>(
        `SELECT * FROM admin_vehicle_requests WHERE driver_id = $1`,
        [driver!.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("open");
      expect(rows[0].driver_notified_at).toBeTruthy(); // alerted EXACTLY once

      const list = await request("GET", "/api/admin/v2/vehicle-requests");
      expect(list.status).toBe(200);
      const item = list.json.requests.find((r: any) => r.id === rows[0].id);
      expect(item.driver_name).toBe("Car DB Driver");

      const cat = await request("GET", "/api/admin/v2/car-db/catalogue");
      expect(cat.status).toBe(200);
      expect(cat.json.makes.length).toBeGreaterThan(0);

      // Manual close → audited old→new.
      const resolved = await request("POST", `/api/admin/v2/vehicle-requests/${rows[0].id}/resolve`, {
        reason: "Driver corrected the model spelling",
      });
      expect(resolved.status).toBe(200);
      expect(resolved.json.request.status).toBe("resolved");
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'vehicle_request.resolve' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.entity_id).toBe(rows[0].id);

      // Permissions: support has neither catalogue perm; operations has both.
      await seedAdmin("supC@vura.test", "support_agent");
      authUser.email = "supC@vura.test";
      expect((await request("GET", "/api/admin/v2/vehicle-requests")).status).toBe(403);
      expect((await request("GET", "/api/admin/v2/car-db/catalogue")).status).toBe(403);
      await seedAdmin("opsC@vura.test", "operations");
      authUser.email = "opsC@vura.test";
      expect((await request("GET", "/api/admin/v2/vehicle-requests")).status).toBe(200);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("car db: approve releases open requests (auto-pull); upload validates; generate needs key", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    const prevKey = process.env.GEMINI_API_KEY;
    try {
      authUser.email = "boss@vura.test";
      const driver = await queryOne<{ id: string }>(
        `INSERT INTO users (email, full_name, role) VALUES ('cardb2@phase2.test', 'Picanto Owner', 'driver') RETURNING id`
      );
      const v = { make: "Kia", model: "Picanto", year: 2018, colour: "white" };
      const key = vehicleImageCacheKey(v);
      await recordVehicleRequestMiss(driver!.id, v, key);

      // A pending image row (as the worker would leave it) + approve via console.
      const img = await queryOne<{ id: string }>(
        `INSERT INTO vehicle_images (cache_key, make, model, year, colour, status, candidates)
         VALUES ($1, 'kia', 'picanto', 2018, 'white', 'pending',
                 $2::jsonb) RETURNING id`,
        [key, JSON.stringify([{ url: "https://x/1.jpg", storageKey: "vehicle-images/x-1", width: 900, height: 560 }])]
      );
      const approved = await request("POST", `/api/admin/v2/car-db/images/${img!.id}/approve`, {
        candidateIndex: 0,
      });
      expect(approved.status).toBe(200);
      expect(approved.json.resolvedRequests).toBe(1); // THE AUTO-PULL
      const req1 = await queryOne<any>(
        `SELECT * FROM admin_vehicle_requests WHERE driver_id = $1`,
        [driver!.id]
      );
      expect(req1?.status).toBe("resolved");
      expect(req1?.image_id).toBe(img!.id);

      // Upload validation → 400 without the trio.
      const bad = await request("POST", "/api/admin/v2/car-db/image", { make: "BMW" });
      expect(bad.status).toBe(400);

      // Generate with no white source (no upload, no approved white row) → honest 400.
      const gen = await request("POST", "/api/admin/v2/car-db/generate", {
        make: "BMW",
        model: "320i",
      });
      expect(gen.status).toBe(400);
      expect(gen.json.error).toMatch(/white original/);

      // CarXE search route REMOVED by request — the platform is Car DB + v12 only.
      const search = await request("POST", "/api/admin/v2/car-db/search", {
        make: "BMW",
        model: "3 Series",
        year: 2020,
        colour: "black",
      });
      expect(search.status).toBe(404);

      // Generate Car All: background v12-only run, one at a time. With
      // RECOLOUR_PYTHON=off the background run aborts instantly, writing nothing.
      const ga = await request("POST", "/api/admin/v2/car-db/generate-all", {});
      expect(ga.status).toBe(200);
      expect(ga.json.running).toBe(true);
      const gaAgain = await request("POST", "/api/admin/v2/car-db/generate-all", {});
      expect(gaAgain.json.running).toBe(true); // one run at a time

      // finance: catalogue.read is NOT in the finance matrix.
      await seedAdmin("finC@vura.test", "finance");
      authUser.email = "finC@vura.test";
      expect((await request("GET", "/api/admin/v2/car-db/images")).status).toBe(403);
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("documents: auto-verification writes verdicts; staff still has the final click", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const driver = await seedDriver("UNDER_REVIEW");
      // Align the account name with the canned document text so the free
      // name-match check doesn't (correctly) downgrade the pass.
      await execute(`UPDATE users SET full_name = 'Tester' WHERE id = $1`, [driver]);
      // A genuinely valid SA ID (correct Luhn check digit), built inline.
      const base = "900101580000";
      let goodId = "";
      for (let d = 0; d <= 9 && !goodId; d++) {
        const cand = base + String(d);
        let sum = 0;
        for (let i = 0; i < cand.length; i++) {
          let x = Number(cand[cand.length - 1 - i]);
          if (i % 2 === 1) {
            x *= 2;
            if (x > 9) x -= 9;
          }
          sum += x;
        }
        if (sum % 10 === 0) goodId = cand;
      }
      expect(goodId).toBeTruthy();

      const doc = await queryOne<{ id: string }>(
        `INSERT INTO driver_documents (driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, status)
         VALUES ($1, 'id_document', 'id.jpg', 'image/jpeg', 'vehicle-images/auto-test-id', 'b', 'pending_review')
         RETURNING id`,
        [driver]
      );
      (getObjectFromS3 as any).mockResolvedValue(Buffer.from("fake-image"));
      const v = await verifyDocument(doc!.id, async () => ({
        text: `REPUBLIC OF SOUTH AFRICA\nIDENTITY NUMBER ${goodId}\nSURNAME TESTER`,
        confidence: 90,
      }));
      expect(v?.status).toBe("approved"); // automatic pass…
      const row = await queryOne<any>(
        `SELECT status, auto_status FROM driver_documents WHERE id = $1`,
        [doc!.id]
      );
      expect(row.auto_status).toBe("approved");
      expect(row.status).toBe("pending_review"); // …but staff still clicks Approve

      // Unparseable / unreadable file → goes to STAFF, never auto-rejected.
      const doc2 = await queryOne<{ id: string }>(
        `INSERT INTO driver_documents (driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, status)
         VALUES ($1, 'drivers_license', 'lic.jpg', 'image/jpeg', 'vehicle-images/auto-test-lic', 'b', 'pending_review')
         RETURNING id`,
        [driver]
      );
      const v2 = await verifyDocument(doc2!.id, async () => ({ text: "nope", confidence: 5 }));
      expect(v2?.status).toBe("needs_review");
      const row2 = await queryOne<any>(
        `SELECT status, note, auto_status FROM driver_documents WHERE id = $1`,
        [doc2!.id]
      );
      expect(row2.status).toBe("pending_review"); // stays pending for staff
      expect(row2.auto_status).toBe("needs_review");
      expect(row2.note).toBeNull(); // no driver-facing note for a non-reject

      // OCR budget: over the per-driver daily limit → no call, stays pending.
      process.env.OCR_MAX_PER_DRIVER_DAY = "2"; // doc + doc2 already used today's two
      const doc3 = await queryOne<{ id: string }>(
        `INSERT INTO driver_documents (driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, status)
         VALUES ($1, 'license_disk', 'disc.jpg', 'image/jpeg', 'vehicle-images/auto-test-disc', 'b', 'pending_review')
         RETURNING id`,
        [driver]
      );
      const v3 = await verifyDocument(doc3!.id, async () => ({ text: "LICENCE DISC VIN ABC123", confidence: 90 }));
      expect(v3?.status).toBe("skipped_rate_limit");
      const row3 = await queryOne<any>(
        `SELECT status, auto_status, verified_at FROM driver_documents WHERE id = $1`,
        [doc3!.id]
      );
      expect(row3.auto_status).toBeNull(); // untouched — no OCR ran
      expect(row3.verified_at).toBeNull();
      expect(row3.status).toBe("pending_review");

      // Global daily cap across ALL drivers: reached → skip, stay pending.
      process.env.DOC_READS_PER_DAY = "0";
      const doc4 = await queryOne<{ id: string }>(
        `INSERT INTO driver_documents (driver_id, doc_type, file_name, mime_type, s3_key, s3_bucket, status)
         VALUES ($1, 'id_document', 'id2.jpg', 'image/jpeg', 'vehicle-images/auto-test-id2', 'b', 'pending_review')
         RETURNING id`,
        [driver]
      );
      const v4 = await verifyDocument(doc4!.id, async () => ({ text: "LICENCE DISC", confidence: 90 }));
      expect(v4?.status).toBe("skipped_daily_cap");
      const row4 = await queryOne<any>(`SELECT auto_status FROM driver_documents WHERE id = $1`, [doc4!.id]);
      expect(row4.auto_status).toBeNull();
    } finally {
      delete process.env.ADMIN_EMAILS;
      delete process.env.OCR_MAX_PER_DRIVER_DAY;
      delete process.env.DOC_READS_PER_DAY;
    }
  });

  it("documents: verifying the LAST required doc completes the set (audited); reject notif 404s cleanly", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      const driver = await queryOne<{ id: string }>(
        `INSERT INTO users (email, full_name, role) VALUES ('docs1@phase2.test', 'Doc Driver', 'driver') RETURNING id`
      );
      // The five static required types: four already approved, prdp pending.
      for (const t of ["id_document", "drivers_license", "criminal_record", "carscan_report"]) {
        await execute(
          `INSERT INTO driver_documents (driver_id, doc_type, file_name, status) VALUES ($1, $2, $3, 'approved')`,
          [driver!.id, t, `${t}.jpg`]
        );
      }
      const pending = await queryOne<{ id: string }>(
        `INSERT INTO driver_documents (driver_id, doc_type, file_name, status) VALUES ($1, 'prdp', 'prdp.jpg', 'pending_review') RETURNING id`,
        [driver!.id]
      );

      // Approving one of several would NOT complete the set — seed one more pending
      // first? No: prove the COMPLETION case (4 of 5 already approved).
      const ok = await request("POST", `/api/admin/v2/documents/${pending!.id}/approve`, {});
      expect(ok.status).toBe(200);
      expect(ok.json.allApproved).toBe(true); // the "ALL verified" push fires here
      expect(ok.json.document.status).toBe("approved");
      const audit = await queryOne<any>(
        `SELECT * FROM admin_audit_log WHERE action = 'document.approve' ORDER BY id DESC LIMIT 1`
      );
      expect(audit?.entity_id).toBe(pending!.id);

      // 404 for an unknown document.
      expect(
        (await request("POST", "/api/admin/v2/documents/00000000-0000-0000-0000-000000000000/approve", {})).status
      ).toBe(404);

      // Permissions: onboarding_reviewer holds documents.review; support does not.
      await seedAdmin("onb8@vura.test", "onboarding_reviewer");
      authUser.email = "onb8@vura.test";
      expect((await request("POST", `/api/admin/v2/documents/${pending!.id}/approve`, {})).status).toBe(200);
      await seedAdmin("sup8@vura.test", "support_agent");
      authUser.email = "sup8@vura.test";
      expect((await request("POST", `/api/admin/v2/documents/${pending!.id}/reject`, { note: "blurry" })).status).toBe(403);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("car db: auto-fill recolours a missing colour from the car's light original", async () => {
    process.env.ADMIN_EMAILS = "boss@vura.test";
    try {
      authUser.email = "boss@vura.test";
      // A real white studio-ish PNG stands in for the S3 object.
      const sharp = (await import("sharp")).default;
      const whitePng = await sharp({
        create: { width: 60, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } },
      })
        .composite([
          {
            input: await sharp({
              create: { width: 30, height: 20, channels: 3, background: { r: 230, g: 230, b: 235 } },
            })
              .png()
              .toBuffer(),
            top: 10,
            left: 15,
          },
        ])
        .png()
        .toBuffer();
      (getObjectFromS3 as any).mockResolvedValueOnce(whitePng);

      // Car exists in SILVER only (the 03-Oct import state) — red is missing.
      const key = vehicleImageCacheKey({ make: "Ford", model: "Figo", year: 2019, colour: "silver" });
      await execute(
        `INSERT INTO vehicle_images (cache_key, make, model, year, colour, image_url, storage_key, status)
         VALUES ($1, 'ford', 'figo', 2019, 'silver', 'https://x/s.webp', 'vehicle-images/figo-silver', 'approved')`,
        [key]
      );

      const made = await autoFillMissingColours(50);
      // STRICT v12-only: RECOLOUR_PYTHON=off → no python → write NOTHING
      // (sharp fallback banned; non-v12 colours were rejected by the user).
      expect(made).toBe(0);
      const first = await queryOne<any>(
        `SELECT status FROM vehicle_images WHERE cache_key = $1`,
        [vehicleImageCacheKey({ make: "Ford", model: "Figo", year: 2019, colour: "grey" })]
      );
      expect(first).toBeFalsy(); // nothing written by a non-v12 engine

      // A second run still writes nothing (and can't duplicate anything).
      (getObjectFromS3 as any).mockResolvedValueOnce(whitePng);
      await autoFillMissingColours(50);
      const again = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM vehicle_images WHERE cache_key = $1`,
        [vehicleImageCacheKey({ make: "Ford", model: "Figo", year: 2019, colour: "grey" })]
      );
      expect(again[0].n).toBe(0);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });
});



