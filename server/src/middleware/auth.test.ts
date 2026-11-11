import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const security = vi.hoisted(() => ({
  getUserSecurityGate: vi.fn(),
  isDeviceRevoked: vi.fn(async () => false),
  verifyUserStepUpToken: vi.fn(),
}));

const firebase = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock("../config/firebase", () => ({
  getAuth: () => ({ verifyIdToken: firebase.verifyIdToken }),
}));
vi.mock("../config/database", () => ({
  queryOne: vi.fn(async () => null),
}));
vi.mock("../services/featureFlags", () => ({
  readMaintenanceStatus: vi.fn(async () => ({
    rider: { enabled: false, message: "", revokeBefore: null },
    driver: { enabled: false, message: "", revokeBefore: null },
  })),
}));
vi.mock("../services/userSecurity", () => security);

import { requireAuth } from "./auth";

let server: any;
let base = "";

beforeEach(async () => {
  security.getUserSecurityGate.mockReset();
  security.isDeviceRevoked.mockReset();
  security.verifyUserStepUpToken.mockReset();
  firebase.verifyIdToken.mockReset();

  security.isDeviceRevoked.mockResolvedValue(false);
  security.getUserSecurityGate.mockResolvedValue({
    enabled: true,
    epoch: 4,
    sessionsValidAfter: 0,
  });
  security.verifyUserStepUpToken.mockImplementation(
    (uid: string, token: string, epoch: number) =>
      uid === "uid-1" && token === "good-token" && epoch === 4
  );
  firebase.verifyIdToken.mockResolvedValue({
    uid: "uid-1",
    email: "rider@example.com",
    iat: Math.floor(Date.now() / 1000),
    auth_time: Math.floor(Date.now() / 1000),
  });

  const app = express();
  app.get("/api/protected", requireAuth, (_req, res) => res.json({ ok: true }));
  app.get("/api/users/security/status", requireAuth, (_req, res) => res.json({ ok: true }));
  app.post("/api/users/sync", requireAuth, (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => server?.close());

const auth = { Authorization: "Bearer firebase-token" };

describe("account 2FA gate", () => {
  it("refuses protected calls while the second factor is outstanding", async () => {
    const res = await fetch(`${base}/api/protected`, { headers: auth });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "two_factor_required" });
  });

  it("allows the call with a valid step-up token", async () => {
    const res = await fetch(`${base}/api/protected`, {
      headers: { ...auth, "X-Vura-2FA": "good-token" },
    });
    expect(res.status).toBe(200);
    expect(security.verifyUserStepUpToken).toHaveBeenCalledWith("uid-1", "good-token", 4);
  });

  it("lets the app reach status and sync so it can render the challenge", async () => {
    const status = await fetch(`${base}/api/users/security/status`, { headers: auth });
    expect(status.status).toBe(200);
    const sync = await fetch(`${base}/api/users/sync`, { method: "POST", headers: auth });
    expect(sync.status).toBe(200);
  });

  it("rejects an ID token issued before a sign-out-everywhere cutoff", async () => {
    security.getUserSecurityGate.mockResolvedValue({
      enabled: false,
      epoch: 0,
      sessionsValidAfter: Math.floor(Date.now() / 1000) + 60,
    });
    const res = await fetch(`${base}/api/protected`, { headers: auth });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "session_revoked" });
  });

  it("rejects a device that was remotely signed out", async () => {
    security.getUserSecurityGate.mockResolvedValue({
      enabled: false,
      epoch: 0,
      sessionsValidAfter: 0,
    });
    security.isDeviceRevoked.mockResolvedValue(true);
    const res = await fetch(`${base}/api/protected`, {
      headers: { ...auth, "X-Vura-Device": "device-12345678" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "session_revoked" });
  });
});
