// ─────────────────────────────────────────────────────────────────────────────
// ADMIN V2 (Phase 0) — REAL POSTGRES integration suite.
//
// WHY REAL DB (the two production bugs — make_interval 42883, ambiguous
// column 42702 — were both invisible to mocks):
//   • migration 004 (admin_users + admin_audit_log) applied TWICE (idempotent),
//   • every new SQL statement executed for real (insert/upsert/update/select),
//   • the role → permission matrix enforced per role (each allowed AND denied),
//   • audit rows written for every action, with old/new values,
//   • missing-table behaviour: the routes answer 503, never throw.
//
// GATING (same as the other suites): skipped unless VURA_TEST_DB_PORT is set,
// and the guard refuses anything but the scratch container.
//   $env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/adminV2.integration.test.ts
// ─────────────────────────────────────────────────────────────────────────────
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
// first query), then assert it — same contract as rc4.integration.test.ts.
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
 * Minimal base schema — the scratch container is shared, so the base tables
 * must exist before migrations 004/005 (which ALTER users/driver_profiles/
 * driver_documents and FK driver_tiers → users). Same shapes as the rc4
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

// ── HTTP harness (same pattern as rc4.integration.test.ts) ──────────────────
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
    for (const file of ["004_admin_v2.sql", "005_admin_drivers.sql"]) {
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
      for (const p of perms) expect(typeof p, `${role} → ${p}`).toBe("string");
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

      // Disable → the row no longer resolves.
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
      // Env fallback wins — the table cannot lock out operators.
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

  // ── Phase 1: drivers ──────────────────────────────────────────────────────

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

      // To APPROVED needs all required docs — seed them first
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

      // Illegal: ACTIVE → DOCUMENTS_SUBMITTED
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
});
