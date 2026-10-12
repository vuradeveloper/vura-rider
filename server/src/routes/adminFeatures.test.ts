// ─────────────────────────────────────────────────────────────────────────────
// RC4 — ADMIN EMAILS ROUTE GATE (real HTTP on an ephemeral port; auth and the
// flag service are mocked so the exact isAdmin code path runs unchanged).
//
// The contract this file pins down:
//   • email on ADMIN_EMAILS (case-insensitive) → the service answers;
//   • a REAL signed-in user whose email is NOT on the list → 403
//     {"error":"Admin only"} and the service is NEVER called;
//   • empty ADMIN_EMAILS → everyone is refused (fail closed, never open).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

const svc = vi.hoisted(() => ({
  FeatureFlagError: class FeatureFlagError extends Error {},
  readFeatures: vi.fn(async () => ({ server_build: "abc1234", flags: { sentinel: true } })),
  updateFeature: vi.fn(async () => ({ ok: true })),
  enableForAccounts: vi.fn(async () => ({ enabled: true })),
  disableAllFeatures: vi.fn(async () => ({ disabled: true })),
}));
vi.mock("../services/featureFlags", () => svc);

// requireAuth stand-in: a signed-in user when the x-test-email header is
// present, no user otherwise — so the REAL isAdmin gate does the deciding.
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const email = req.header("x-test-email");
    req.user = email ? { uid: "fb-uid-1", email } : undefined;
    req.userId = "fb-uid-1";
    next();
  },
}));

import adminFeaturesRouter from "./adminFeatures";

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAILS = "boss@ridevura.com";
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminFeaturesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete process.env.ADMIN_EMAILS;
});

describe("ADMIN_EMAILS gate on /api/admin/features*", () => {
  it("email on the list (any case) → 200 and the service answers", async () => {
    const res = await fetch(`${base}/api/admin/features`, {
      headers: { "x-test-email": "BOSS@RideVura.com" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ server_build: "abc1234" });
    expect(svc.readFeatures).toHaveBeenCalledTimes(1);
  });

  it("a signed-in user NOT on the list → 403 'Admin only' and NO service call", async () => {
    const get = await fetch(`${base}/api/admin/features`, {
      headers: { "x-test-email": "intruder@evil.dev" },
    });
    expect(get.status).toBe(403);
    expect(await get.json()).toEqual({ error: "Admin only" });

    const post = await fetch(`${base}/api/admin/features/enable`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-email": "intruder@evil.dev" },
      body: "{}",
    });
    expect(post.status).toBe(403);
    expect(await post.json()).toEqual({ error: "Admin only" });

    expect(svc.readFeatures).not.toHaveBeenCalled();
    expect(svc.enableForAccounts).not.toHaveBeenCalled();
    expect(svc.disableAllFeatures).not.toHaveBeenCalled();
  });

  it("empty ADMIN_EMAILS → everyone is refused, even the boss (fail closed)", async () => {
    process.env.ADMIN_EMAILS = "";
    const res = await fetch(`${base}/api/admin/features`, {
      headers: { "x-test-email": "boss@ridevura.com" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Admin only" });
    expect(svc.readFeatures).not.toHaveBeenCalled();
  });

  it("POST /features/disable: admin → 200 via disableAllFeatures; intruder → 403, untouched", async () => {
    const ok = await fetch(`${base}/api/admin/features/disable`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-email": "boss@ridevura.com" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ disabled: true });
    expect(svc.disableAllFeatures).toHaveBeenCalledTimes(1);

    const no = await fetch(`${base}/api/admin/features/disable`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-email": "intruder@evil.dev" },
    });
    expect(no.status).toBe(403);
    expect(svc.disableAllFeatures).toHaveBeenCalledTimes(1); // never reached
  });
});