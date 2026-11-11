import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const db = vi.hoisted(() => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
const authTime = vi.hoisted(() => ({ value: 0 }));

vi.mock("../config/database", () => db);
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "firebase-1";
    req.user = { uid: "firebase-1", email: "person@example.com" };
    req.authTime = authTime.value;
    next();
  },
}));
vi.mock("../config/firebase", () => ({
  getAuth: () => ({ deleteUser: vi.fn(), generatePasswordResetLink: vi.fn() }),
}));
vi.mock("../services/accountDeletion", () => ({ deleteAccountData: vi.fn() }));
vi.mock("../services/AffiliateService", () => ({
  claimReferral: vi.fn(),
  ensureAffiliateTables: vi.fn(),
}));
vi.mock("../services/adminInvite", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendResendEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../services/duplicateDetection", () => ({
  findDuplicateMatches: vi.fn(async () => []),
  markUserDuplicate: vi.fn(async () => false),
}));
vi.mock("../services/featureFlags", () => ({
  readMaintenanceStatus: vi.fn(async () => ({
    rider: { enabled: false, message: "" },
    driver: { enabled: false, message: "" },
  })),
}));
vi.mock("../services/userSecurity", () => ({
  logSecurityEvent: vi.fn(async () => undefined),
}));

import usersRouter from "./users";

let server: any;
let base = "";

beforeEach(async () => {
  authTime.value = Math.floor(Date.now() / 1000);
  db.query.mockReset();
  db.queryOne.mockReset();
  db.execute.mockClear();

  const app = express();
  app.use(express.json());
  app.use("/api/users", usersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => server?.close());

const auth = { Authorization: "Bearer t" };

describe("role hardening", () => {
  it("never lets a client self-assign admin", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM users")) return null; // new account
      if (sql.includes("INSERT INTO users")) {
        return { id: "u-1", role: "passenger", email: "person@example.com" };
      }
      return null;
    });

    const res = await fetch(`${base}/api/users/sync`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin", full_name: "A Person" }),
    });
    expect(res.status).toBe(201);
    const insert = db.queryOne.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO users"));
    expect(insert?.[1]?.[5]).toBe("passenger");
  });
});

describe("email change protection", () => {
  function mockProfile() {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT email, id_number")) {
        return { email: "old@example.com", id_number: null };
      }
      if (sql.includes("SELECT id, firebase_uid")) {
        return { id: "u-1", firebase_uid: "firebase-1", email: "new@example.com", phone: null, role: "passenger" };
      }
      return null;
    });
  }

  it("refuses an email change without a fresh password sign-in", async () => {
    mockProfile();
    authTime.value = Math.floor(Date.now() / 1000) - 3600;
    const res = await fetch(`${base}/api/users/profile`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "reauth_required" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("allows it after a recent sign-in and audits the change", async () => {
    mockProfile();
    const res = await fetch(`${base}/api/users/profile`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    });
    expect(res.status).toBe(200);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET email = $1"),
      ["new@example.com", "firebase-1"]
    );
  });

  it("does not block a normal phone/name save", async () => {
    mockProfile();
    authTime.value = Math.floor(Date.now() / 1000) - 7200;
    const res = await fetch(`${base}/api/users/profile`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: "New Name", phone: "+27821234567" }),
    });
    expect(res.status).toBe(200);
  });
});
