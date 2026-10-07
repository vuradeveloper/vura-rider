// ─────────────────────────────────────────────────────────────────────────────
// NOTIFY: the honest return contract offer-dispatch safety depends on.
//
// sendPushToUsers must answer exactly three ways:
//   number > 0 — PROVEN delivered to N devices
//   0          — PROVEN nothing exists/accepted (successful lookups + transport
//                answers, empty token set included) — skip-eligible downstream
//   null       — UNKNOWN (lookup/transport failed) — never skip-eligible
// This file pins that contract; dispatch.delivery.test.ts pins the skip side.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fcmMock, expoMock } = vi.hoisted(() => ({
  fcmMock: vi.fn(),
  expoMock: vi.fn(),
}));

vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("../config/firebase", () => ({
  getFirebaseApp: () => ({ messaging: () => ({ sendEachForMulticast: fcmMock }) }),
}));
vi.mock("./push", () => ({ sendPushToUser: expoMock }));

import { sendPushToUsers } from "./notify";
import { db, resetHarness } from "./testHarness";

type Row = Record<string, unknown>;

/** Route the two lookups notify issues: users first, then device_tokens. */
function setLookups(users: Row[], tokens: Row[]): void {
  db.query.mockImplementation(async (sql: string) =>
    String(sql).includes("device_tokens") ? (tokens as any) : (users as any)
  );
}

beforeEach(() => {
  resetHarness();
  fcmMock.mockReset();
  expoMock.mockReset();
});

describe("sendPushToUsers return contract", () => {
  it("returns a PROVEN 0 when the lookups succeed and nothing exists to send to", async () => {
    setLookups([{ id: "u1", firebase_uid: null }], []); // no tokens, no Expo uid

    const n = await sendPushToUsers(["u1"], { type: "ride_offer", title: "t", body: "b" });

    expect(n).toBe(0); // proven — dispatch may skip on exactly this
    expect(fcmMock).not.toHaveBeenCalled();
    expect(expoMock).not.toHaveBeenCalled();
  });

  it("returns null (UNKNOWN) when the token lookup fails — not a fake 0", async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("device_tokens")) throw new Error("db down");
      return [{ id: "u1", firebase_uid: null }] as any;
    });

    const n = await sendPushToUsers(["u1"], { type: "ride_offer", title: "t", body: "b" });

    expect(n).toBeNull(); // a DB hiccup must never look like "no tokens"
  });

  it("returns null (UNKNOWN) when the FCM transport rejects", async () => {
    setLookups([], [{ id: "t1", user_id: "u1", push_token: "tok", platform: "android" }]);
    fcmMock.mockRejectedValue(new Error("firebase unreachable"));

    const n = await sendPushToUsers(["u1"], { type: "ride_offer", title: "t", body: "b" });

    expect(n).toBeNull();
  });

  it("returns the PROVEN count when FCM accepts the batch", async () => {
    setLookups([], [{ id: "t1", user_id: "u1", push_token: "tok", platform: "android" }]);
    fcmMock.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] });

    const n = await sendPushToUsers(["u1"], { type: "ride_offer", title: "t", body: "b" });

    expect(n).toBe(1);
  });

  it("returns a PROVEN 0 when FCM answers the batch and every token failed", async () => {
    setLookups([], [{ id: "t1", user_id: "u1", push_token: "tok", platform: "android" }]);
    fcmMock.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: "messaging/internal-error" } }],
    });

    const n = await sendPushToUsers(["u1"], { type: "ride_offer", title: "t", body: "b" });

    expect(n).toBe(0); // an answered 0 is proven — internal-error is not a dead token
  });

  it("returns null (UNKNOWN) when the Expo transport rejects", async () => {
    setLookups([{ id: "u1", firebase_uid: "fb-uid" }], []); // no FCM tokens, Expo path only
    expoMock.mockRejectedValue(new Error("expo down"));

    const n = await sendPushToUsers(["u1"], { type: "ride_offer", title: "t", body: "b" });

    expect(n).toBeNull();
  });

  it("returns a PROVEN 0 when the Expo transport answers 0", async () => {
    setLookups([{ id: "u1", firebase_uid: "fb-uid" }], []);
    expoMock.mockResolvedValue(0);

    const n = await sendPushToUsers(["u1"], { type: "ride_offer", title: "t", body: "b" });

    expect(n).toBe(0);
  });
});
