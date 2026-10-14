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
import adminV2Router from "../routes/adminV2";

// Point the pool at the scratch container FIRST (the pool reads env lazily on
// first query), then assert it â€” same contract as rc4.integration.test.ts.
const enabled = !!process.env.VURA_TEST_DB_PORT;
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.VURA_TEST_DB_PORT || "";
process.env.DB_NAME = process.env.VURA_TEST_DB_NAME || SCRATCH_DB.name;
process.env.DB_USER = process.env.VURA_TEST_DB_USER || "vura_admin";
process.env.DB_PASSWORD = process.env.VURA_TEST_DB_PASSWORD || "vura2thinkdifferent";
process.env.DB_SSL = "false";
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
-- Phase 2: rides (rider stats) + app_config (rider_gate flag seed).
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID REFERENCES users(id),
  driver_id UUID,
  status VARCHAR(20) DEFAULT 'searching',
  actual_fare NUMERIC(10,2),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
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
  method: "GET" | "POST" | "PATCH",
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
    // Base schema first (shared scratch container), then migrations 004 + 005
    // the way migrate-on-boot does: files, in order, TWICE (idempotence proof).
    await execute(BASE_SCHEMA);
    for (const file of [
      "004_admin_v2.sql",
      "005_admin_drivers.sql",
      "006_admin_riders.sql",
      "007_admin_trips.sql",
      "008_admin_messaging.sql",
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
    await execute(
      `DELETE FROM rides WHERE passenger_id IN (SELECT id FROM users WHERE email LIKE '%@phase2.test')`
    );
    await execute(`DELETE FROM users WHERE email LIKE '%@phase2.test'`);
    await execute(`DELETE FROM support_ticket_messages`);
    await execute(`DELETE FROM support_tickets`);
    await execute(`DELETE FROM ride_events`);
    await execute(`DELETE FROM admin_campaigns`);
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
});
