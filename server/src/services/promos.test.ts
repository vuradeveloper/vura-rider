// ─────────────────────────────────────────────────────────────────────────────
// promos v2 — contract tests for the per-rider validity + targeting rules.
//
// The invariants under test (each a line in the owner's ask):
//   • the discount maths never changes (applyPromoToFare is 012-exact);
//   • targeting: target_user_ids filters the list AND the booking lookup;
//   • N-rides budget: a rider at rides_used >= rides_limit can NEVER redeem
//     again (promoUsableFor), and each booking burns exactly one redemption;
//   • N-days window: the clock starts at the FIRST use (expires_at frozen via
//     COALESCE), and an expired redemption is refused;
//   • tracking is fire-and-forget: a failure can never block a booking.
// All DB access is stubbed; nothing here touches the network or a database.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", () => ({
  query: vi.fn(async () => [] as any[]),
  queryOne: vi.fn(async () => null as any),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));

import {
  activePromosForSide,
  applyPromoToFare,
  ensurePromoTables,
  parseTargetUserIds,
  promoUsableFor,
  recordPromoUse,
  ridePromoFor,
  type RidePromo,
} from "./promos";
import { execute, query, queryOne } from "../config/database";

const promo = (over: Partial<RidePromo> = {}): RidePromo => ({
  id: "11111111-1111-1111-1111-111111111111",
  code: "SAVE20",
  title: "Save 20",
  subtitle: null,
  audience: "rider",
  discount_pct: 20,
  discount_fixed: 0,
  valid_days: null,
  rides_limit: null,
  target_user_ids: null,
  ...over,
});

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(query).mockResolvedValue([] as any);
  vi.mocked(queryOne).mockResolvedValue(null as any);
  vi.mocked(execute).mockResolvedValue({ rowCount: 1, rows: [] } as any);
});

describe("applyPromoToFare — 012-exact maths (unchanged)", () => {
  it("percentage promos scale the fare and round to cents", () => {
    expect(applyPromoToFare(49.95, promo({ discount_pct: 20 }))).toEqual({
      fare: 39.96,
      discount: 9.99,
    });
  });

  it("fixed promos subtract Rands and never go below zero", () => {
    expect(applyPromoToFare(10, promo({ discount_pct: 0, discount_fixed: 15 }))).toEqual({
      fare: 0,
      discount: 10,
    });
  });
});

describe("parseTargetUserIds — the console's targeting payload", () => {
  it("keeps valid ids, dedupes, and treats empty as null (everyone)", () => {
    expect(parseTargetUserIds(null)).toBeNull();
    expect(parseTargetUserIds([])).toBeNull();
    expect(parseTargetUserIds([UUID_A, UUID_A, UUID_B])).toEqual([UUID_A, UUID_B]);
  });

  it("rejects anything that is not a uuid", () => {
    expect(() => parseTargetUserIds(["not-a-uuid"])).toThrow(/Invalid user id/);
    expect(() => parseTargetUserIds("oops")).toThrow(/array of user ids/);
  });
});

describe("activePromosForSide / ridePromoFor — targeting + per-user usable", () => {
  it("the list SQL joins redemptions and filters targeting", async () => {
    await activePromosForSide("rider", UUID_A);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("admin_promo_redemptions");
    expect(sql).toContain("target_user_ids IS NULL OR $2::uuid = ANY");
    expect(sql).toContain("rides_limit IS NULL OR COALESCE(r.rides_used, 0)");
    expect(params).toEqual(["rider", UUID_A]);
  });

  it("an empty id/code short-circuits without touching the database", async () => {
    expect(await ridePromoFor("rider", "  ")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("the lookup SQL carries window + audience + targeting for this user", async () => {
    await ridePromoFor("rider", "SAVE20", UUID_A);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.active = TRUE");
    expect(sql).toContain("p.audience IN ($1, 'both')");
    expect(sql).toContain("UPPER(p.code) = UPPER($3)");
    expect(params).toEqual(["rider", UUID_A, "SAVE20"]);
  });
});

describe("promoUsableFor — the N-rides / N-days gate", () => {
  it("promos with neither limit are always usable (012 behaviour)", async () => {
    expect(await promoUsableFor(promo(), UUID_A)).toBe(true);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("a targeted promo is unusable for anyone NOT in the list", async () => {
    expect(await promoUsableFor(promo({ target_user_ids: [UUID_B] }), UUID_A)).toBe(false);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("refuses once rides_used reaches rides_limit", async () => {
    vi.mocked(queryOne).mockResolvedValue({ rides_used: 3, expires_at: null });
    expect(await promoUsableFor(promo({ rides_limit: 3 }), UUID_A)).toBe(false);
    // one below → still usable
    vi.mocked(queryOne).mockResolvedValue({ rides_used: 2, expires_at: null });
    expect(await promoUsableFor(promo({ rides_limit: 3 }), UUID_A)).toBe(true);
  });

  it("refuses after the validity window that started at first use", async () => {
    vi.mocked(queryOne).mockResolvedValue({
      rides_used: 1,
      expires_at: new Date(Date.now() - 1000), // already past
    });
    expect(await promoUsableFor(promo({ valid_days: 7, rides_limit: 5 }), UUID_A)).toBe(false);
    vi.mocked(queryOne).mockResolvedValue({
      rides_used: 1,
      expires_at: new Date(Date.now() + 86_400_000),
    });
    expect(await promoUsableFor(promo({ valid_days: 7, rides_limit: 5 }), UUID_A)).toBe(true);
  });

  it("no redemption row yet = first use = allowed", async () => {
    vi.mocked(queryOne).mockResolvedValue(null);
    expect(await promoUsableFor(promo({ valid_days: 7, rides_limit: 2 }), UUID_A)).toBe(true);
  });
});

describe("recordPromoUse — burn one redemption", () => {
  const findInsert = () => {
    const call = vi
      .mocked(execute)
      .mock.calls.find(([sql]) => String(sql).includes("INSERT INTO admin_promo_redemptions"));
    expect(call).toBeTruthy();
    return call!;
  };

  it("does NOTHING for promos without limits (nothing to track)", async () => {
    await recordPromoUse(promo(), UUID_A);
    expect(execute).not.toHaveBeenCalled();
  });

  it("upserts with the N-days window stamped from FIRST use, counted per ride", async () => {
    await recordPromoUse(promo({ valid_days: 14, rides_limit: 3 }), UUID_A);
    const [sql, params] = findInsert();
    expect(sql).toContain("ON CONFLICT (promo_id, user_id) DO UPDATE");
    expect(sql).toContain("rides_used = admin_promo_redemptions.rides_used + 1");
    expect(sql).toContain("make_interval(days => $3::int)");
    expect(sql).toContain("COALESCE"); // first-use stamp is frozen, never restamped
    expect(params).toEqual([
      "11111111-1111-1111-1111-111111111111",
      UUID_A,
      14,
    ]);
  });

  it("rides-only promos (no window) keep expires_at NULL", async () => {
    await recordPromoUse(promo({ rides_limit: 5 }), UUID_A);
    const [, params] = findInsert();
    expect(params).toEqual([
      "11111111-1111-1111-1111-111111111111",
      UUID_A,
      null,
    ]);
  });

  it("a tracking failure is swallowed — it can never break a booking", async () => {
    vi.mocked(execute).mockRejectedValue(new Error("db down"));
    await expect(
      recordPromoUse(promo({ valid_days: 3 }), UUID_A)
    ).resolves.toBeUndefined();
  });
});

describe("ensurePromoTables — lazy 012+016 self-heal (same money-table pattern)", () => {
  it("creates the base table/index + rides.promo_* columns and v2 columns + ledger", async () => {
    await ensurePromoTables();
    const ddls = vi.mocked(execute).mock.calls.map(([sql]) => String(sql));
    expect(ddls.some((s) => s.includes("CREATE TABLE IF NOT EXISTS admin_promos"))).toBe(true);
    expect(ddls.some((s) => s.includes("idx_admin_promos_active"))).toBe(true);
    expect(ddls.some((s) => s.includes("ADD COLUMN IF NOT EXISTS promo_id"))).toBe(true);
    expect(ddls.some((s) => s.includes("ADD COLUMN IF NOT EXISTS valid_days"))).toBe(true);
    expect(ddls.some((s) => s.includes("ADD COLUMN IF NOT EXISTS rides_limit"))).toBe(true);
    expect(ddls.some((s) => s.includes("ADD COLUMN IF NOT EXISTS target_user_ids"))).toBe(true);
    expect(ddls.some((s) => s.includes("CREATE TABLE IF NOT EXISTS admin_promo_redemptions"))).toBe(true);
  });
});

