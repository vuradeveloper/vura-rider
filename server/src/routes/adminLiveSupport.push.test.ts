// ─────────────────────────────────────────────────────────────────────────────
// LIVE SUPPORT — AGENT REPLY PUSH
//
// The chat only polls while the screen is open. A public agent reply therefore
// has to reach the phone through FCM when the app is backgrounded or closed.
// These tests pin the exact contract:
//   • a public reply pushes to the chat's rider/driver id;
//   • an internal note never leaves the console (no push);
//   • a push failure is best-effort and never turns the saved reply into an
//     error response.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const RIDER_ID = "22222222-2222-4222-8222-222222222222";

const svc = vi.hoisted(() => ({
  requireAdmin: () => (_req: any, _res: any, next: any) => next(),
  resolveAdminActor: vi.fn(async () => ({ email: "ops@vura.test" })),
  writeAudit: vi.fn(async () => undefined),
  getLiveChat: vi.fn(async () => null),
  listLiveChats: vi.fn(async () => ({ rows: [], total: 0 })),
  sendAdminMessage: vi.fn(async () => ({ id: CHAT_ID, rider_id: RIDER_ID })),
  updateLiveChat: vi.fn(async () => null),
}));
const push = vi.hoisted(() => ({ sendPushToUsers: vi.fn(async () => 1) }));

vi.mock("../services/adminAuth", () => ({
  requireAdmin: svc.requireAdmin,
  resolveAdminActor: svc.resolveAdminActor,
  writeAudit: svc.writeAudit,
}));
vi.mock("../services/liveSupport", () => ({
  getLiveChat: svc.getLiveChat,
  listLiveChats: svc.listLiveChats,
  sendAdminMessage: svc.sendAdminMessage,
  updateLiveChat: svc.updateLiveChat,
}));
vi.mock("../services/notify", () => push);

import adminLiveSupportRouter from "./adminLiveSupport";

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const app = express();
  app.use(express.json());
  app.use("/api/admin/v2/live-chats", adminLiveSupportRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function reply(body: Record<string, unknown>) {
  return fetch(`${base}/api/admin/v2/live-chats/${CHAT_ID}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("live-support agent reply push", () => {
  it("a public reply pushes to the chat owner with the live_support payload", async () => {
    const res = await reply({ message: "We are on it" });
    expect(res.status).toBe(200);
    expect(push.sendPushToUsers).toHaveBeenCalledTimes(1);
    expect(push.sendPushToUsers).toHaveBeenCalledWith(
      [RIDER_ID],
      expect.objectContaining({
        type: "live_support",
        title: "Vura support replied",
        channelId: "ride_updates",
        data: { kind: "live_support", chat_id: CHAT_ID },
      })
    );
    const [, msg] = push.sendPushToUsers.mock.calls[0] as any[];
    expect(msg.body).toContain("We are on it");
  });

  it("an internal note never pushes", async () => {
    const res = await reply({ message: "card disputed, check docs", is_internal: true });
    expect(res.status).toBe(200);
    expect(push.sendPushToUsers).not.toHaveBeenCalled();
  });

  it("a push failure is best-effort: the reply still returns 200", async () => {
    push.sendPushToUsers.mockRejectedValueOnce(new Error("FCM unavailable"));
    const res = await reply({ message: "Reply that must still save" });
    expect(res.status).toBe(200);
    expect(push.sendPushToUsers).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing message before any push", async () => {
    const res = await reply({ message: "   " });
    expect(res.status).toBe(400);
    expect(push.sendPushToUsers).not.toHaveBeenCalled();
  });
});
