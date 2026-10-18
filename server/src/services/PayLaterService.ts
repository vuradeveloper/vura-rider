// ─────────────────────────────────────────────────────────────────────────────
// RIDE NOW, PAY LATER — eligibility, ledger, repayments, auto-debit.
//
// Upgrade-in-place of the v1 iVerve spike (user-approved): the bank-mandate
// rail is gone (it could never run outside mock mode); every repayment now
// runs through Paystack's saved-card charge authorization, and — per the
// feature brief — the LEDGER is only updated when Paystack's charge.success /
// charge.failed WEBHOOK confirms (idempotent: event dedupe + a unique
// Paystack reference on the credit row + guarded pending→confirmed UPDATE).
//
// Rules encoded here (all configurable via env, see payLaterConfig):
//   • Unlock: PAY_LATER_RIDES_TO_UNLOCK completed PAID rides on the SAME card
//     (rides.card_auth_code matches the rider's saved card token; legacy
//     pre-feature card rides grandfather; anti-ride-farming pair guard kept).
//   • Credit limit: flat PAY_LATER_CREDIT_LIMIT_R (+ optional ladder step).
//   • Ledger: pay_later_ledger — debits (one per pay-later ride, open→settled
//     FIFO as credits land) and credits (pending→confirmed via webhook).
//     pay_later_accounts.outstanding is a MIRROR recomputed from the ledger
//     in the same transaction (existing booking guard reads it unchanged).
//   • Repay: (a) "Pay what I owe" by saved card, (b) auto-debit with explicit
//     rider consent + retry schedule, (c) ride-to-repay: every
//     PAY_LATER_RIDES_TO_REPAY completed rides clears PAY_LATER_REPAY_PER_RIDE_R
//     (part of the balance — never the whole debt).
//   • Safety: past-due balance blocks new pay-later rides (booking guard);
//     exhausted retries → overdue + freeze + identity blacklist (v1 policy);
//     every attempt logged in payment_collections; drivers are paid at
//     completion regardless (see routes/payouts.ts pay_later earnings fix).
// ─────────────────────────────────────────────────────────────────────────────
import getPool from "../config/database";
import { query, queryOne, execute } from "../config/database";
import {
  chargeAuthorization,
  getDefaultCardToken,
  paymentsMode,
} from "./paystackPayment";
import { sendPushToUsers } from "./notify";
import { recordWebhookEventOnce } from "./preauthorization";

// ── Configuration (env → defaults; every number in the brief is configurable) ─

export interface PayLaterConfig {
  ridesToUnlock: number;
  creditLimitR: number;
  limitStepR: number;
  ridesPerStep: number;
  capR: number;
  ridesToRepay: number;
  repayPerRideR: number;
  retryDays: number[];
  autoDebitThresholdR: number;
  workerIntervalMs: number;
}

const envInt = (v: string | undefined, d: number, min = 0): number => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= min ? n : d;
};
const envNum = (v: string | undefined, d: number): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export function payLaterConfig(): PayLaterConfig {
  const retryDays = (process.env.PAY_LATER_RETRY_DAYS || "1,3,7")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    ridesToUnlock: envInt(process.env.PAY_LATER_RIDES_TO_UNLOCK, 5),
    creditLimitR: envNum(process.env.PAY_LATER_CREDIT_LIMIT_R, 100),
    limitStepR: envNum(process.env.PAY_LATER_LIMIT_STEP_R, 50),
    ridesPerStep: envInt(process.env.PAY_LATER_RIDES_PER_STEP, 10, 1),
    capR: envNum(process.env.PAY_LATER_CAP_R, 1000),
    ridesToRepay: envInt(process.env.PAY_LATER_RIDES_TO_REPAY, 4, 1),
    repayPerRideR: envNum(process.env.PAY_LATER_REPAY_PER_RIDE_R, 25),
    retryDays: retryDays.length ? retryDays : [1, 3, 7],
    autoDebitThresholdR: envNum(process.env.PAY_LATER_AUTO_DEBIT_THRESHOLD_R, 0),
    workerIntervalMs: envInt(
      process.env.PAY_LATER_WORKER_INTERVAL_MS,
      6 * 60 * 60 * 1000, // every 6h
      60_000
    ),
  };
}

/** Credit ladder: 0 below the unlock threshold, then +limitStepR every
 *  ridesPerStep rides, capped. The flat configured limit is the step-0 value. */
export function computeCreditLimit(completedRides: number): number {
  const cfg = payLaterConfig();
  if (completedRides < cfg.ridesToUnlock) return 0;
  const steps = Math.floor((completedRides - cfg.ridesToUnlock) / cfg.ridesPerStep);
  return Math.min(cfg.capR, cfg.creditLimitR + steps * cfg.limitStepR);
}

function lastDayOfMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
}

// ── Schema (lazy ensure — same money-table pattern as payments/payouts) ──────

export async function ensurePayLaterTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS pay_later_accounts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      credit_limit NUMERIC(12,2) NOT NULL DEFAULT 100,
      outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      mandate_token VARCHAR(255),
      card_token VARCHAR(255),
      account_holder VARCHAR(120),
      bank_code VARCHAR(20),
      account_number_masked VARCHAR(20),
      identity_fingerprint VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS payment_collections (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      result VARCHAR(20) NOT NULL,
      provider VARCHAR(50),
      reason VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS pay_later_blacklist (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      identity_fingerprint VARCHAR(255) NOT NULL UNIQUE,
      reason VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // THE LEDGER (015 ships the same DDL — both paths no-op once applied).
  await execute(`
    CREATE TABLE IF NOT EXISTS pay_later_ledger (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
      entry_type VARCHAR(10) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      settled_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL,
      source VARCHAR(30) NOT NULL,
      reference VARCHAR(100),
      due_at TIMESTAMPTZ,
      terms_accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS pay_later_ledger_ride_source_key
       ON pay_later_ledger (ride_id, source) WHERE ride_id IS NOT NULL`
  ).catch(() => {});
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS pay_later_ledger_reference_key
       ON pay_later_ledger (reference) WHERE reference IS NOT NULL`
  ).catch(() => {});
  await execute(
    `CREATE INDEX IF NOT EXISTS pay_later_ledger_rider_idx ON pay_later_ledger (rider_id, created_at)`
  ).catch(() => {});
  // Additive columns — fresh dev/test DBs work without the migration runner.
  for (const ddl of [
    `ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS auto_debit_enabled BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS auto_debit_consent_at TIMESTAMPTZ`,
    `ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`,
    `ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS repay_ride_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE payment_collections ADD COLUMN IF NOT EXISTS reference VARCHAR(100)`,
    `ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20)`,
    `ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20)`,
    `ALTER TABLE rides ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ`,
    `ALTER TABLE rides ADD COLUMN IF NOT EXISTS card_auth_code VARCHAR(100)`,
  ]) {
    await execute(ddl).catch(() => { /* already there */ });
  }
}

async function getAccount(dbUserId: string) {
  return queryOne<any>(
    `SELECT a.*, u.phone, u.email
       FROM pay_later_accounts a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1`,
    [dbUserId]
  );
}

function maskAccountNumber(accountNumber: string): string {
  return `•••• ${accountNumber.slice(-4)}`;
}

// ── Eligibility: completed PAID rides on the SAME card ────────────────────────

/**
 * Counts completed rides that paid with the rider's CURRENT saved card:
 *   • provenance match — rides.card_auth_code (stamped by the preauth capture
 *     webhook and the saved-card charge path) equals saved_cards.transaction_index;
 *   • grandfather — pre-feature card rides carry no provenance and count
 *     (they WERE card-paid; a ride paid by a DIFFERENT known card never counts);
 *   • anti ride-farming — a (rider, driver) pair used ≥5 completed times is
 *     excluded entirely (kept from v1).
 * With no saved card the provenance match is empty → only grandfathered
 * rides count (the brief's "one card" rule still holds once a card exists).
 */
export async function countUnlockRides(dbUserId: string): Promise<number> {
  const card = await getDefaultCardToken(dbUserId).catch(() => null);
  const authCode = card?.transaction_index || "";
  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM rides r
      WHERE r.passenger_id = $1
        AND r.status = 'completed'
        AND r.driver_id IS NOT NULL
        AND (
              (r.card_auth_code IS NOT NULL AND r.card_auth_code = $2 AND $2 <> '')
              OR (r.card_auth_code IS NULL AND LOWER(COALESCE(r.payment_method, '')) = 'card')
            )
        AND NOT EXISTS (
          SELECT 1 FROM rides r2
           WHERE r2.passenger_id = $1
             AND r2.driver_id = r.driver_id
             AND r2.status = 'completed'
          HAVING COUNT(*) >= 5
        )`,
    [dbUserId, authCode]
  );
  return parseInt(row?.total || "0", 10);
}

/** v1 counter (any completed ride, no card provenance) — kept exported for
 *  compatibility; eligibility/ladder use countUnlockRides. */
export async function countCompletedRides(dbUserId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM rides r
      WHERE r.passenger_id = $1
        AND r.status = 'completed'
        AND r.driver_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM rides r2
           WHERE r2.passenger_id = $1
             AND r2.driver_id = r.driver_id
             AND r2.status = 'completed'
          HAVING COUNT(*) >= 5
        )`,
    [dbUserId]
  );
  return parseInt(row?.total || "0", 10);
}

// ── Ledger math (single source of truth) ──────────────────────────────────────

/** outstanding = Σ debits − Σ CONFIRMED credits (pending/failed credits never
 *  reduce the balance — the brief's webhook-confirmation rule). */
export async function ledgerOutstanding(riderId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(
        CASE entry_type
          WHEN 'debit' THEN amount
          WHEN 'credit' THEN -CASE WHEN status = 'confirmed' THEN amount ELSE 0 END
          ELSE 0 END), 0)::text AS total
       FROM pay_later_ledger
      WHERE rider_id = $1`,
    [riderId]
  );
  return Math.max(0, Math.round(Number(row?.total || 0) * 100) / 100);
}

export async function hasPastDueDebit(riderId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM pay_later_ledger
      WHERE rider_id = $1 AND entry_type = 'debit' AND status = 'open'
        AND due_at IS NOT NULL AND due_at < NOW()
      LIMIT 1`,
    [riderId]
  );
  return !!row;
}

export async function pastDueAmount(riderId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(amount - settled_amount), 0)::text AS total
       FROM pay_later_ledger
      WHERE rider_id = $1 AND entry_type = 'debit' AND status = 'open'
        AND due_at IS NOT NULL AND due_at < NOW()`,
    [riderId]
  );
  return Math.max(0, Number(row?.total || 0));
}

/** Recomputes the accounts.outstanding MIRROR from the ledger inside the
 *  caller's transaction so mirror and ledger can never drift. */
async function mirrorOutstanding(
  client: { query: Function },
  riderId: string
): Promise<number> {
  const row = await client.query(
    `SELECT COALESCE(SUM(
        CASE entry_type
          WHEN 'debit' THEN amount
          WHEN 'credit' THEN -CASE WHEN status = 'confirmed' THEN amount ELSE 0 END
          ELSE 0 END), 0)::float AS total
       FROM pay_later_ledger WHERE rider_id = $1`,
    [riderId]
  );
  const total = Math.max(0, Math.round(Number(row?.rows?.[0]?.total || 0) * 100) / 100);
  await client.query(
    `UPDATE pay_later_accounts SET outstanding = $2, updated_at = NOW() WHERE user_id = $1`,
    [riderId, total]
  );
  return total;
}

/**
 * FIFO allocation: applies `amountRands` of confirmed credit to the rider's
 * OLDEST open debits. A fully settled debit marks its ride payment_status=
 * 'paid' (and clears due_at) — the per-ride settlement truth v1 had.
 * Runs inside the caller's transaction with debits locked (FOR UPDATE).
 * Returns the amount actually allocated.
 */
async function settleDebitsFifo(
  client: { query: Function },
  riderId: string,
  amountRands: number,
  onlyRideId?: string | null
): Promise<number> {
  const res = await client.query(
    `SELECT id, ride_id, amount, settled_amount
       FROM pay_later_ledger
      WHERE rider_id = $1 AND entry_type = 'debit' AND status = 'open'
        ${onlyRideId ? "AND ride_id = $2" : ""}
      ORDER BY created_at ASC
      FOR UPDATE`,
    onlyRideId ? [riderId, onlyRideId] : [riderId]
  );
  let remaining = Math.round(amountRands * 100) / 100;
  for (const d of res?.rows || []) {
    if (remaining <= 0.005) break;
    const open = Math.round((Number(d.amount) - Number(d.settled_amount)) * 100) / 100;
    if (open <= 0.005) continue;
    const take = Math.min(open, remaining);
    const newSettled = Math.round((Number(d.settled_amount) + take) * 100) / 100;
    const fully = newSettled + 0.005 >= Number(d.amount);
    await client.query(
      `UPDATE pay_later_ledger
          SET settled_amount = $2, status = $3, updated_at = NOW()
        WHERE id = $1`,
      [d.id, newSettled, fully ? "settled" : "open"]
    );
    if (fully && d.ride_id) {
      await client.query(
        `UPDATE rides SET payment_status = 'paid', due_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [d.ride_id]
      );
    }
    remaining = Math.round((remaining - take) * 100) / 100;
  }
  return Math.round((amountRands - remaining) * 100) / 100;
}

// ── Eligibility blob (powers both progress bars + the balance screen) ─────────

export async function getPayLaterEligibility(dbUserId: string) {
  await ensurePayLaterTables();
  const cfg = payLaterConfig();
  const account = await getAccount(dbUserId);
  const rides = await countUnlockRides(dbUserId);
  const outstanding = await ledgerOutstanding(dbUserId);
  const unlocked = rides >= cfg.ridesToUnlock;
  const limit = account ? Number(account.credit_limit || 0) : computeCreditLimit(rides);
  const available = Math.max(0, Math.round((limit - outstanding) * 100) / 100);
  const pastDue = account ? await hasPastDueDebit(dbUserId) : false;
  const dueRow = account
    ? await queryOne<{ due_at: Date | null }>(
        `SELECT MAX(due_at) AS due_at FROM pay_later_ledger
          WHERE rider_id = $1 AND entry_type = 'debit' AND status = 'open'`,
        [dbUserId]
      )
    : null;
  const inCycle = Number(account?.repay_ride_count || 0);
  const cfgRepay = cfg.ridesToRepay;
  const card = await getDefaultCardToken(dbUserId).catch(() => null);
  return {
    enrolled: !!account,
    status: account?.status || null,
    unlocked,
    rides_completed: rides,
    rides_required: cfg.ridesToUnlock,
    progress_pct:
      cfg.ridesToUnlock <= 0 ? 100 : Math.min(100, Math.round((rides / cfg.ridesToUnlock) * 100)),
    limit_r: limit,
    outstanding_r: outstanding,
    available_r: available,
    past_due: pastDue,
    past_due_r: pastDue ? await pastDueAmount(dbUserId) : 0,
    due_date: dueRow?.due_at ? new Date(dueRow.due_at).toISOString() : null,
    terms_accepted_at: account?.terms_accepted_at ?? null,
    auto_debit: {
      enabled: !!account?.auto_debit_enabled,
      consent_at: account?.auto_debit_consent_at ?? null,
      threshold_r: cfg.autoDebitThresholdR,
      retry_days: cfg.retryDays,
    },
    ride_to_repay: {
      rides_required: cfgRepay,
      rides_done: outstanding > 0 ? inCycle : 0,
      rides_left: outstanding > 0 ? Math.max(0, cfgRepay - inCycle) : 0,
      amount_per_ride_r: outstanding > 0 ? Math.min(cfg.repayPerRideR, outstanding) : 0,
      outstanding_r: outstanding,
    },
    has_card: !!card,
    card_last4: card?.last4 || null,
  };
}

export type PayLaterEligibility = Awaited<ReturnType<typeof getPayLaterEligibility>>;

// ── Credit confirmations (webhook-driven; idempotent by construction) ─────────

/**
 * Confirms a PENDING repayment credit (Paystack charge.success) in one tx:
 * guarded pending→confirmed (second call = no-op), FIFO settlement across the
 * rider's oldest open debits, mirror recompute, attempt log flipped to success.
 */
export async function confirmRepaymentReference(
  reference: string
): Promise<{ confirmed: boolean; amount?: number; riderId?: string; detail?: string }> {
  await ensurePayLaterTables();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE pay_later_ledger
          SET status = 'confirmed', updated_at = NOW()
        WHERE reference = $1 AND entry_type = 'credit' AND status = 'pending'
        RETURNING rider_id, amount`,
      [reference]
    );
    if (!upd?.rowCount) {
      await client.query("COMMIT");
      const seen = await queryOne<{ status: string }>(
        `SELECT status FROM pay_later_ledger WHERE reference = $1 AND entry_type = 'credit'`,
        [reference]
      );
      return {
        confirmed: false,
        detail: seen ? `credit already ${seen.status}` : "no such credit",
      };
    }
    const { rider_id, amount } = upd.rows[0];
    const amt = Number(amount);
    await settleDebitsFifo(client, rider_id, amt);
    await mirrorOutstanding(client, rider_id);
    await client
      .query(`UPDATE payment_collections SET result = 'success' WHERE reference = $1 AND result = 'pending'`, [
        reference,
      ])
      .catch(() => { /* attempt row optional */ });
    await client.query("COMMIT");
    return { confirmed: true, amount: amt, riderId: rider_id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Marks a pending credit failed (charge.failed webhook) + flips the attempt
 *  log — money never moved, so the balance stays untouched. */
export async function markRepaymentFailed(
  reference: string,
  reason: string
): Promise<{ failed: boolean; riderId?: string }> {
  await ensurePayLaterTables();
  const upd = await execute(
    `UPDATE pay_later_ledger
        SET status = 'failed', updated_at = NOW()
      WHERE reference = $1 AND entry_type = 'credit' AND status = 'pending'
      RETURNING rider_id`,
    [reference]
  );
  const riderId = (upd as any)?.rows?.[0]?.rider_id;
  await execute(
    `UPDATE payment_collections SET result = 'failed', reason = $2
      WHERE reference = $1 AND result = 'pending'`,
    [reference, String(reason || "charge failed").slice(0, 255)]
  ).catch(() => {});
  if (riderId) {
    await sendPushToUsers([riderId], {
      type: "pay_later",
      title: "Repayment failed",
      body: `Your card payment of your Vura balance could not be completed (${reason || "declined"}). Update your card or top up before your due date.`,
    }).catch(() => { /* notification is best-effort */ });
  }
  return { failed: !!riderId, riderId };
}

/** Any repayment still awaiting its webhook? Used to prevent double-charges
 *  (double-tap, or manual repay racing an auto-debit). */
export async function findPendingRepayment(riderId: string): Promise<string | null> {
  const row = await queryOne<{ reference: string }>(
    `SELECT reference FROM pay_later_ledger
      WHERE rider_id = $1 AND entry_type = 'credit' AND status = 'pending'
        AND reference IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [riderId]
  );
  return row?.reference || null;
}

// ── Enrollment / terms / take-preflight ───────────────────────────────────────

export interface EnrollInput {
  accountHolder?: string;
  bankCode?: string;
  accountNumber?: string;
  cardToken?: string;
  identityFingerprint?: string;
  deviceId?: string;
}

/**
 * v1 UPGRADE: card-first enrollment — ONE saved card is the repayment rail
 * (the bank mandate is gone; it never ran outside mock). Bank fields remain
 * accepted for fingerprint/back-compat with the old screen. Gate = same-card
 * unlock rides (mock mode bypasses so the flow stays testable).
 */
export async function enrollPayLater(dbUserId: string, input: EnrollInput) {
  await ensurePayLaterTables();
  const cfg = payLaterConfig();

  const user = await queryOne<{ id: string; phone: string | null; email: string | null }>(
    "SELECT id, phone, email FROM users WHERE id = $1",
    [dbUserId]
  );
  if (!user) throw new Error("User not found");

  const defaultCard = await getDefaultCardToken(dbUserId).catch(() => null);
  const cardToken = input.cardToken || defaultCard?.transaction_index || null;

  const fingerprint = (
    input.identityFingerprint ||
    [input.accountHolder || "", input.accountNumber || "", input.deviceId || user.phone || user.email || cardToken || ""]
      .map((v) => String(v).toLowerCase().replace(/\s+/g, " "))
      .join("|")
  ).toLowerCase();

  const blacklisted = await queryOne<{ id: string }>(
    "SELECT id FROM pay_later_blacklist WHERE identity_fingerprint = $1",
    [fingerprint]
  );
  if (blacklisted) throw new Error("This identity is not eligible for Pay Later.");
  const priorFrozen = await queryOne<{ id: string }>(
    "SELECT id FROM pay_later_accounts WHERE identity_fingerprint = $1 AND status = 'frozen'",
    [fingerprint]
  );
  if (priorFrozen) throw new Error("This identity is not eligible for Pay Later.");

  // The card must belong to THIS account (server never trusts a client token).
  if (cardToken) {
    const owned = await queryOne<{ id: string }>(
      "SELECT id FROM saved_cards WHERE user_id = $1 AND transaction_index = $2",
      [dbUserId, cardToken]
    );
    if (!owned) throw new Error("That card is not on your account. Add it first.");
  } else if (paymentsMode() !== "mock") {
    throw new Error(
      "Add a saved card first — Pay Later rides repay from your card (Paystack)."
    );
  }

  const mockBypass = paymentsMode() === "mock";
  const rides = await countUnlockRides(dbUserId);
  if (!mockBypass && rides < cfg.ridesToUnlock) {
    throw new Error(
      `Ride Now, Pay Later unlocks after ${cfg.ridesToUnlock} paid rides on the same card (you have ${rides}).`
    );
  }

  const creditLimit = computeCreditLimit(
    mockBypass ? Math.max(rides, cfg.ridesToUnlock) : rides
  );
  const account = await queryOne<any>(
    `INSERT INTO pay_later_accounts
       (user_id, credit_limit, status, card_token, account_holder, bank_code,
        account_number_masked, identity_fingerprint, terms_accepted_at)
     VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       credit_limit = EXCLUDED.credit_limit,
       status = 'active',
       card_token = COALESCE(EXCLUDED.card_token, pay_later_accounts.card_token),
       account_holder = COALESCE(EXCLUDED.account_holder, pay_later_accounts.account_holder),
       bank_code = COALESCE(EXCLUDED.bank_code, pay_later_accounts.bank_code),
       account_number_masked = COALESCE(EXCLUDED.account_number_masked, pay_later_accounts.account_number_masked),
       updated_at = NOW()
     RETURNING *`,
    [
      dbUserId,
      creditLimit,
      cardToken,
      input.accountHolder || null,
      input.bankCode || null,
      input.accountNumber ? maskAccountNumber(input.accountNumber) : null,
      fingerprint,
    ]
  );
  return {
    account: {
      ...account,
      available: Number(account.credit_limit) - Number(account.outstanding),
    },
    // Legacy shape kept for the old screen — the bank mandate rail is gone.
    mandate: { token: null, bankVerified: true },
    card: { verified: !!cardToken, holdReference: cardToken ? "saved-card" : "no-card" },
    completed_rides: rides,
    mode: paymentsMode(),
  };
}

/** Records the rider's explicit acceptance of the Pay Later terms (required
 *  by the booking guard before any pay-later ride). First acceptance wins. */
export async function acceptPayLaterTerms(dbUserId: string) {
  await ensurePayLaterTables();
  const account = await getAccount(dbUserId);
  if (!account) throw new Error("You are not enrolled in Ride Now, Pay Later yet.");
  const updated = await queryOne<any>(
    `UPDATE pay_later_accounts
        SET terms_accepted_at = COALESCE(terms_accepted_at, NOW()), updated_at = NOW()
      WHERE user_id = $1
      RETURNING terms_accepted_at`,
    [dbUserId]
  );
  return { terms_accepted_at: updated?.terms_accepted_at ?? account.terms_accepted_at ?? null };
}

/**
 * Take-a-pay-later-ride preflight (the app calls this before booking; the
 * socket booking guard re-checks server-side — never trust the client):
 * active account → terms accepted → NOT past due → fare fits available credit.
 */
export async function takePayLaterRide(dbUserId: string, estimatedFareR: number) {
  await ensurePayLaterTables();
  const account = await getAccount(dbUserId);
  if (!account || account.status !== "active") {
    throw new Error("Ride Now, Pay Later is not active on your account.");
  }
  if (!account.terms_accepted_at) {
    throw new Error("Please accept the Pay Later terms to continue.");
  }
  if (await hasPastDueDebit(dbUserId)) {
    const owed = await pastDueAmount(dbUserId);
    throw new Error(
      `You have R${owed.toFixed(2)} past its due date. Repay your balance to use Pay Later again.`
    );
  }
  const limit = Number(account.credit_limit || 0);
  const outstanding = await ledgerOutstanding(dbUserId);
  const available = Math.max(0, Math.round((limit - outstanding) * 100) / 100);
  const fare = Math.round(Number(estimatedFareR || 0) * 100) / 100;
  if (!Number.isFinite(fare) || fare <= 0) {
    throw new Error("This ride has no estimated fare to check against your limit.");
  }
  if (fare > available) {
    throw new Error(
      `This ride (R${fare.toFixed(2)}) exceeds your available Pay Later credit (R${available.toFixed(2)}) — repay some of your balance first.`
    );
  }
  const due = await queryOne<{ due_at: Date | null }>(
    `SELECT MAX(due_at) AS due_at FROM pay_later_ledger
      WHERE rider_id = $1 AND entry_type = 'debit' AND status = 'open'`,
    [dbUserId]
  );
  return {
    approved: true as const,
    limit_r: limit,
    outstanding_r: outstanding,
    available_r: available,
    due_date: due?.due_at ?? null,
    terms_accepted_at: account.terms_accepted_at,
  };
}

// ── Status / refresh (back-compat shapes + the new eligibility blob) ──────────

export async function getPayLaterStatus(dbUserId: string) {
  await ensurePayLaterTables();
  const eligibility = await getPayLaterEligibility(dbUserId);
  const account = await getAccount(dbUserId);
  if (!account) {
    // Locked/pre-unlock riders still get the progress bar data.
    return { enrolled: false, mode: paymentsMode(), eligibility };
  }
  const openRides = await query<any>(
    `SELECT id, COALESCE(actual_fare, estimated_fare) AS fare,
            created_at, due_at, payment_status
       FROM rides
      WHERE passenger_id = $1 AND payment_method = 'pay_later'
      ORDER BY created_at DESC LIMIT 50`,
    [dbUserId]
  );
  return {
    enrolled: true,
    mode: paymentsMode(),
    account: {
      id: account.id,
      status: account.status,
      credit_limit: Number(account.credit_limit),
      outstanding: Number(account.outstanding),
      available: Math.max(
        0,
        Number(account.credit_limit) - Number(account.outstanding)
      ),
      account_number_masked: account.account_number_masked,
      bank_code: account.bank_code,
      card_token: account.card_token,
      terms_accepted_at: account.terms_accepted_at ?? null,
      auto_debit_enabled: !!account.auto_debit_enabled,
      auto_debit_consent_at: account.auto_debit_consent_at ?? null,
      repay_ride_count: Number(account.repay_ride_count || 0),
    },
    completed_rides: eligibility.rides_completed,
    rides: openRides,
    eligibility,
  };
}

export async function refreshPayLaterLimit(dbUserId: string) {
  await ensurePayLaterTables();
  const account = await getAccount(dbUserId);
  if (!account) throw new Error("You are not enrolled in Pay Later yet.");
  const rides = await countUnlockRides(dbUserId);
  const newLimit = computeCreditLimit(rides);
  const updated = await queryOne<any>(
    `UPDATE pay_later_accounts
        SET credit_limit = GREATEST(credit_limit, $2), updated_at = NOW()
      WHERE user_id = $1
      RETURNING *`,
    [dbUserId, newLimit]
  );
  return {
    account: {
      ...updated,
      available: Number(updated.credit_limit) - Number(updated.outstanding),
    },
    completed_rides: rides,
  };
}

// ── Repayments ────────────────────────────────────────────────────────────────

function newRepaymentReference(prefix = "PLR"): string {
  // Paystack reference charset: alphanumeric only (docs).
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

export interface RepayResult {
  success: boolean;
  status: "confirmed" | "pending";
  reference: string;
  amount: number;
  message?: string;
  account?: { credit_limit: number; outstanding: number; available: number };
}

/** Mock-only inline confirmation (no webhooks exist in PAYMENTS_MODE=mock). */
async function confirmInlineCredit(
  riderId: string,
  amountRands: number,
  reference: string,
  source: string
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO pay_later_ledger (rider_id, entry_type, amount, status, source, reference)
       VALUES ($1, 'credit', $2, 'confirmed', $3, $4)
       ON CONFLICT (reference) WHERE reference IS NOT NULL DO NOTHING
       RETURNING id`,
      [riderId, amountRands, source, reference]
    );
    if (ins?.rowCount) {
      await settleDebitsFifo(client, riderId, amountRands);
      await mirrorOutstanding(client, riderId);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * "Pay what I owe" — charges the rider's SAVED CARD (Paystack
 * charge_authorization) for `amountRands` (default: the full balance).
 *
 * Per the brief the LEDGER only changes when Paystack's webhook confirms:
 *   sandbox/live → charge accepted → credit row 'pending' → charge.success
 *                  webhook confirms it (confirmRepaymentReference);
 *   mock         → confirmed inline (no webhooks in mock);
 *   mock fail    → PAYMENTS_MOCK_FAIL_COLLECT=1 simulates a decline (the
 *                  dev switch the v1 tooling already used).
 * A repayment already awaiting its webhook blocks a second charge (no
 * double-tap, no manual-vs-auto race).
 */
export async function repayWithCard(
  dbUserId: string,
  opts: { amountRands?: number; rideId?: string | null } = {}
): Promise<RepayResult> {
  await ensurePayLaterTables();
  const account = await getAccount(dbUserId);
  if (!account || account.status !== "active") {
    throw new Error("Pay Later is not active on your account.");
  }

  const outstanding = await ledgerOutstanding(dbUserId);
  if (outstanding <= 0) {
    throw new Error("You have nothing owed right now.");
  }

  const pendingRef = await findPendingRepayment(dbUserId);
  if (pendingRef) {
    return {
      success: true,
      status: "pending",
      reference: pendingRef,
      amount: outstanding,
      message: "A repayment is already awaiting confirmation.",
    };
  }

  let amount: number;
  if (opts.rideId) {
    const open = await queryOne<{ remaining: number }>(
      `SELECT (amount - settled_amount)::float AS remaining
         FROM pay_later_ledger
        WHERE rider_id = $1 AND ride_id = $2 AND entry_type = 'debit' AND status = 'open'
        LIMIT 1`,
      [dbUserId, opts.rideId]
    );
    if (!open || Number(open.remaining) <= 0) {
      throw new Error("That ride is already settled.");
    }
    amount = Number(open.remaining);
  } else {
    amount =
      opts.amountRands != null && Number(opts.amountRands) > 0
        ? Number(opts.amountRands)
        : outstanding;
  }
  amount = Math.min(Math.round(amount * 100) / 100, outstanding);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Nothing to repay.");
  }

  const cardToken =
    account.card_token || (await getDefaultCardToken(dbUserId).catch(() => null))?.transaction_index;
  if (!cardToken && paymentsMode() !== "mock") {
    throw new Error("Add a saved card first — repayments charge your saved card.");
  }

  const reference = newRepaymentReference();
  const attemptNumber =
    ((
      await queryOne<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM payment_collections WHERE rider_id = $1",
        [dbUserId]
      )
    )?.n || 0) + 1;

  await execute(
    `INSERT INTO payment_collections (rider_id, ride_id, amount, attempt_number, result, provider, reference)
     VALUES ($1, $2, $3, $4, 'pending', 'paystack', $5)`,
    [dbUserId, opts.rideId || null, amount, attemptNumber, reference]
  ).catch(() => {});

  // ── mock: no webhooks exist — confirm (or fail) inline ──
  if (paymentsMode() === "mock") {
    if (process.env.PAYMENTS_MOCK_FAIL_COLLECT === "1") {
      await execute(
        `UPDATE payment_collections SET result = 'failed', reason = 'Mock repayment failed (insufficient funds)' WHERE reference = $1`,
        [reference]
      ).catch(() => {});
      throw new Error("Mock repayment failed (insufficient funds).");
    }
    await confirmInlineCredit(dbUserId, amount, reference, "manual_card");
    await execute(
      `UPDATE payment_collections SET result = 'success' WHERE reference = $1`,
      [reference]
    ).catch(() => {});
    const after = await ledgerOutstanding(dbUserId);
    return {
      success: true,
      status: "confirmed",
      reference,
      amount,
      message: "Balance repaid.",
      account: {
        credit_limit: Number(account.credit_limit),
        outstanding: after,
        available: Math.max(0, Number(account.credit_limit) - after),
      },
    };
  }

  // ── sandbox/live: charge the saved card, WAIT for the webhook to confirm ──
  const charge = await chargeAuthorization({
    amountRands: amount,
    reference,
    email: account.email || "rider@vura.com",
    authorizationCode: String(cardToken),
  });
  if (!charge.success) {
    await execute(
      `UPDATE payment_collections SET result = 'failed', reason = $2 WHERE reference = $1`,
      [reference, String(charge.message || "declined").slice(0, 255)]
    ).catch(() => {});
    throw new Error(charge.message || "Your card was declined.");
  }

  // Accepted by Paystack → credit row PENDING; charge.success confirms it
  // (unique reference makes webhook replays DB-level no-ops).
  await execute(
    `INSERT INTO pay_later_ledger (rider_id, ride_id, entry_type, amount, status, source, reference)
     VALUES ($1, NULL, 'credit', $2, 'pending', 'manual_card', $3)
     ON CONFLICT (reference) WHERE reference IS NOT NULL DO NOTHING`,
    [dbUserId, amount, reference]
  ).catch((e: any) => console.warn("[paylater] pending credit insert failed:", e?.message));

  return {
    success: true,
    status: "pending",
    reference,
    amount,
    message: "Waiting for your bank to confirm — your balance updates as soon as it does.",
  };
}

/**
 * Legacy per-ride repayment route (POST /pay-later/:rideId/pay) — kept for the
 * old screen, now charging the card through the SAME webhook-confirmed flow
 * (v1 used to decrement the balance without ever moving money).
 */
export async function payRideWithPayLater(dbUserId: string, rideId: string) {
  await ensurePayLaterTables();
  const ride = await queryOne<any>(
    `SELECT id, passenger_id, status, payment_status
       FROM rides WHERE id = $1 AND passenger_id = $2`,
    [rideId, dbUserId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.status !== "completed") throw new Error("This ride is not completed yet");
  if (String(ride.payment_status || "").toLowerCase() === "paid") {
    return { success: true, alreadyPaid: true };
  }
  const res = await repayWithCard(dbUserId, { rideId });
  return {
    success: res.success,
    status: res.status,
    reference: res.reference,
    amount_paid: res.status === "confirmed" ? res.amount : 0,
    message: res.message,
    account: res.account,
  };
}

/** Auto-debit toggle with explicit consent (brief: opt-in, revocable). */
export async function setPayLaterAutoDebit(dbUserId: string, enabled: boolean) {
  await ensurePayLaterTables();
  const account = await getAccount(dbUserId);
  if (!account) throw new Error("You are not enrolled in Ride Now, Pay Later yet.");
  if (enabled) {
    const hasCard =
      account.card_token || !!(await getDefaultCardToken(dbUserId).catch(() => null));
    if (!hasCard) {
      throw new Error("Add a saved card before turning auto-debit on.");
    }
    if (!account.terms_accepted_at) {
      throw new Error("Accept the Pay Later terms first.");
    }
  }
  const updated = await queryOne<any>(
    `UPDATE pay_later_accounts
        SET auto_debit_enabled = $2,
            auto_debit_consent_at = CASE WHEN $2 THEN COALESCE(auto_debit_consent_at, NOW()) ELSE NULL END,
            updated_at = NOW()
      WHERE user_id = $1
      RETURNING auto_debit_enabled, auto_debit_consent_at`,
    [dbUserId, enabled]
  );
  return {
    enabled: !!updated?.auto_debit_enabled,
    consent_at: updated?.auto_debit_consent_at ?? null,
  };
}

// ── Ride completion hooks (idempotent — safe on any/repeated completion path) ─

/**
 * Books the debt when a pay-later ride COMPLETES: one ledger debit (unique per
 * ride+source), mirror recompute, due date (month-end, like v1), ride marked
 * payment_status='pending'. Returns true when THIS call created the debit.
 */
export async function registerPayLaterDebit(rideId: string): Promise<boolean> {
  await ensurePayLaterTables();
  const ride = await queryOne<any>(
    `SELECT id, passenger_id, status, payment_method,
            COALESCE(NULLIF(actual_fare, 0), estimated_fare) AS fare
       FROM rides WHERE id = $1`,
    [rideId]
  );
  if (!ride || ride.status !== "completed") return false;
  if (String(ride.payment_method || "").toLowerCase() !== "pay_later") return false;
  const fare = Math.round(Number(ride.fare || 0) * 100) / 100;
  if (!Number.isFinite(fare) || fare <= 0) return false;
  const account = await getAccount(ride.passenger_id);
  if (!account) return false;

  const due = lastDayOfMonth();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO pay_later_ledger
         (rider_id, ride_id, entry_type, amount, status, source, due_at, terms_accepted_at)
       VALUES ($1, $2, 'debit', $3, 'open', 'ride', $4, $5)
       ON CONFLICT (ride_id, source) WHERE ride_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [ride.passenger_id, rideId, fare, due, account.terms_accepted_at || null]
    );
    if (!ins?.rowCount) {
      await client.query("COMMIT");
      return false; // already booked (re-fired completion)
    }
    await mirrorOutstanding(client, ride.passenger_id);
    await client.query(
      `UPDATE rides
          SET payment_status = 'pending', due_at = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'completed'
          AND COALESCE(payment_status, '') <> 'paid'`,
      [rideId, due]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ride-to-repay: every PAY_LATER_RIDES_TO_REPAY completed rides (while a
 * balance is owed) clears PAY_LATER_REPAY_PER_RIDE_R — a PART of the balance,
 * never the whole debt (the brief's assumption #2). Idempotent per ride via
 * the (ride_id, source) unique index; the cycle counter only advances when
 * this ride hasn't counted yet.
 */
export async function applyRideToRepay(rideId: string): Promise<void> {
  await ensurePayLaterTables();
  const cfg = payLaterConfig();
  const ride = await queryOne<any>(
    `SELECT id, passenger_id, status FROM rides WHERE id = $1`,
    [rideId]
  );
  if (!ride || ride.status !== "completed") return;
  const account = await getAccount(ride.passenger_id);
  if (!account || account.status !== "active") return;
  const outstanding = await ledgerOutstanding(ride.passenger_id);
  if (outstanding <= 0) return;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const already = await client.query(
      `SELECT id FROM pay_later_ledger
        WHERE ride_id = $1 AND source = 'ride_to_repay' LIMIT 1`,
      [rideId]
    );
    if (already?.rowCount) {
      await client.query("COMMIT");
      return; // this ride already counted
    }
    const next = Number(account.repay_ride_count || 0) + 1;
    if (next >= cfg.ridesToRepay) {
      const amount = Math.min(cfg.repayPerRideR, outstanding);
      const ins = await client.query(
        `INSERT INTO pay_later_ledger (rider_id, ride_id, entry_type, amount, status, source)
         VALUES ($1, $2, 'credit', $3, 'confirmed', 'ride_to_repay')
         ON CONFLICT (ride_id, source) WHERE ride_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [ride.passenger_id, rideId, amount]
      );
      if (ins?.rowCount) {
        await settleDebitsFifo(client, ride.passenger_id, amount);
        await mirrorOutstanding(client, ride.passenger_id);
        await client.query(
          `UPDATE pay_later_accounts SET repay_ride_count = 0, updated_at = NOW() WHERE user_id = $1`,
          [ride.passenger_id]
        );
      }
    } else {
      await client.query(
        `UPDATE pay_later_accounts SET repay_ride_count = $2, updated_at = NOW() WHERE user_id = $1`,
        [ride.passenger_id, next]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Single completion entry point — call from every ride-completion path.
 *  Fire-and-forget safe: never breaks the completion itself. */
export async function onRideCompletedPayLater(rideId: string): Promise<void> {
  await registerPayLaterDebit(rideId);
  await applyRideToRepay(rideId);
}

// ── Dev helper (mock only): mark a completed ride as a pay-later ride ────────

export async function simulatePayLaterRide(dbUserId: string, rideId: string) {
  await ensurePayLaterTables();
  const account = await getAccount(dbUserId);
  if (!account || account.status !== "active") {
    throw new Error("Pay Later is not active on your account.");
  }
  const ride = await queryOne<any>(
    `SELECT id, passenger_id, status FROM rides WHERE id = $1 AND passenger_id = $2`,
    [rideId, dbUserId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.status !== "completed") throw new Error("Only completed rides can be pay-later");

  // Flip the ride to pay_later FIRST, then run the REAL completion hook so the
  // dev path exercises exactly the production ledger code (one debit, mirror).
  await execute(
    `UPDATE rides SET payment_method = 'pay_later' WHERE id = $1 AND passenger_id = $2`,
    [rideId, dbUserId]
  );
  const booked = await registerPayLaterDebit(rideId);
  const updated = await getAccount(dbUserId);
  const due = await queryOne<{ due_at: Date | null }>(
    `SELECT due_at FROM pay_later_ledger WHERE ride_id = $1 AND entry_type = 'debit'`,
    [rideId]
  );
  return {
    rideId,
    booked,
    due_at: due?.due_at ?? lastDayOfMonth().toISOString(),
    account: {
      credit_limit: Number(updated.credit_limit),
      outstanding: Number(updated.outstanding),
      available: Number(updated.credit_limit) - Number(updated.outstanding),
    },
  };
}

// ── Auto-debit worker (due dates + optional threshold) ────────────────────────

export interface CollectionSummary {
  attempted: number;
  succeeded: number;
  pending: number;
  failed: number;
  overdue: number;
  details: { rideId: string | null; attempt: number; result: string; overdue: boolean }[];
}

/**
 * Charges consented riders' saved cards for what they owe, on their due date:
 *   • EVERY attempt is logged (payment_collections, provider='paystack') — brief;
 *   • retries follow PAY_LATER_RETRY_DAYS after the due date (day 1/3/7 by
 *     default — configurable, bounded: after the last retry fails the account
 *     goes overdue → frozen + identity-blacklisted (v1 safety policy) and the
 *     rider is PUSH-notified;
 *   • success = charge accepted → PENDING credit; the charge.success WEBHOOK
 *     confirms it into the ledger (never the API call itself);
 *   • a pending repayment blocks another charge (no double-debits);
 *   • auto-debit requires the rider's opt-in consent (auto_debit_enabled).
 */
export async function runMonthlyCollection(): Promise<CollectionSummary> {
  await ensurePayLaterTables();
  const cfg = payLaterConfig();
  const summary: CollectionSummary = {
    attempted: 0,
    succeeded: 0,
    pending: 0,
    failed: 0,
    overdue: 0,
    details: [],
  };

  const dueDebits = await query<any>(
    `SELECT id AS debit_id, rider_id, ride_id, due_at, (amount - settled_amount)::float AS remaining
       FROM pay_later_ledger
      WHERE entry_type = 'debit' AND status = 'open'
        AND due_at IS NOT NULL AND due_at <= NOW()
      ORDER BY created_at ASC`
  );

  for (const debit of dueDebits || []) {
    const account = await getAccount(debit.rider_id);
    if (!account || account.status !== "active") continue;
    if (!account.auto_debit_enabled) continue; // consent required (brief)
    if (await findPendingRepayment(debit.rider_id)) continue; // one in flight

    const attempts =
      ((
        await queryOne<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM payment_collections WHERE ride_id = $1",
          [debit.ride_id]
        )
      )?.n || 0);
    if (attempts >= cfg.retryDays.length) continue; // schedule exhausted (frozen on the last failure)
    const daysSinceDue = Math.floor(
      (Date.now() - new Date(debit.due_at).getTime()) / 86_400_000
    );
    if (daysSinceDue < cfg.retryDays[attempts]) continue; // not time for this retry yet

    const attemptNumber = attempts + 1;
    const amount = Math.round(Number(debit.remaining) * 100) / 100;
    if (!(amount > 0)) continue;
    summary.attempted++;

    const cardToken =
      account.card_token ||
      (await getDefaultCardToken(debit.rider_id).catch(() => null))?.transaction_index;
    const reference = newRepaymentReference("PLRAUTO");
    await execute(
      `INSERT INTO payment_collections (rider_id, ride_id, amount, attempt_number, result, provider, reference)
       VALUES ($1, $2, $3, $4, 'pending', 'paystack', $5)`,
      [debit.rider_id, debit.ride_id, amount, attemptNumber, reference]
    ).catch(() => {});

    const finishAttempt = async (result: string, reason?: string) => {
      await execute(
        `UPDATE payment_collections SET result = $2, reason = $3 WHERE reference = $1`,
        [reference, result, reason ? String(reason).slice(0, 255) : null]
      ).catch(() => {});
    };

    // ── charge ──
    let accepted = false;
    let failReason = "";
    if (paymentsMode() === "mock") {
      accepted = process.env.PAYMENTS_MOCK_FAIL_COLLECT !== "1";
      if (!accepted) failReason = "Mock collection failed (insufficient funds)";
    } else if (!cardToken) {
      failReason = "No saved card on file";
    } else {
      try {
        const charge = await chargeAuthorization({
          amountRands: amount,
          reference,
          email: account.email || "rider@vura.com",
          authorizationCode: String(cardToken),
        });
        accepted = charge.success;
        if (!accepted) failReason = charge.message || "declined";
      } catch (e: any) {
        failReason = e?.message || "charge error";
      }
    }

    if (accepted) {
      if (paymentsMode() === "mock") {
        await confirmInlineCredit(debit.rider_id, amount, reference, "auto_debit");
        await finishAttempt("success");
        summary.succeeded++;
        summary.details.push({ rideId: debit.ride_id, attempt: attemptNumber, result: "success", overdue: false });
      } else {
        // Real rail: PENDING until the charge.success webhook confirms it.
        await execute(
          `INSERT INTO pay_later_ledger (rider_id, ride_id, entry_type, amount, status, source, reference)
           VALUES ($1, NULL, 'credit', $2, 'pending', 'auto_debit', $3)
           ON CONFLICT (reference) WHERE reference IS NOT NULL DO NOTHING`,
          [debit.rider_id, amount, reference]
        ).catch(() => {});
        summary.pending++;
        summary.details.push({ rideId: debit.ride_id, attempt: attemptNumber, result: "pending", overdue: false });
      }
      continue;
    }

    // ── failed attempt ──
    await finishAttempt("failed", failReason);
    summary.failed++;
    const isFinalAttempt = attemptNumber >= cfg.retryDays.length;
    summary.details.push({ rideId: debit.ride_id, attempt: attemptNumber, result: "failed", overdue: isFinalAttempt });

    await sendPushToUsers([debit.rider_id], {
      type: "pay_later",
      title: "Repayment failed",
      body: `We couldn't collect R${amount.toFixed(2)} (attempt ${attemptNumber} of ${cfg.retryDays.length}): ${failReason}. Please repay from your wallet.`,
    }).catch(() => {});

    if (isFinalAttempt) {
      // Schedule exhausted → overdue + freeze + blacklist (v1 safety policy).
      if (debit.ride_id) {
        await execute(`UPDATE rides SET payment_status = 'overdue' WHERE id = $1`, [
          debit.ride_id,
        ]).catch(() => {});
      }
      await execute(
        `UPDATE pay_later_accounts SET status = 'frozen', updated_at = NOW() WHERE user_id = $1`,
        [debit.rider_id]
      ).catch(() => {});
      if (account.identity_fingerprint) {
        await execute(
          `INSERT INTO pay_later_blacklist (identity_fingerprint, reason)
           VALUES ($1, $2) ON CONFLICT (identity_fingerprint) DO NOTHING`,
          [account.identity_fingerprint, "Pay Later collection failed after multiple attempts"]
        ).catch(() => {});
      }
      summary.overdue++;
      await sendPushToUsers([debit.rider_id], {
        type: "pay_later",
        title: "Pay Later paused",
        body: "Your balance is past due after several failed attempts. Repay to keep using Ride Now, Pay Later.",
      }).catch(() => {});
    }
  }

  // ── Threshold auto-debit (brief: "…on a set date OR when the balance
  // reaches a threshold") — consented riders whose WHOLE balance crossed
  // PAY_LATER_AUTO_DEBIT_THRESHOLD_R, independent of any due date. Failures
  // here notify + are logged but never freeze (freezing belongs to the
  // due-date schedule above), and attempts are bounded the same way.
  if (cfg.autoDebitThresholdR > 0) {
    const riders = await query<{ user_id: string; outstanding: number }>(
      `SELECT user_id, outstanding::float AS outstanding
         FROM pay_later_accounts
        WHERE status = 'active' AND auto_debit_enabled
          AND outstanding >= $1`,
      [String(cfg.autoDebitThresholdR)]
    ).catch(() => []);
    for (const r of riders || []) {
      if (await findPendingRepayment(r.user_id)) continue;
      const attempts =
        ((
          await queryOne<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM payment_collections
              WHERE rider_id = $1 AND ride_id IS NULL`,
            [r.user_id]
          )
        )?.n || 0);
      if (attempts >= cfg.retryDays.length) continue;
      const account = await getAccount(r.user_id);
      if (!account) continue;
      const amount = Math.round(Number(r.outstanding) * 100) / 100;
      if (!(amount > 0)) continue;
      const cardToken =
        account.card_token || (await getDefaultCardToken(r.user_id).catch(() => null))?.transaction_index;
      const reference = newRepaymentReference("PLRAUTO");
      const attemptNumber = attempts + 1;
      await execute(
        `INSERT INTO payment_collections (rider_id, ride_id, amount, attempt_number, result, provider, reference)
         VALUES ($1, NULL, $2, $3, 'pending', 'paystack', $4)`,
        [r.user_id, amount, attemptNumber, reference]
      ).catch(() => {});
      summary.attempted++;

      let accepted = false;
      let failReason = "";
      if (paymentsMode() === "mock") {
        accepted = process.env.PAYMENTS_MOCK_FAIL_COLLECT !== "1";
        if (!accepted) failReason = "Mock collection failed (insufficient funds)";
      } else if (!cardToken) {
        failReason = "No saved card on file";
      } else {
        try {
          const charge = await chargeAuthorization({
            amountRands: amount,
            reference,
            email: account.email || "rider@vura.com",
            authorizationCode: String(cardToken),
          });
          accepted = charge.success;
          if (!accepted) failReason = charge.message || "declined";
        } catch (e: any) {
          failReason = e?.message || "charge error";
        }
      }

      if (accepted) {
        if (paymentsMode() === "mock") {
          await confirmInlineCredit(r.user_id, amount, reference, "auto_debit");
          await execute(
            `UPDATE payment_collections SET result = 'success' WHERE reference = $1`,
            [reference]
          ).catch(() => {});
          summary.succeeded++;
        } else {
          await execute(
            `INSERT INTO pay_later_ledger (rider_id, ride_id, entry_type, amount, status, source, reference)
             VALUES ($1, NULL, 'credit', $2, 'pending', 'auto_debit', $3)
             ON CONFLICT (reference) WHERE reference IS NOT NULL DO NOTHING`,
            [r.user_id, amount, reference]
          ).catch(() => {});
          summary.pending++;
        }
        summary.details.push({ rideId: null, attempt: attemptNumber, result: "accepted", overdue: false });
      } else {
        await execute(
          `UPDATE payment_collections SET result = 'failed', reason = $2 WHERE reference = $1`,
          [reference, String(failReason || "failed").slice(0, 255)]
        ).catch(() => {});
        summary.failed++;
        await sendPushToUsers([r.user_id], {
          type: "pay_later",
          title: "Repayment failed",
          body: `We couldn't collect your balance of R${amount.toFixed(2)}: ${failReason}. Please repay from your wallet.`,
        }).catch(() => {});
        summary.details.push({ rideId: null, attempt: attemptNumber, result: "failed", overdue: false });
      }
    }
  }

  return summary;
}


// ── Webhook entry (charge.* for PLR repayments) ───────────────────────────────

export interface PayLaterWebhookResult {
  received: true;
  event: string;
  duplicate: boolean;
  handled: boolean;
  detail?: string;
}

/**
 * charge.success / charge.failed for PLR* references (manual + auto
 * repayments). Routed from routes/paystackWebhook.ts — the same
 * signature-verified pipe as the preauthorization events. Idempotency:
 * paystack_webhook_events PK (shared via recordWebhookEventOnce) + the credit
 * row's unique reference + guarded pending→confirmed/failed UPDATEs.
 * Other charge.* references (card registration, legacy ride charges) are
 * acknowledged but ignored.
 */
export async function handlePayLaterChargeWebhook(
  event: string,
  payload: any
): Promise<PayLaterWebhookResult> {
  const data = payload?.data ?? {};
  const reference = String(data.reference || "");
  const done = (duplicate: boolean, handled: boolean, detail?: string): PayLaterWebhookResult => ({
    received: true,
    event,
    duplicate,
    handled,
    detail,
  });
  if (!reference.startsWith("PLR")) {
    return done(false, false, "not a pay-later repayment reference");
  }
  const fresh = await recordWebhookEventOnce(event, data, reference);
  if (!fresh) return done(true, false, "duplicate delivery ignored");

  if (event === "charge.success") {
    const res = await confirmRepaymentReference(reference);
    return done(false, res.confirmed, res.confirmed ? `confirmed R${res.amount}` : res.detail);
  }
  if (event === "charge.failed") {
    const reason = String(data.message || data.gateway_response || "declined");
    const res = await markRepaymentFailed(reference, reason);
    return done(false, res.failed, `failed: ${reason}`);
  }
  return done(false, false, `unhandled charge event ${event}`);
}

// ── Worker ────────────────────────────────────────────────────────────────────

let workerTimer: NodeJS.Timeout | null = null;

/**
 * Scheduled auto-debit pass (repayment option b): runs the collection job
 * every PAY_LATER_WORKER_INTERVAL_MS (default 6h) + once shortly after boot
 * (catch-up after deploys/restarts, same pattern as cleanupStaleRides).
 */
export function startPayLaterWorker(): NodeJS.Timeout {
  if (workerTimer) return workerTimer;
  workerTimer = setInterval(() => {
    void runMonthlyCollection()
      .then((s) => {
        if (s.attempted > 0) {
          console.log(
            `[paylater] collection pass: attempted=${s.attempted} pending=${s.pending} succeeded=${s.succeeded} failed=${s.failed} overdue=${s.overdue}`
          );
        }
      })
      .catch((err) => console.warn("[paylater] collection pass failed:", err?.message || err));
  }, payLaterConfig().workerIntervalMs);
  workerTimer.unref?.();
  const catchUp = setTimeout(() => {
    void runMonthlyCollection().catch(() => {});
  }, 120_000);
  catchUp.unref?.();
  return workerTimer;
}

export function stopPayLaterWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}















