// ─────────────────────────────────────────────────────────────────────────────
// INVITE & EARN — service contract tests (the R5 referral reward).
// Invariants under test, each a line in the owner's ask:
//   • the inviter gets R5 when the invited rider completes their FIRST ride
//     (settleFirstRide: pending → settled, once per ride, window-checked);
//   • the R5 is DISCOUNTABLE on one of the inviter's OWN trip if they choose:
//     min(balance, fare), balance never negative, one spend per ride, and a
//     failed debit must never leave free money out (fare is restored).
// All DB access is stubbed; nothing here touches the network or a database.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  connect: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
}));

vi.mock("../config/database", () => ({
  default: () => ({ connect: hoisted.connect }),
  query: (...a: any[]) => hoisted.query(...a),
  queryOne: (...a: any[]) => hoisted.queryOne(...a),
  execute: (...a: any[]) => hoisted.execute(...a),
}));

import {
  REFERRAL_REWARD,
  inviteCreditForFare,
  inviteCreditAvailable,
  spendInviteCredit,
  settleFirstRide,
} from "./AffiliateService";

const AFF = { id: "aff-1", user_id: "u-inviter", referral_code: "VURA-TEST-AAAA", balance: "5.00", status: "active" };

function mockClient(results: Array<{ rowCount?: number; rows?: any[] }>) {
  const client = {
    query: vi.fn(async (sql: string) => {
      const s = String(sql);
      // Transaction control gets no queued result — only UPDATE/INSERT consume.
      if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [] };
      return results.shift() ?? { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  hoisted.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inviteCreditForFare — the R5 comes off a trip the rider chooses", () => {
  it("caps the discount at the balance AND at the fare", () => {
    expect(inviteCreditForFare(5, 12.5)).toBe(5);
    expect(inviteCreditForFare(50, 12.5)).toBe(12.5);
    expect(inviteCreditForFare(3.2, 3.1)).toBeCloseTo(3.1);
  });
  it("never pays out from an empty/invalid balance or fare", () => {
    expect(inviteCreditForFare(0, 20)).toBe(0);
    expect(inviteCreditForFare(-5, 20)).toBe(0);
    expect(inviteCreditForFare(5, 0)).toBe(0);
    expect(inviteCreditForFare(NaN, 20)).toBe(0);
  });
});

describe("inviteCreditAvailable — booking pre-check", () => {
  it("returns min(balance, fare) for an active affiliate", async () => {
    hoisted.queryOne.mockResolvedValueOnce({ ...AFF });
    expect(await inviteCreditAvailable("u-inviter", 12.5)).toBe(5);
  });
  it("returns 0 with no affiliate row / inactive / db error", async () => {
    hoisted.queryOne.mockResolvedValueOnce(null);
    expect(await inviteCreditAvailable("u-nobody", 12.5)).toBe(0);
    hoisted.queryOne.mockResolvedValueOnce({ ...AFF, status: "paused" });
    expect(await inviteCreditAvailable("u-inviter", 12.5)).toBe(0);
    hoisted.queryOne.mockRejectedValueOnce(new Error("db down"));
    expect(await inviteCreditAvailable("u-inviter", 12.5)).toBe(0);
  });
});

describe("spendInviteCredit — debit + record, never negative, once per ride", () => {
  it("debits the balance and records credit_used, then commits", async () => {
    hoisted.queryOne.mockResolvedValue({ ...AFF });
    const client = mockClient([
      { rowCount: 1, rows: [{ balance: "0.00" }] }, // UPDATE guarded
      { rowCount: 1, rows: [{ id: "tx-1" }] }, //     INSERT recorded
    ]);
    expect(await spendInviteCredit("u-inviter", "ride-1", 5)).toBe(true);
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.some((s) => s.includes("balance >= $1"))).toBe(true);
    expect(sqls.some((s) => s.includes("credit_used"))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });
  it("rolls back and returns false when the balance cannot cover it (raced away)", async () => {
    hoisted.queryOne.mockResolvedValue({ ...AFF });
    const client = mockClient([{ rowCount: 0, rows: [] }]);
    expect(await spendInviteCredit("u-inviter", "ride-1", 5)).toBe(false);
    expect(client.query.mock.calls.some((c) => String(c[0]) === "ROLLBACK")).toBe(true);
    expect(client.query.mock.calls.some((c) => String(c[0]).includes("credit_used"))).toBe(false);
  });
  it("rolls back on a duplicate ride spend (idempotent per ride)", async () => {
    hoisted.queryOne.mockResolvedValue({ ...AFF });
    const client = mockClient([
      { rowCount: 1, rows: [{ balance: "0.00" }] },
      { rowCount: 0, rows: [] }, // ON CONFLICT DO NOTHING → already recorded
    ]);
    expect(await spendInviteCredit("u-inviter", "ride-1", 5)).toBe(false);
    expect(client.query.mock.calls.some((c) => String(c[0]) === "ROLLBACK")).toBe(true);
  });
  it("never opens a transaction without an affiliate or for a non-positive amount", async () => {
    hoisted.queryOne.mockResolvedValueOnce(null);
    expect(await spendInviteCredit("u-nobody", "ride-1", 5)).toBe(false);
    expect(hoisted.connect).not.toHaveBeenCalled();
    expect(await spendInviteCredit("u-inviter", "ride-1", 0)).toBe(false);
    expect(hoisted.connect).not.toHaveBeenCalled();
  });
});

describe("settleFirstRide — the invitee's FIRST ride pays the inviter R5", () => {
  const rideRow = { id: "ride-1", passenger_id: "u-invitee" };
  const pendingReferral = {
    id: "ref-1",
    affiliate_id: "aff-1",
    created_at: new Date().toISOString(),
    status: "pending",
  };

  it("credits R5 exactly once and settles the referral", async () => {
    hoisted.queryOne.mockResolvedValueOnce(rideRow).mockResolvedValueOnce(pendingReferral);
    const client = mockClient([{ rowCount: 1, rows: [{ id: "tx-1" }] }]);
    await settleFirstRide("ride-1");
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("signup_bonus"))).toBe(true);
    expect(sqls.some((s) => s.includes("balance = balance + $1"))).toBe(true);
    expect(sqls.some((s) => s.includes("status = 'settled'"))).toBe(true);
    const insertParams = client.query.mock.calls.find((c) => String(c[0]).includes("signup_bonus"))?.[1];
    expect(insertParams?.[1]).toBe(REFERRAL_REWARD);
  });
  it("is a no-op when nothing is pending (re-fire-safe)", async () => {
    hoisted.queryOne.mockResolvedValueOnce(rideRow).mockResolvedValueOnce(null);
    await settleFirstRide("ride-1");
    expect(hoisted.connect).not.toHaveBeenCalled();
  });
  it("laps a referral older than the 90-day window instead of paying", async () => {
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    hoisted.queryOne.mockResolvedValueOnce(rideRow).mockResolvedValueOnce({ ...pendingReferral, created_at: old });
    await settleFirstRide("ride-1");
    expect(hoisted.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'lapsed'"),
      [pendingReferral.id]
    );
    expect(hoisted.connect).not.toHaveBeenCalled();
  });
});
