// ─────────────────────────────────────────────────────────────────────────────
// RIDE NOW, PAY LATER — service contract tests (v1 → Paystack upgrade).
//
// The invariants under test, each one a line in the brief:
//   • every number is env-configurable (payLaterConfig / computeCreditLimit);
//   • unlock counts completed PAID rides on the SAME card (provenance +
//     grandfather + anti-farm pair guard), never raw ride count;
//   • the LEDGER is the truth — pending/failed credits never reduce the
//     balance; only webhook confirmation does (confirmRepaymentReference is
//     idempotent: replay = no-op);
//   • booking a pay-later ride requires active + terms + NOT past due + the
//     fare fitting available credit;
//   • auto-debit requires explicit consent (opt-in) and a saved card;
//   • completion books exactly ONE debit per ride and is safe to re-fire;
//   • the collection worker only charges consented riders, logs every attempt
//     to payment_collections, and blocks on an in-flight repayment.
// All DB access is stubbed; nothing here touches the network or a database.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  connect: vi.fn(),
}));

vi.mock("../config/database", () => ({
  default: () => ({ connect: hoisted.connect }),
  query: vi.fn(async () => [] as any[]),
  queryOne: vi.fn(async () => null as any),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] as any[] })),
}));

vi.mock("./notify", () => ({
  sendPushToUsers: vi.fn(async () => 1),
}));

vi.mock("./preauthorization", () => ({
  recordWebhookEventOnce: vi.fn(async () => true),
}));

vi.mock("./paystackPayment", () => ({
  paymentsMode: vi.fn(() => "sandbox" as const),
  getDefaultCardToken: vi.fn(async () => null as any),
  chargeAuthorization: vi.fn(async () => ({ success: true })),
}));

import {
  payLaterConfig,
  computeCreditLimit,
  countUnlockRides,
  ledgerOutstanding,
  hasPastDueDebit,
  getPayLaterEligibility,
  acceptPayLaterTerms,
  takePayLaterRide,
  enrollPayLater,
  setPayLaterAutoDebit,
  confirmRepaymentReference,
  markRepaymentFailed,
  handlePayLaterChargeWebhook,
  registerPayLaterDebit,
  onRideCompletedPayLater,
  runMonthlyCollection,
} from "./PayLaterService";
import { query, queryOne, execute } from "../config/database";
import { paymentsMode, getDefaultCardToken, chargeAuthorization } from "./paystackPayment";
import { recordWebhookEventOnce } from "./preauthorization";
import { sendPushToUsers } from "./notify";

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("PAY_LATER_") || k.startsWith("PAYMENTS_")) delete process.env[k];
  }
  process.env.PAYMENTS_MODE = "sandbox";
  vi.mocked(paymentsMode).mockReturnValue("sandbox");
  vi.mocked(getDefaultCardToken).mockResolvedValue(null as any);
  vi.mocked(chargeAuthorization).mockResolvedValue({ success: true } as any);
  vi.mocked(recordWebhookEventOnce).mockResolvedValue(true as any);
  vi.mocked(query).mockResolvedValue([] as any);
  vi.mocked(queryOne).mockResolvedValue(null as any);
  vi.mocked(execute).mockResolvedValue({ rowCount: 1, rows: [] } as any);
  hoisted.connect.mockReset();
});

afterEach(() => {
  process.env = savedEnv;
  vi.clearAllMocks();
});

// ── SQL scripting helpers ─────────────────────────────────────────────────────

type SqlResult = { rows?: any[]; rowCount?: number };

/** queryOne/query implementation that dispatches on SQL fragments, first match
 *  wins, ordered — so each test scripts only the rows it cares about. */
function sqlMock(map: Array<[string, SqlResult]>, fallback: SqlResult = {}) {
  return vi.fn(async (sql: string) => {
    for (const [pat, res] of map) {
      if (sql.includes(pat)) return res.rows ?? [];
    }
    return fallback.rows ?? [];
  });
}
function oneMock(map: Array<[string, any]>, fallback: any = null) {
  return vi.fn(async (sql: string) => {
    for (const [pat, res] of map) {
      if (sql.includes(pat)) return res;
    }
    return fallback;
  });
}

/** Pool client whose query() answers by SQL fragment (for tx functions). */
function scriptClient(map: Array<[string, SqlResult]>) {
  const q = vi.fn(async (sql: string) => {
    for (const [pat, res] of map) {
      if (sql.includes(pat)) {
        const rows = res.rows ?? [];
        return { rows, rowCount: res.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  });
  return { query: q, release: vi.fn() };
}

const ACTIVE_ACCOUNT = {
  user_id: "rider-1",
  status: "active",
  credit_limit: 100,
  outstanding: 0,
  card_token: "AUTH_card1",
  identity_fingerprint: "fp-1",
  terms_accepted_at: new Date("2026-01-15T10:00:00Z"),
  auto_debit_enabled: false,
  auto_debit_consent_at: null,
  repay_ride_count: 0,
  email: "rider@vura.com",
  phone: "+27123",
};

// ── Configuration ─────────────────────────────────────────────────────────────

describe("payLaterConfig — every brief number is env-configurable", () => {
  it("reads the PAY_LATER_* knobs", () => {
    process.env.PAY_LATER_RIDES_TO_UNLOCK = "7";
    process.env.PAY_LATER_CREDIT_LIMIT_R = "250";
    process.env.PAY_LATER_LIMIT_STEP_R = "75";
    process.env.PAY_LATER_RIDES_PER_STEP = "4";
    process.env.PAY_LATER_CAP_R = "900";
    process.env.PAY_LATER_RIDES_TO_REPAY = "6";
    process.env.PAY_LATER_REPAY_PER_RIDE_R = "15";
    process.env.PAY_LATER_RETRY_DAYS = "2,5";
    process.env.PAY_LATER_AUTO_DEBIT_THRESHOLD_R = "80";
    process.env.PAY_LATER_WORKER_INTERVAL_MS = "120000";
    const cfg = payLaterConfig();
    expect(cfg).toEqual({
      ridesToUnlock: 7,
      creditLimitR: 250,
      limitStepR: 75,
      ridesPerStep: 4,
      capR: 900,
      ridesToRepay: 6,
      repayPerRideR: 15,
      retryDays: [2, 5],
      autoDebitThresholdR: 80,
      workerIntervalMs: 120000,
    });
  });

  it("falls back to defaults on garbage and clamps the worker interval", () => {
    process.env.PAY_LATER_RIDES_TO_UNLOCK = "many";
    process.env.PAY_LATER_CREDIT_LIMIT_R = "-5";
    process.env.PAY_LATER_RETRY_DAYS = "x,,0";
    process.env.PAY_LATER_WORKER_INTERVAL_MS = "1"; // below the 60s floor
    const cfg = payLaterConfig();
    expect(cfg.ridesToUnlock).toBe(5);
    expect(cfg.creditLimitR).toBe(100);
    expect(cfg.retryDays).toEqual([1, 3, 7]); // unparseable → built-in schedule
    expect(cfg.workerIntervalMs).toBe(6 * 60 * 60 * 1000); // below floor → 6h default
  });
});

describe("computeCreditLimit — ladder from the brief", () => {
  it("is 0 until unlock, then +step per ridesPerStep, capped", () => {
    process.env.PAY_LATER_RIDES_TO_UNLOCK = "5";
    process.env.PAY_LATER_CREDIT_LIMIT_R = "100";
    process.env.PAY_LATER_LIMIT_STEP_R = "50";
    process.env.PAY_LATER_RIDES_PER_STEP = "10";
    process.env.PAY_LATER_CAP_R = "1000";
    expect(computeCreditLimit(0)).toBe(0);
    expect(computeCreditLimit(4)).toBe(0); // one ride short
    expect(computeCreditLimit(5)).toBe(100); // step 0 = flat limit
    expect(computeCreditLimit(14)).toBe(100); // 10 rides per step
    expect(computeCreditLimit(15)).toBe(150);
    expect(computeCreditLimit(1_000_000)).toBe(1000); // cap
  });
});

// ── Eligibility counting (same card, anti-farm) ───────────────────────────────

describe("countUnlockRides — completed PAID rides on the SAME card", () => {
  it("passes the card transaction_index as provenance + keeps the anti-farm guard", async () => {
    vi.mocked(getDefaultCardToken).mockResolvedValue({
      transaction_index: "IDX-99",
      last4: "4242",
    } as any);
    vi.mocked(queryOne).mockImplementation(
      oneMock([["SELECT COUNT(*)::text AS total", { total: "5" }]])
    );
    expect(await countUnlockRides("rider-1")).toBe(5);
    const [sql, params] = vi.mocked(queryOne).mock.calls[0];
    expect(sql).toContain("r.card_auth_code = $2"); // provenance match
    expect(sql).toContain("HAVING COUNT(*) >= 5"); // anti ride-farming pair guard
    expect(params).toEqual(["rider-1", "IDX-99"]);
  });

  it("returns 0 when the count query finds nothing", async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any);
    expect(await countUnlockRides("rider-1")).toBe(0);
  });
});

// ── Ledger math ───────────────────────────────────────────────────────────────

describe("ledgerOutstanding / hasPastDueDebit", () => {
  it("subtracts ONLY confirmed credits (pending/failed never reduce the balance)", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([["FROM pay_later_ledger", { total: "62.5" }]])
    );
    expect(await ledgerOutstanding("rider-1")).toBe(62.5);
    const sql = vi.mocked(queryOne).mock.calls[0][0];
    expect(sql).toContain("status = 'confirmed' THEN amount"); // only confirmed
    expect(sql).toContain("ELSE 0 END"); // pending/failed → no reduction
  });

  it("detects a past-due OPEN debit (the booking-block trigger)", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([["due_at < NOW()", { id: "ledger-1" }]])
    );
    expect(await hasPastDueDebit("rider-1")).toBe(true);
  });

  it("is false when no debit is past due", async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any);
    expect(await hasPastDueDebit("rider-1")).toBe(false);
  });
});

// ── Take-a-ride preflight (mirrors the socket booking guard) ──────────────────

describe("takePayLaterRide — active → terms → not past due → fits credit", () => {
  const acct = (over: any = {}) => ({ ...ACTIVE_ACCOUNT, ...over });

  it("rejects when the rider has no active account", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([["FROM pay_later_accounts a", null]])
    );
    await expect(takePayLaterRide("rider-1", 40)).rejects.toThrow(
      "not active on your account"
    );
  });

  it("rejects when terms were never accepted", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([["FROM pay_later_accounts a", acct({ terms_accepted_at: null })]])
    );
    await expect(takePayLaterRide("rider-1", 40)).rejects.toThrow(
      "accept the Pay Later terms"
    );
  });

  it("rejects when a balance is past its due date (with the amount owed)", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", acct()],
        // NOTE: the SUM(amount…) pattern must come BEFORE "due_at < NOW()" —
        // pastDueAmount's SQL contains both fragments.
        ["SUM(amount - settled_amount)", { total: "37.5" }],
        ["due_at < NOW()", { id: "ledger-1" }],
      ])
    );
    await expect(takePayLaterRide("rider-1", 40)).rejects.toThrow(
      "R37.50 past its due date"
    );
  });

  it("rejects when the fare exceeds available credit", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", acct({ credit_limit: 100 })],
        ["COALESCE(SUM(\n        CASE entry_type", { total: "60" }],
        ["MAX(due_at)", { due_at: null }],
      ])
    );
    await expect(takePayLaterRide("rider-1", 50)).rejects.toThrow(
      "exceeds your available Pay Later credit (R40.00)"
    );
  });

  it("approves a fare that fits, echoing limit/outstanding/available", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", acct({ credit_limit: 100 })],
        ["COALESCE(SUM(\n        CASE entry_type", { total: "60" }],
        ["MAX(due_at)", { due_at: "2026-10-31T23:59:59Z" }],
      ])
    );
    const res = await takePayLaterRide("rider-1", 40);
    expect(res).toMatchObject({
      approved: true,
      limit_r: 100,
      outstanding_r: 60,
      available_r: 40,
    });
    expect(new Date(res.due_date as any).toISOString()).toBe("2026-10-31T23:59:59.000Z");
  });
});

// ── Terms + auto-debit consent ────────────────────────────────────────────────

describe("acceptPayLaterTerms / setPayLaterAutoDebit", () => {
  it("terms acceptance requires enrollment and records first acceptance", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", ACTIVE_ACCOUNT],
        ["SET terms_accepted_at = COALESCE", { terms_accepted_at: "2026-10-16T09:00:00Z" }],
      ])
    );
    const res = await acceptPayLaterTerms("rider-1");
    expect(res.terms_accepted_at).toBe("2026-10-16T09:00:00Z");
  });

  it("terms acceptance throws for a rider who never enrolled", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([["FROM pay_later_accounts a", null]])
    );
    await expect(acceptPayLaterTerms("rider-1")).rejects.toThrow("not enrolled");
  });

  it("enabling auto-debit REQUIRES a saved card", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", { ...ACTIVE_ACCOUNT, card_token: null }],
      ])
    );
    vi.mocked(getDefaultCardToken).mockResolvedValue(null as any);
    await expect(setPayLaterAutoDebit("rider-1", true)).rejects.toThrow(
      "Add a saved card"
    );
  });

  it("enabling auto-debit REQUIRES accepted terms", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        [
          "FROM pay_later_accounts a",
          { ...ACTIVE_ACCOUNT, terms_accepted_at: null },
        ],
      ])
    );
    await expect(setPayLaterAutoDebit("rider-1", true)).rejects.toThrow(
      "Accept the Pay Later terms"
    );
  });

  it("records consent timestamp when enabling with card + terms", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", ACTIVE_ACCOUNT],
        [
          "SET auto_debit_enabled = $2",
          { auto_debit_enabled: true, auto_debit_consent_at: "2026-10-16T09:00:00Z" },
        ],
      ])
    );
    const res = await setPayLaterAutoDebit("rider-1", true);
    expect(res).toEqual({ enabled: true, consent_at: "2026-10-16T09:00:00Z" });
    const last = vi.mocked(queryOne).mock.calls.at(-1)!;
    expect(String(last[0])).toContain("auto_debit_consent_at = CASE WHEN $2");
  });

  it("revoking (disable) clears consent and always succeeds", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", ACTIVE_ACCOUNT],
        [
          "SET auto_debit_enabled = $2",
          { auto_debit_enabled: false, auto_debit_consent_at: null },
        ],
      ])
    );
    const res = await setPayLaterAutoDebit("rider-1", false);
    expect(res).toEqual({ enabled: false, consent_at: null });
  });
});

// ── Enrollment ────────────────────────────────────────────────────────────────

describe("enrollPayLater — card-first (v1 upgrade)", () => {
  const userRows: Array<[string, any]> = [
    ["SELECT id, phone, email FROM users", { id: "rider-1", phone: "+271", email: "r@v.c" }],
    ["FROM pay_later_blacklist", null],
    ["WHERE identity_fingerprint = $1 AND status = 'frozen'", null],
  ];

  it("requires a saved card outside mock mode", async () => {
    vi.mocked(getDefaultCardToken).mockResolvedValue(null as any);
    vi.mocked(queryOne).mockImplementation(oneMock(userRows));
    await expect(enrollPayLater("rider-1", {})).rejects.toThrow(
      "Add a saved card first"
    );
  });

  it("refuses below the unlock threshold outside mock mode", async () => {
    vi.mocked(getDefaultCardToken).mockResolvedValue({ transaction_index: "IDX-1" } as any);
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ...userRows,
        ["FROM saved_cards", { id: "card-1" }],
        ["SELECT COUNT(*)::text AS total", { total: "3" }],
      ])
    );
    await expect(enrollPayLater("rider-1", {})).rejects.toThrow(
      "unlocks after 5 paid rides"
    );
  });

  it("upserts an active account with the computed limit (5 rides → R100)", async () => {
    vi.mocked(getDefaultCardToken).mockResolvedValue({ transaction_index: "IDX-1" } as any);
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ...userRows,
        ["FROM saved_cards", { id: "card-1" }],
        ["SELECT COUNT(*)::text AS total", { total: "5" }],
        ["INSERT INTO pay_later_accounts", { ...ACTIVE_ACCOUNT, credit_limit: 100 }],
      ])
    );
    const res = await enrollPayLater("rider-1", {});
    expect(res.account.credit_limit).toBe(100);
    expect(res.account.available).toBe(100);
    expect(res.completed_rides).toBe(5);
    const ins = vi
      .mocked(queryOne)
      .mock.calls.find(([sql]) => String(sql).includes("INSERT INTO pay_later_accounts"));
    expect(ins?.[1]).toContain(100); // credit-limit parameter
  });
});

// ── Webhook-driven credit confirmation (the ledger's ONLY reducer) ────────────

describe("confirmRepaymentReference — idempotent pending→confirmed", () => {
  it("confirms once: settles debits FIFO, mirrors the account, flips the attempt log, COMMITs", async () => {
    const client = scriptClient([
      ["SET status = 'confirmed'", { rows: [{ rider_id: "rider-1", amount: 50 }], rowCount: 1 }],
      ["FOR UPDATE", { rows: [
        { id: "d1", ride_id: "ride-1", amount: 40, settled_amount: 0 },
        { id: "d2", ride_id: null, amount: 100, settled_amount: 0 },
      ] }],
      ["WHEN 'debit' THEN amount", { rows: [{ total: 90 }] }], // mirror: 140 − 50
    ]);
    hoisted.connect.mockResolvedValue(client);

    const res = await confirmRepaymentReference("PLRABC");
    expect(res).toEqual({ confirmed: true, amount: 50, riderId: "rider-1" });

    const sqls = client.query.mock.calls.map(([s]) => String(s));
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.at(-1)).toBe("COMMIT");
    // FIFO: oldest debit fully settled (40/40) → its ride marked PAID
    const settle = client.query.mock.calls.find(([s]) =>
      String(s).includes("SET settled_amount = $2, status = $3")
    );
    expect(settle?.[1]).toEqual(["d1", 40, "settled"]);
    const paid = client.query.mock.calls.find(([s]) =>
      String(s).includes("payment_status = 'paid'")
    );
    expect(paid?.[1]).toEqual(["ride-1"]);
    // Account mirror updated from the LEDGER, not a hand-tallied number
    const mirror = client.query.mock.calls.find(([s]) =>
      String(s).includes("UPDATE pay_later_accounts SET outstanding = $2")
    );
    expect(mirror?.[1]).toEqual(["rider-1", 90]);
    // Attempt log flipped → success
    expect(sqls.some((s) => s.includes("UPDATE payment_collections SET result = 'success'"))).toBe(true);
  });

  it("REPLAY of the same reference is a no-op (second webhook delivery)", async () => {
    const client = scriptClient([
      ["SET status = 'confirmed'", { rows: [], rowCount: 0 }], // already confirmed
    ]);
    hoisted.connect.mockResolvedValue(client);
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["SELECT status FROM pay_later_ledger", { status: "confirmed" }],
      ])
    );

    const res = await confirmRepaymentReference("PLRABC");
    expect(res.confirmed).toBe(false);
    expect(res.detail).toBe("credit already confirmed");
    // No settlement ran — only BEGIN/COMMIT around the guarded UPDATE
    expect(client.query.mock.calls.some(([s]) => String(s).includes("SET settled_amount"))).toBe(false);
    expect(client.query.mock.calls.map(([s]) => String(s))).toContain("COMMIT");
  });
});

describe("markRepaymentFailed — money never moved, balance untouched", () => {
  it("marks the pending credit failed and pushes a notification", async () => {
    // Dispatch on SQL: ensurePayLaterTables fires many execute() calls first.
    vi.mocked(execute).mockImplementation(async (sql: string) =>
      String(sql).includes("SET status = 'failed'")
        ? { rowCount: 1, rows: [{ rider_id: "rider-1" }] }
        : { rowCount: 1, rows: [] }
    );
    const res = await markRepaymentFailed("PLRFAIL", "insufficient funds");
    expect(res).toEqual({ failed: true, riderId: "rider-1" });
    expect(sendPushToUsers).toHaveBeenCalledTimes(1);
    const failUpdate = vi.mocked(execute).mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'failed'")
    );
    expect(failUpdate?.[1]).toEqual(["PLRFAIL"]);
  });

  it("is a no-op for an unknown/already-final reference (no push)", async () => {
    vi.mocked(execute).mockImplementation(async () => ({ rowCount: 0, rows: [] }));
    const res = await markRepaymentFailed("PLRSTALE", "declined");
    expect(res.failed).toBe(false);
    expect(sendPushToUsers).not.toHaveBeenCalled();
  });
});

// ── Webhook router entry (charge.* → Pay Later) ───────────────────────────────

describe("handlePayLaterChargeWebhook — signature-pipe entry for charge.*", () => {
  it("ignores charge events that are NOT Pay Later repayments (no dedupe row)", async () => {
    const res = await handlePayLaterChargeWebhook("charge.success", {
      data: { reference: "atyntuup5bec03e" }, // card registration ref
    });
    expect(res).toMatchObject({ received: true, handled: false, duplicate: false });
    expect(recordWebhookEventOnce).not.toHaveBeenCalled();
  });

  it("dedupes replayed deliveries BEFORE touching the ledger", async () => {
    vi.mocked(recordWebhookEventOnce).mockResolvedValue(false as any);
    const res = await handlePayLaterChargeWebhook("charge.success", {
      data: { reference: "PLRDUPE" },
    });
    expect(res).toMatchObject({ duplicate: true, handled: false });
    expect(hoisted.connect).not.toHaveBeenCalled();
  });

  it("charge.success for PLR… → confirms the credit (webhook = ledger truth)", async () => {
    const client = scriptClient([
      ["SET status = 'confirmed'", { rows: [{ rider_id: "rider-1", amount: 45.5 }], rowCount: 1 }],
      ["FOR UPDATE", { rows: [] }],
      ["WHEN 'debit' THEN amount", { rows: [{ total: 45.5 }] }],
    ]);
    hoisted.connect.mockResolvedValue(client);

    const res = await handlePayLaterChargeWebhook("charge.success", {
      data: { reference: "PLRCONF", message: "Success" },
    });
    expect(res).toMatchObject({ duplicate: false, handled: true });
    expect(res.detail).toBe("confirmed R45.5");
    expect(recordWebhookEventOnce).toHaveBeenCalledWith(
      "charge.success",
      { reference: "PLRCONF", message: "Success" },
      "PLRCONF"
    );
  });

  it("charge.failed for PLR… → marks the credit failed + notifies the rider", async () => {
    vi.mocked(execute).mockImplementation(async (sql: string) =>
      String(sql).includes("SET status = 'failed'")
        ? { rowCount: 1, rows: [{ rider_id: "rider-1" }] }
        : { rowCount: 1, rows: [] }
    );
    const res = await handlePayLaterChargeWebhook("charge.failed", {
      data: { reference: "PLRDECL", message: "Insufficient funds" },
    });
    expect(res).toMatchObject({ duplicate: false, handled: true });
    expect(res.detail).toBe("failed: Insufficient funds");
    expect(sendPushToUsers).toHaveBeenCalledTimes(1);
  });
});

// ── Completion: book the debt (one debit per ride, re-fire safe) ──────────────

describe("registerPayLaterDebit / onRideCompletedPayLater", () => {
  it("no-ops for a non-pay-later ride (card rides never touch the ledger)", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        [
          "FROM rides WHERE id = $1",
          { id: "ride-1", passenger_id: "rider-1", status: "completed", payment_method: "card", fare: 60 },
        ],
      ])
    );
    expect(await registerPayLaterDebit("ride-1")).toBe(false);
    expect(hoisted.connect).not.toHaveBeenCalled();
  });

  it("no-ops for a ride that is not completed yet", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        [
          "FROM rides WHERE id = $1",
          { id: "ride-1", passenger_id: "rider-1", status: "in_progress", payment_method: "pay_later", fare: 60 },
        ],
      ])
    );
    expect(await registerPayLaterDebit("ride-1")).toBe(false);
    expect(hoisted.connect).not.toHaveBeenCalled();
  });

  it("books ONE open debit with the fare + month-end due date + mirrors the account", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        [
          "FROM rides WHERE id = $1",
          { id: "ride-1", passenger_id: "rider-1", status: "completed", payment_method: "pay_later", fare: 75 },
        ],
        ["FROM pay_later_accounts a", ACTIVE_ACCOUNT],
      ])
    );
    const client = scriptClient([
      ["INSERT INTO pay_later_ledger", { rows: [{ id: "led-1" }], rowCount: 1 }],
      ["WHEN 'debit' THEN amount", { rows: [{ total: 75 }] }],
    ]);
    hoisted.connect.mockResolvedValue(client);

    expect(await registerPayLaterDebit("ride-1")).toBe(true);
    const ins = client.query.mock.calls.find(([s]) =>
      String(s).includes("INSERT INTO pay_later_ledger")
    );
    expect(ins?.[1]).toEqual([
      "rider-1",
      "ride-1",
      75,
      expect.any(Date), // month-end due date
      ACTIVE_ACCOUNT.terms_accepted_at,
    ]);
    const pending = client.query.mock.calls.find(([s]) =>
      String(s).includes("payment_status = 'pending'")
    );
    expect(pending?.[1]).toEqual(["ride-1", expect.any(Date)]);
    expect(client.query.mock.calls.map(([s]) => String(s))).toContain("COMMIT");
  });

  it("RE-FIRED completion does not double-book (unique ride+source conflict)", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        [
          "FROM rides WHERE id = $1",
          { id: "ride-1", passenger_id: "rider-1", status: "completed", payment_method: "pay_later", fare: 75 },
        ],
        ["FROM pay_later_accounts a", ACTIVE_ACCOUNT],
      ])
    );
    const client = scriptClient([
      ["INSERT INTO pay_later_ledger", { rows: [], rowCount: 0 }], // conflict
    ]);
    hoisted.connect.mockResolvedValue(client);

    expect(await registerPayLaterDebit("ride-1")).toBe(false);
    expect(client.query.mock.calls.map(([s]) => String(s))).toContain("COMMIT");
    expect(
      client.query.mock.calls.some(([s]) => String(s).includes("payment_status = 'pending'"))
    ).toBe(false);
  });

  it("onRideCompletedPayLater is safe on a non-pay-later ride (no tx opened)", async () => {
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        [
          "FROM rides WHERE id = $1",
          { id: "ride-1", passenger_id: "rider-1", status: "completed", payment_method: "card" },
        ],
        ["FROM pay_later_accounts a", ACTIVE_ACCOUNT],
        ["COALESCE(SUM(\n        CASE entry_type", { total: "0" }],
      ])
    );
    await expect(onRideCompletedPayLater("ride-1")).resolves.toBeUndefined();
    expect(hoisted.connect).not.toHaveBeenCalled();
  });
});

// ── Collection worker (consent-gated; every attempt logged) ───────────────────

describe("runMonthlyCollection — due-date + threshold auto-debit", () => {
  const DUE_SQL = "SELECT id AS debit_id, rider_id, ride_id, due_at";
  const yesterday = () => new Date(Date.now() - 86_400_000);

  it("skips a due debit when the rider never consented to auto-debit", async () => {
    vi.mocked(query).mockImplementation(
      sqlMock([
        [DUE_SQL, { rows: [{ debit_id: "d1", rider_id: "rider-1", ride_id: "ride-1", due_at: yesterday(), remaining: 55 }] }],
      ])
    );
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", { ...ACTIVE_ACCOUNT, auto_debit_enabled: false }],
      ])
    );
    const s = await runMonthlyCollection();
    expect(s.attempted).toBe(0);
    expect(chargeAuthorization).not.toHaveBeenCalled(); // consent is the gate
  });

  it("charges a consented rider on their due date → PENDING credit (webhook confirms)", async () => {
    vi.mocked(query).mockImplementation(
      sqlMock([
        [DUE_SQL, { rows: [{ debit_id: "d1", rider_id: "rider-1", ride_id: "ride-1", due_at: yesterday(), remaining: 55 }] }],
      ])
    );
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", { ...ACTIVE_ACCOUNT, auto_debit_enabled: true, card_token: "AUTH_x" }],
        ["AND entry_type = 'credit' AND status = 'pending'", null], // not in flight
        ["WHERE ride_id = $1", { n: 0 }], // attempt #1 of the schedule
      ])
    );
    vi.mocked(chargeAuthorization).mockResolvedValue({ success: true } as any);

    const s = await runMonthlyCollection();
    expect(s).toMatchObject({ attempted: 1, pending: 1, succeeded: 0, failed: 0 });
    expect(chargeAuthorization).toHaveBeenCalledTimes(1);
    expect(chargeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        amountRands: 55,
        authorizationCode: "AUTH_x",
        reference: expect.any(String),
      })
    );
    // EVERY attempt is logged (brief) + credit stays PENDING until the webhook
    const attemptLog = vi.mocked(execute).mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO payment_collections")
    );
    expect(attemptLog?.[1]).toEqual([
      "rider-1",
      "ride-1",
      55,
      1,
      expect.any(String), // reference ('pending'/'paystack' are SQL literals)
    ]);
    const pendingCredit = vi.mocked(execute).mock.calls.find(([sql]) =>
      String(sql).includes("'pending', 'auto_debit'")
    );
    expect(pendingCredit?.[1]).toEqual(["rider-1", 55, expect.any(String)]);
  });

  it("never double-charges while a repayment is awaiting its webhook", async () => {
    vi.mocked(query).mockImplementation(
      sqlMock([
        [DUE_SQL, { rows: [{ debit_id: "d1", rider_id: "rider-1", ride_id: "ride-1", due_at: yesterday(), remaining: 55 }] }],
      ])
    );
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", { ...ACTIVE_ACCOUNT, auto_debit_enabled: true }],
        ["AND entry_type = 'credit' AND status = 'pending'", { reference: "PLRINFLIGHT" }],
      ])
    );
    const s = await runMonthlyCollection();
    expect(s.attempted).toBe(0);
    expect(chargeAuthorization).not.toHaveBeenCalled();
  });

  it("threshold mode: charges consented riders whose WHOLE balance crossed the threshold", async () => {
    process.env.PAY_LATER_AUTO_DEBIT_THRESHOLD_R = "50";
    vi.mocked(query).mockImplementation(
      sqlMock([
        [DUE_SQL, { rows: [] }], // nothing due…
        ["outstanding >= $1", { rows: [{ user_id: "rider-1", outstanding: 80 }] }], // …but over R50
      ])
    );
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["FROM pay_later_accounts a", { ...ACTIVE_ACCOUNT, auto_debit_enabled: true, card_token: "AUTH_x" }],
        ["AND entry_type = 'credit' AND status = 'pending'", null],
        ["WHERE rider_id = $1", { n: 0 }],
      ])
    );
    vi.mocked(chargeAuthorization).mockResolvedValue({ success: true } as any);

    const s = await runMonthlyCollection();
    expect(s).toMatchObject({ attempted: 1, pending: 1 });
    expect(chargeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ amountRands: 80, authorizationCode: "AUTH_x" })
    );
  });
});

// ── The blob both progress bars render from ───────────────────────────────────

describe("getPayLaterEligibility — locked rider progress", () => {
  it("reports unlock progress + zeroed repay/balance state without an account", async () => {
    vi.mocked(getDefaultCardToken).mockResolvedValue(null as any);
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        ["SELECT COUNT(*)::text AS total", { total: "3" }],
        ["COALESCE(SUM(\n        CASE entry_type", { total: "0" }],
        ["FROM pay_later_accounts a", null],
      ])
    );
    const e = await getPayLaterEligibility("rider-1");
    expect(e).toMatchObject({
      enrolled: false,
      unlocked: false,
      rides_completed: 3,
      rides_required: 5,
      progress_pct: 60,
      limit_r: 0,
      outstanding_r: 0,
      available_r: 0,
      past_due: false,
      has_card: false,
    });
    expect(e.ride_to_repay).toMatchObject({
      rides_required: 4, // PAY_LATER_RIDES_TO_REPAY default
      rides_done: 0,
      rides_left: 0,
      amount_per_ride_r: 0,
    });
    expect(e.auto_debit).toMatchObject({ enabled: false });
    // Breakdown defaults to the counted number when the diagnostic query
    // returns nothing (never invents a gap).
    expect(e.ride_breakdown).toEqual({
      total_completed: 3,
      paid_by_card: 3,
      same_card: 3,
      excluded_by_farm: 0,
    });
  });

  it("surfaces WHY rides don't count: history vs card vs same-card vs anti-farm", async () => {
    vi.mocked(getDefaultCardToken).mockResolvedValue(null as any);
    vi.mocked(queryOne).mockImplementation(
      oneMock([
        [
          "COUNT(*) FILTER",
          { total_completed: 9, paid_by_card: 6, same_card: 5 },
        ],
        ["SELECT COUNT(*)::text AS total", { total: "3" }], // counted: 5 − farm cap
        ["COALESCE(SUM(\n        CASE entry_type", { total: "0" }],
        ["FROM pay_later_accounts a", null],
      ])
    );
    const e = await getPayLaterEligibility("rider-1");
    expect(e.rides_completed).toBe(3);
    expect(e.ride_breakdown).toEqual({
      total_completed: 9, // what the rider sees in history
      paid_by_card: 6,    // …of which paid by card (cash excluded)
      same_card: 5,       // …of which on the CURRENT card (re-added card excluded)
      excluded_by_farm: 2, // …minus rides with a driver used 5×+ (anti-farm)
    });
  });
});






