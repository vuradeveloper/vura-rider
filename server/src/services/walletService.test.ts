// ─────────────────────────────────────────────────────────────────────────────
// COMMISSION / WALLET LEDGER tests (spec §7):
//   1. the 10% split (VAT carved out of OUR commission, Paystack fee paid from
//      OUR commission, margin = remainder);
//   2. card ride  → pending credit, wallet untouched until the webhook;
//   3. cash ride  → commission debited immediately, wallet may go negative;
//   4. recovery   → a later card credit simply adds on top (negative clears);
//   5. the accept-time cash block boundary;
//   6. idempotency (duplicate completion / duplicate webhook) and reversals.
// The DB is faked in-memory with the SAME idempotency semantics as the real
// schema (UNIQUE (ride_id, type) + status guards) so behaviour — not SQL
// wording — is what's pinned.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

interface LedgerRow {
  id: string;
  driver_id: string;
  ride_id: string | null;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  status: string;
  paystack_fee_cents: number;
  vat_cents: number;
  margin_cents: number;
  commission_cents: number;
  ledger_ref_id: string | null;
  payout_id: string | null;
  note: string | null;
  created_at: string;
}
interface RideRow {
  id: string;
  driver_id: string;
  fare: number;
  method: string;
}

const state = {
  wallets: new Map<string, number>(),
  ledger: [] as LedgerRow[],
  earnings: new Map<string, { driver_id: string; gross: number; fee: number; net: number }>(),
  rides: new Map<string, RideRow>(),
  config: {} as Record<string, number>,
  seq: 0,
};

const nid = () => `w${++state.seq}`;
const rideOf = (id: string) => state.rides.get(id) ?? null;
const findRideEntry = (rideId: string, type: string) =>
  state.ledger.find((r) => r.ride_id === rideId && r.type === type) ?? null;
const pushRow = (r: Partial<LedgerRow>): LedgerRow => {
  const row: LedgerRow = {
    id: nid(),
    driver_id: r.driver_id!,
    ride_id: r.ride_id ?? null,
    type: r.type!,
    amount_cents: r.amount_cents ?? 0,
    balance_after_cents: r.balance_after_cents ?? 0,
    status: r.status ?? "posted",
    paystack_fee_cents: r.paystack_fee_cents ?? 0,
    vat_cents: r.vat_cents ?? 0,
    margin_cents: r.margin_cents ?? 0,
    commission_cents: r.commission_cents ?? 0,
    ledger_ref_id: r.ledger_ref_id ?? null,
    payout_id: r.payout_id ?? null,
    note: r.note ?? null,
    created_at: new Date(Date.now() + state.seq).toISOString(),
  };
  state.ledger.push(row);
  return row;
};
const delta = (driverId: string, cents: number): { balance_cents: number } => {
  const next = (state.wallets.get(driverId) ?? 0) + Math.round(cents);
  state.wallets.set(driverId, next);
  return { balance_cents: next };
};

vi.mock("../config/database", () => ({
  ensureDatabase: vi.fn(async () => { }),
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes("SELECT id, driver_id, amount_cents FROM wallet_ledger")) {
      return state.ledger
        .filter(
          (r) =>
            r.ride_id === params[0] &&
            r.status === "posted" &&
            ["card_credit", "commission_debit"].includes(r.type)
        )
        .map((r) => ({ id: r.id, driver_id: r.driver_id, amount_cents: r.amount_cents }));
    }
    if (sql.includes("ORDER BY created_at ASC") && sql.includes("status = 'completed'")) {
      return [...state.rides.values()]
        .filter((r) => r.driver_id === params[0])
        .map((r) => ({ id: r.id, fare: r.fare, method: r.method }));
    }
    if (sql.includes("FROM wallet_ledger wl")) {
      return state.ledger
        .filter((r) => r.driver_id === params[0] && r.status !== "void")
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 150)
        .map((r) => {
          const ride = r.ride_id ? rideOf(r.ride_id) : null;
          return {
            id: r.id, ride_id: r.ride_id, type: r.type, status: r.status,
            amount_cents: r.amount_cents, balance_after_cents: r.balance_after_cents,
            commission_cents: r.commission_cents,
            paystack_fee_cents: r.paystack_fee_cents, vat_cents: r.vat_cents,
            margin_cents: r.margin_cents,
            created_at: r.created_at,
            payment_method: ride ? ride.method : null,
            fare_rands: ride ? ride.fare : null,
          };
        });
    }
    return [];
  }),
  queryOne: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes("SELECT value FROM wallet_config")) return { value: state.config };
    if (sql.startsWith("UPDATE driver_wallets")) return delta(params[0], params[1]);
    if (sql.includes("SELECT balance_cents FROM driver_wallets"))
      return { balance_cents: state.wallets.get(params[0]) ?? 0 };
    if (sql.includes("SELECT id FROM driver_earnings")) return null;
    if (sql.includes("type = 'card_credit_pending' AND status = 'void'")) {
      return (
        state.ledger.find(
          (r) => r.ride_id === params[0] && r.type === "card_credit_pending" && r.status === "void"
        ) ?? null
      );
    }
    if (sql.includes("SELECT id FROM wallet_ledger WHERE ride_id = $1 AND type = $2"))
      return findRideEntry(params[0], params[1]);
    if (sql.includes("SELECT id FROM wallet_ledger WHERE ride_id = $1 AND type = 'card_credit'"))
      return findRideEntry(params[0], "card_credit");
    if (sql.includes("SELECT id FROM wallet_ledger WHERE payout_id"))
      return state.ledger.find((r) => r.payout_id === params[0] && r.type === "payout") ?? null;
    if (sql.includes("SELECT 1 AS one FROM wallet_ledger"))
      return state.ledger.some((r) => r.driver_id === params[0]) ? { one: 1 } : null;
    if (sql.includes("COALESCE(captured_amount, actual_fare, estimated_fare, 0)")) {
      const r = rideOf(params[0]);
      return r ? { fare: r.fare, driver_id: r.driver_id } : null;
    }
    if (sql.includes("SET status = 'posted'")) {
      const row = findRideEntry(params[0], "card_credit_pending");
      if (!row || row.status !== "pending") return null;
      row.status = "posted";
      row.type = "card_credit"; // promotion retypes (UNIQUE keeps it single)
      return { id: row.id, driver_id: row.driver_id, amount_cents: row.amount_cents };
    }
    if (sql.includes("ON CONFLICT (ride_id, type) DO NOTHING")) {
      if (sql.includes("ledger_ref_id")) {
        if (findRideEntry(params[1], "reversal")) return null; // one reversal per ride
        const rev = pushRow({
          driver_id: params[0], ride_id: params[1], type: "reversal",
          amount_cents: params[2], ledger_ref_id: params[3], note: params[4],
        });
        return { id: rev.id };
      }
      const catchUp = sql.includes("'card_credit', $3");
      const type = catchUp ? "card_credit" : params[2];
      if (findRideEntry(params[1], type)) return null; // UNIQUE (ride_id, type)
      const row = catchUp
        ? pushRow({
            driver_id: params[0], ride_id: params[1], type, amount_cents: params[2],
            status: "posted", paystack_fee_cents: params[3], vat_cents: params[4],
            margin_cents: params[5], commission_cents: params[6], note: params[7] ?? null,
          })
        : pushRow({
            driver_id: params[0], ride_id: params[1], type, amount_cents: params[3],
            status: params[4], paystack_fee_cents: params[5], vat_cents: params[6],
            margin_cents: params[7], commission_cents: params[8], note: params[9] ?? null,
          });
      return { id: row.id };
    }
    if (sql.includes("payout_id")) {
      if (state.ledger.some((r) => r.payout_id === params[2] && r.type === "payout")) return null;
      const row = pushRow({
        driver_id: params[0], type: "payout", amount_cents: params[1], payout_id: params[2],
        note: params[3] ?? null,
      });
      return { id: row.id };
    }
    return null;
  }),
  execute: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) return { rows: [] };
    if (sql.includes("INSERT INTO wallet_config")) {
      state.config = JSON.parse(params[0]);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO driver_wallets")) {
      if (!state.wallets.has(params[0])) state.wallets.set(params[0], 0);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO driver_earnings")) {
      state.earnings.set(params[1], { driver_id: params[0], gross: params[2], fee: params[3], net: params[4] });
      return { rows: [] };
    }
    if (sql.includes("SET balance_after_cents")) {
      const row = state.ledger.find((r) => r.id === params[0]);
      if (row) row.balance_after_cents = params[1];
      return { rows: [] };
    }
    if (sql.includes("SET status = 'void'")) {
      for (const r of state.ledger)
        if (r.ride_id === params[0] && r.type === "card_credit_pending" && r.status === "pending")
          r.status = "void";
      return { rows: [] };
    }
    if (sql.includes("SET paystack_fee_cents")) {
      const row = findRideEntry(params[0], "card_credit_pending");
      if (row && row.status === "pending") {
        row.paystack_fee_cents = params[1];
        row.margin_cents = row.commission_cents - row.vat_cents - params[1];
      }
      return { rows: [] };
    }
    return { rows: [] };
  }),
  withTransaction: vi.fn(async (fn: any) => fn({ query: async () => ({ rows: [] }) })),
}));

import {
  commissionSplit,
  cashRideBlocked,
  cashBlockThresholdCents,
  recordRideCompletion,
  confirmCardRideCredit,
  closeRideWalletEntries,
  recordPayoutDebit,
  getBalanceCents,
  getWalletConfig,
  getWalletView,
  DEFAULT_WALLET_CONFIG,
} from "./walletService";

const DRV = "drv-1";
const balance = () => state.wallets.get(DRV) ?? 0;

/** Seed a ride into the fake rides table (backfill/catch-up paths). */
function seedRide(id: string, fare: number, method: string, driver = DRV) {
  state.rides.set(id, { id, driver_id: driver, fare, method });
}

beforeEach(() => {
  state.wallets.clear();
  state.ledger = [];
  state.earnings.clear();
  state.rides.clear();
  state.config = {};
  state.seq = 0;
});

describe("commissionSplit — the 10% split (spec §2)", () => {
  const cfg = DEFAULT_WALLET_CONFIG;

  it("splits a R100 fare: commission 10%, VAT carved OUT of it, Paystack fee from it", () => {
    const s = commissionSplit(100, cfg);
    expect(s.fare_cents).toBe(10000);
    expect(s.commission_cents).toBe(1000); // 10% of R100
    expect(s.vat_cents).toBe(130); // 1000 × 15/115 (VAT-inclusive, part of OUR 10%)
    expect(s.paystack_fee_cents).toBe(150); // fallback 1.5% of fare
    expect(s.margin_cents).toBe(1000 - 130 - 150); // remainder to the platform
    expect(s.net_cents).toBe(9000); // driver earns R90
    // The driver's view is exactly ONE commission figure.
    expect(s.commission_cents).toBe(s.vat_cents + s.paystack_fee_cents + s.margin_cents);
  });

  it("uses Paystack's REAL fee from the webhook when provided", () => {
    const s = commissionSplit(100, cfg, 350); // R3.50 actual fee
    expect(s.paystack_fee_cents).toBe(350);
    expect(s.margin_cents).toBe(1000 - 130 - 350);
    expect(s.net_cents).toBe(9000); // the fee never touches the driver
  });

  it("handles a small fare without inventing money", () => {
    const s = commissionSplit(15, cfg); // R15 → commission R1.50
    expect(s.commission_cents).toBe(150);
    expect(s.net_cents).toBe(1350);
    expect(s.margin_cents).toBe(s.commission_cents - s.vat_cents - s.paystack_fee_cents);
  });
});

describe("card ride — pending until the Paystack webhook (spec §3)", () => {
  it("holds the credit as pending; the webhook releases it exactly once", async () => {
    seedRide("r1", 100, "card");
    await recordRideCompletion(DRV, "r1", 100, "card");

    const entry = findRideEntry("r1", "card_credit_pending");
    expect(entry?.status).toBe("pending");
    expect(entry?.amount_cents).toBe(9000);
    expect(balance()).toBe(0); // wallet untouched before capture confirmation

    await confirmCardRideCredit(DRV, "r1", 350);
    expect(findRideEntry("r1", "card_credit")?.status).toBe("posted");
    expect(balance()).toBe(9000);
    expect(findRideEntry("r1", "card_credit")?.paystack_fee_cents).toBe(350);

    await confirmCardRideCredit(DRV, "r1", 350); // duplicate webhook delivery
    expect(balance()).toBe(9000); // still exactly one credit
  });

  it("a repeated completion can't double-post either (UNIQUE ride+type)", async () => {
    seedRide("r1", 100, "card");
    await recordRideCompletion(DRV, "r1", 100, "card");
    await recordRideCompletion(DRV, "r1", 100, "card");
    expect(state.ledger.filter((r) => r.ride_id === "r1")).toHaveLength(1);
    expect(state.earnings.get("r1")).toEqual({ driver_id: DRV, gross: 100, fee: 10, net: 90 });
  });

  it("keeps driver_earnings truthful: fee = commission, net = fare − commission", async () => {
    seedRide("r2", 250, "card");
    await recordRideCompletion(DRV, "r2", 250, "card");
    expect(state.earnings.get("r2")).toEqual({ driver_id: DRV, gross: 250, fee: 25, net: 225 });
  });
});

describe("cash ride — commission debited immediately, wallet may go negative (§3)", () => {
  it("debits 10% at completion and lands below zero when the wallet was empty", async () => {
    seedRide("c1", 100, "cash");
    await recordRideCompletion(DRV, "c1", 100, "cash");
    expect(balance()).toBe(-1000); // −R10 commission, no webhook involved
    const e = findRideEntry("c1", "commission_debit");
    expect(e?.status).toBe("posted");
    expect(e?.amount_cents).toBe(-1000);
    expect(state.earnings.get("c1")).toEqual({ driver_id: DRV, gross: 100, fee: 10, net: 90 });

    // Another cash ride deepens the debt — the spec's intended behaviour.
    seedRide("c2", 250, "cash");
    await recordRideCompletion(DRV, "c2", 250, "cash");
    expect(balance()).toBe(-1000 - 2500); // −R35
  });

  it("recovers when a later card ride's credit lands (pure arithmetic)", async () => {
    seedRide("c1", 100, "cash");
    await recordRideCompletion(DRV, "c1", 100, "cash");
    expect(balance()).toBe(-1000);

    seedRide("k1", 200, "card");
    await recordRideCompletion(DRV, "k1", 200, "card");
    expect(balance()).toBe(-1000); // pending — still nothing until capture
    await confirmCardRideCredit(DRV, "k1", null);
    expect(balance()).toBe(-1000 + 18000); // R180 net clears the R10 debt → +R170
    expect(balance()).toBe(17000);
  });
});

describe("accept-time cash block (spec §4)", () => {
  it("blocks CASH only below the negative limit — at the limit it still allows", () => {
    const cfg = { ...DEFAULT_WALLET_CONFIG, negative_limit_rand: 200 };
    expect(cashBlockThresholdCents(cfg)).toBe(-20000);
    expect(cashRideBlocked(5000, cfg)).toBe(false); // positive
    expect(cashRideBlocked(0, cfg)).toBe(false);
    expect(cashRideBlocked(-19999, cfg)).toBe(false); // not BELOW the limit yet
    expect(cashRideBlocked(-20000, cfg)).toBe(false); // exactly at the limit
    expect(cashRideBlocked(-20001, cfg)).toBe(true); // below → cash rides refused
  });

  it("a driver deep in debt can still take card rides to recover", async () => {
    const cfg = { ...DEFAULT_WALLET_CONFIG, negative_limit_rand: 20 };
    // −R30 balance vs a R20 limit → cash blocked…
    seedRide("c1", 100, "cash");
    await recordRideCompletion(DRV, "c1", 100, "cash"); // −R10
    seedRide("c2", 100, "cash");
    await recordRideCompletion(DRV, "c1b", 100, "cash"); // −R20
    seedRide("c3", 100, "cash");
    await recordRideCompletion(DRV, "c3", 100, "cash"); // −R30
    expect(cashRideBlocked(balance(), cfg)).toBe(true);

    // Card ride stays allowed and clears the debt on webhook confirmation.
    seedRide("k1", 100, "card");
    await recordRideCompletion(DRV, "k1", 100, "card");
    await confirmCardRideCredit(DRV, "k1", null); // +R90
    expect(balance()).toBe(-3000 + 9000);
    expect(cashRideBlocked(balance(), cfg)).toBe(false);
  });
});

describe("reversals, payouts, voids — append-only audit (§3)", () => {
  it("reverses a posted cash commission ONCE when the ride ends without completing", async () => {
    seedRide("c1", 100, "cash");
    await recordRideCompletion(DRV, "c1", 100, "cash");
    expect(balance()).toBe(-1000);

    await closeRideWalletEntries("c1", "rider_cancelled");
    expect(balance()).toBe(0); // commission refunded to the driver
    expect(findRideEntry("c1", "reversal")?.amount_cents).toBe(1000);

    await closeRideWalletEntries("c1", "rider_cancelled"); // replayed cancel
    expect(balance()).toBe(0); // still one reversal only
  });

  it("reverses a webhook-posted card credit when a refund lands later", async () => {
    seedRide("k1", 100, "card");
    await recordRideCompletion(DRV, "k1", 100, "card");
    await confirmCardRideCredit(DRV, "k1", null);
    expect(balance()).toBe(9000);

    await closeRideWalletEntries("k1", "rider_refunded");
    expect(balance()).toBe(0);
    expect(findRideEntry("k1", "reversal")?.amount_cents).toBe(-9000);
    expect(findRideEntry("k1", "reversal")?.ledger_ref_id).toBe(findRideEntry("k1", "card_credit")?.id);
  });

  it("voids a pending card credit on cancel — the balance never moved", async () => {
    seedRide("k1", 100, "card");
    await recordRideCompletion(DRV, "k1", 100, "card"); // pending only
    await closeRideWalletEntries("k1", "rider_cancelled");
    expect(findRideEntry("k1", "card_credit_pending")?.status).toBe("void");
    expect(balance()).toBe(0);
    // A late confirm after the void must not resurrect the credit.
    await confirmCardRideCredit(DRV, "k1", null);
    expect(balance()).toBe(0);
  });

  it("debits the wallet exactly once per successful payout", async () => {
    seedRide("k1", 100, "card");
    await recordRideCompletion(DRV, "k1", 100, "card");
    await confirmCardRideCredit(DRV, "k1", null); // +R90
    await recordPayoutDebit(DRV, "pay-1", 50); // cash out R50
    expect(balance()).toBe(9000 - 5000);
    await recordPayoutDebit(DRV, "pay-1", 50); // retried success
    expect(await getBalanceCents(DRV)).toBe(4000); // still a single debit
  });
});

describe("wallet view + config (spec §5–§6)", () => {
  it("reports the balance plainly, including money owed, with ride history", async () => {
    seedRide("c1", 100, "cash");
    await recordRideCompletion(DRV, "c1", 100, "cash");
    const view = await getWalletView(DRV);
    expect(view.balance_cents).toBe(-1000);
    expect(view.commission_pct).toBe(10);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({
      ride_id: "c1",
      type: "commission_debit",
      payment_method: "cash",
      amount_cents: -1000,
      commission_cents: 1000,
    });
  });

  it("reads defaults, validates bounds, and persists what the console tunes", async () => {
    expect(await getWalletConfig()).toEqual(DEFAULT_WALLET_CONFIG);
    const { putWalletConfig } = await import("./walletService");
    const next = await putWalletConfig({ commission_pct: 12, negative_limit_rand: 150 });
    expect(next.commission_pct).toBe(12);
    expect(next.negative_limit_rand).toBe(150);
    expect((await getWalletConfig()).commission_pct).toBe(12);
    await expect(putWalletConfig({ commission_pct: 999 })).rejects.toThrow(/between/);
    await expect(putWalletConfig({ bogus: 1 } as any)).rejects.toThrow(/Unknown/);
  });
});




