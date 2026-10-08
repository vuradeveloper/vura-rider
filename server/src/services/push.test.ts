// ─────────────────────────────────────────────────────────────────────────────
// PUSH (Expo sender): positional response pairing + honest logging.
//
// The Expo push API answers with ONE entry per submitted message, in order.
// `details.error` is an error CODE (e.g. "DeviceNotRegistered"), never a
// token — pruning must pair data[i] with messages[i]. A non-OK HTTP response
// must be logged as an error, not fall through silently.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", async () => (await import("./testHarness")).db);

import { sendPushToUser } from "./push";
import { db, resetHarness } from "./testHarness";

const fetchMock = vi.fn();

/** push.ts issues exactly one lookup: push_tokens for the firebase uid. */
function setTokens(tokens: string[]): void {
  db.query.mockImplementation(async (sql: string) =>
    String(sql).includes("push_tokens") ? (tokens.map((t) => ({ token: t })) as any) : []
  );
}

const pushLogInserts = () =>
  db.execute.mock.calls.filter((c: any[]) => String(c[0]).includes("INSERT INTO push_sends"));
const tokenDeletes = () =>
  db.execute.mock.calls.filter((c: any[]) => String(c[0]).includes("DELETE FROM push_tokens"));

beforeEach(() => {
  resetHarness();
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

describe("sendPushToUser (Expo)", () => {
  it("pairs DeviceNotRegistered by INDEX and prunes exactly that token", async () => {
    setTokens(["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { status: "error", details: { error: "DeviceNotRegistered" } },
          { status: "ok" },
        ],
      }),
    });

    const n = await sendPushToUser("fb-uid", { title: "t", body: "b", data: { ride_id: "r1" } });

    expect(n).toBe(1); // the second token was delivered
    const deletes = tokenDeletes();
    expect(deletes).toHaveLength(1);
    // The FIRST token (index 0) is the dead one — data[0] answers messages[0].
    expect(deletes[0][1]).toEqual(["fb-uid", "ExponentPushToken[aaa]"]);
  });

  it("does NOT prune on other error codes (index pairing, non-DeviceNotRegistered)", async () => {
    setTokens(["ExponentPushToken[aaa]"]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: "error", details: { error: "MessageTooBig" } }],
      }),
    });

    const n = await sendPushToUser("fb-uid", { title: "t", body: "b" });

    expect(n).toBe(0);
    expect(tokenDeletes()).toHaveLength(0); // a delivery error is not an uninstalled device
  });

  it("logs a non-OK HTTP response as an error instead of falling through silently", async () => {
    setTokens(["ExponentPushToken[aaa]"]);
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const n = await sendPushToUser("fb-uid", { title: "t", body: "b", data: { ride_id: "r1" } });

    expect(n).toBe(0);
    const inserts = pushLogInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][2]).toBe("error"); // result column
    expect(String(inserts[0][1][3])).toContain("HTTP 401");
    expect(tokenDeletes()).toHaveLength(0);
  });

  it("counts and logs an all-ok batch", async () => {
    setTokens(["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: "ok" }, { status: "ok" }] }),
    });

    const n = await sendPushToUser("fb-uid", { title: "t", body: "b" });

    expect(n).toBe(2);
    const inserts = pushLogInserts();
    expect(inserts[inserts.length - 1][1][2]).toBe("sent");
    expect(tokenDeletes()).toHaveLength(0);
  });

  it("answers 0 with a 'none' log when the user has no Expo tokens", async () => {
    setTokens([]);

    const n = await sendPushToUser("fb-uid", { title: "t", body: "b" });

    expect(n).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const inserts = pushLogInserts();
    expect(inserts[inserts.length - 1][1][2]).toBe("none");
  });
});
