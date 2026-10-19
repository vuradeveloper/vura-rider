// ─────────────────────────────────────────────────────────────────────────────
// DRIVER WALLET — the commission spec (§1–§6):
//   • 10% commission on every completed ride (configurable), split internally
//     into Paystack fee / VAT / platform margin (records only — the driver
//     sees ONE commission figure);
//   • card & Pay-Later rides credit fare−10% to the wallet ONLY after the
//     Paystack capture webhook confirms (pending → posted);
//   • cash rides debit the 10% immediately — the wallet may go NEGATIVE;
//   • later card credits simply sum on top, so a negative balance clears
//     first (arithmetic, not a special case);
//   • below the negative limit CASH rides cannot be accepted (card stays
//     open so the driver can recover);
//   • cents (integers) everywhere; mutations idempotent (UNIQUE ride_id+type
//     + status guards) so a duplicate webhook can never double-pay.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute } from "../config/database";

export interface WalletConfig {
  /** Platform commission on the fare, percent (spec default 10). */
  commission_pct: number;
  /** VAT slice INSIDE the commission, percent of the commission (SA 15). */
  vat_pct: number;
  /** Fallback Paystack fee, percent of fare — used when the webhook omits it. */
  paystack_fee_fallback_pct: number;
  /** Cash rides are blocked once the balance is BELOW -limit (rands). */
  negative_limit_rand: number;
}

export const DEFAULT_WALLET_CONFIG: WalletConfig = {
  commission_pct: 10,
  vat_pct: 15,
  paystack_fee_fallback_pct: 1.5,
  negative_limit_rand: 200,
};

const CONFIG_BOUNDS: Record<keyof WalletConfig, [number, number]> = {
  commission_pct: [0, 50],
  vat_pct: [0, 30],
  paystack_fee_fallback_pct: [0, 5],
  negative_limit_rand: [0, 10000],
};

export function toCents(rands: number): number {
  return Math.round((Number(rands) || 0) * 100);
}

export function toRands(cents: number): number {
  return Math.round(Number(cents) || 0) / 100;
}

/** Cash rides blocked at exactly this balance threshold (cents). */
export function cashBlockThresholdCents(cfg: WalletConfig): number {
  return -toCents(cfg.negative_limit_rand);
}

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS wallet_config (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by UUID)`,
  `CREATE TABLE IF NOT EXISTS driver_wallets (driver_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, balance_cents BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS wallet_ledger (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, ride_id UUID REFERENCES rides(id) ON DELETE SET NULL, type TEXT NOT NULL CHECK (type IN ('card_credit_pending','card_credit','commission_debit','reversal','payout','adjustment')), amount_cents BIGINT NOT NULL, balance_after_cents BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','void')), paystack_fee_cents BIGINT NOT NULL DEFAULT 0, vat_cents BIGINT NOT NULL DEFAULT 0, margin_cents BIGINT NOT NULL DEFAULT 0, commission_cents BIGINT NOT NULL DEFAULT 0, ledger_ref_id UUID REFERENCES wallet_ledger(id), payout_id UUID, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (ride_id, type))`,
  `CREATE INDEX IF NOT EXISTS idx_wallet_ledger_driver ON wallet_ledger (driver_id, created_at DESC)`,
];

let ensured = false;
export async function ensureWalletTables(): Promise<void> {
  if (ensured) return;
  for (const ddl of DDL) await execute(ddl).catch(() => { /* pre-existing */ });
  ensured = true;
}

/** Stored config merged over defaults — never throws. */
export async function getWalletConfig(): Promise<WalletConfig> {
  try {
    await ensureWalletTables();
    const row = await queryOne<{ value: unknown }>(
      "SELECT value FROM wallet_config WHERE key = 'settings'"
    );
    const stored = (row?.value ?? {}) as Record<string, unknown>;
    const merged: Record<string, number> = { ...DEFAULT_WALLET_CONFIG };
    for (const k of Object.keys(DEFAULT_WALLET_CONFIG) as (keyof WalletConfig)[]) {
      const v = Number(stored[k]);
      const [min, max] = CONFIG_BOUNDS[k];
      if (Number.isFinite(v) && v >= min && v <= max) merged[k] = v;
    }
    return merged as unknown as WalletConfig;
  } catch {
    return { ...DEFAULT_WALLET_CONFIG };
  }
}

/** Validate + persist (console-tunable). Throws on bad input. */
export async function putWalletConfig(
  patch: Partial<WalletConfig>,
  actorId?: string | null
): Promise<WalletConfig> {
  const next: Record<string, number> = { ...(await getWalletConfig()) };
  for (const [k, raw] of Object.entries(patch)) {
    if (!(k in DEFAULT_WALLET_CONFIG)) throw new Error(`Unknown wallet setting: ${k}`);
    const v = Number(raw);
    const [min, max] = CONFIG_BOUNDS[k as keyof WalletConfig];
    if (!Number.isFinite(v) || v < min || v > max) {
      throw new Error(`${k} must be between ${min} and ${max}`);
    }
    next[k] = Math.round(v * 100) / 100;
  }
  await ensureWalletTables();
  await execute(
    `INSERT INTO wallet_config (key, value, updated_at, updated_by)
     VALUES ('settings', $1::jsonb, NOW(), $2)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW(), updated_by = $2`,
    [JSON.stringify(next), actorId ?? null]
  );
  return next as unknown as WalletConfig;
}

export interface CommissionSplit {
  fare_cents: number;
  commission_cents: number;
  vat_cents: number;
  paystack_fee_cents: number;
  margin_cents: number;
  /** What the driver earns (the card credit / ride net). */
  net_cents: number;
}

/**
 * The 10% split (pure — unit-tested). Commission is VAT-INCLUSIVE (SA model):
 * the VAT slice is carved OUT of our commission, never added on top of the
 * driver. The Paystack fee is also paid from our commission (assumption A);
 * margin is whatever remains — recorded honestly even when ≤ 0 on tiny fares.
 */
export function commissionSplit(
  fareRands: number,
  cfg: WalletConfig,
  paystackFeeCents?: number | null
): CommissionSplit {
  const fare = Math.max(0, toCents(fareRands));
  const commission = Math.round((fare * cfg.commission_pct) / 100);
  const vat = Math.round((commission * cfg.vat_pct) / (100 + cfg.vat_pct));
  const feeFallback = Math.round((fare * cfg.paystack_fee_fallback_pct) / 100);
  const fee =
    paystackFeeCents != null && Number.isFinite(paystackFeeCents) && paystackFeeCents >= 0
      ? Math.round(paystackFeeCents)
      : Math.min(feeFallback, commission);
  const margin = commission - vat - fee;
  return {
    fare_cents: fare,
    commission_cents: commission,
    vat_cents: vat,
    paystack_fee_cents: fee,
    margin_cents: margin,
    net_cents: fare - commission,
  };
}

// ── Balance mutations (atomic deltas; the ledger keeps balance_after) ────────

async function applyDeltaCents(
  driverId: string,
  deltaCents: number
): Promise<number> {
  await execute(
    `INSERT INTO driver_wallets (driver_id, balance_cents) VALUES ($1, 0)
     ON CONFLICT (driver_id) DO NOTHING`,
    [driverId]
  ).catch(() => { });
  const row = await queryOne<{ balance_cents: number }>(
    `UPDATE driver_wallets
        SET balance_cents = balance_cents + $2, updated_at = NOW()
      WHERE driver_id = $1
      RETURNING balance_cents`,
    [driverId, Math.round(deltaCents)]
  );
  return Number(row?.balance_cents ?? 0);
}

/** True when the wallet ledger exists (migration ran / self-heal created it). */
export async function walletLedgerReady(): Promise<boolean> {
  try {
    await ensureWalletTables();
    await queryOne("SELECT 1 FROM wallet_ledger LIMIT 1");
    return true;
  } catch {
    return false;
  }
}

/** The driver's balance in cents (0 when no wallet row yet). */
export async function getBalanceCents(driverId: string): Promise<number> {
  try {
    await ensureWalletTables();
    const row = await queryOne<{ balance_cents: number }>(
      "SELECT balance_cents FROM driver_wallets WHERE driver_id = $1",
      [driverId]
    ).catch(() => null);
    return Number(row?.balance_cents ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Cash rides blocked below the configured negative limit; card rides are
 * ALWAYS allowed (they are how the driver recovers). Pure-ish decision used
 * by acceptRide AND covered by unit tests.
 */
export function cashRideBlocked(
  balanceCents: number,
  cfg: WalletConfig
): boolean {
  return balanceCents < cashBlockThresholdCents(cfg);
}

/**
 * Ride completion entry — THE hook the completion handler calls.
 *   • card / pay_later → card_credit_pending (+net), waits for the webhook;
 *   • cash             → commission_debit (−commission), posted now.
 * Idempotent: the (ride_id, type) unique makes a re-fired completion a no-op.
 * Also keeps driver_earnings truthful for the admin Money screen (gross /
 * real commission as fee / net).
 */
export async function recordRideCompletion(
  driverId: string,
  rideId: string,
  fareRands: number,
  paymentMethod: string,
  paystackFeeCents?: number | null
): Promise<void> {
  await ensureWalletTables();
  const cfg = await getWalletConfig();
  const split = commissionSplit(fareRands, cfg, paystackFeeCents);
  const platformPaid = ["card", "pay_later"].includes(
    String(paymentMethod || "").trim().toLowerCase()
  );

  // Admin screen truth: one row per ride, real fee/net (upsert — legacy rows
  // had fee=0, net=fare).
  await execute(
    `INSERT INTO driver_earnings (driver_id, ride_id, gross_amount, fee, net_amount)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ride_id) DO UPDATE
       SET fee = EXCLUDED.fee, net_amount = EXCLUDED.net_amount`,
    [driverId, rideId, toRands(split.fare_cents), toRands(split.commission_cents), toRands(split.net_cents)]
  ).catch(async () => {
    // Older schemas may lack a unique on ride_id — fall back to plain insert-if-absent.
    const exists = await queryOne<{ id: string }>(
      "SELECT id FROM driver_earnings WHERE ride_id = $1 LIMIT 1",
      [rideId]
    ).catch(() => null);
    if (!exists) {
      await execute(
        `INSERT INTO driver_earnings (driver_id, ride_id, gross_amount, fee, net_amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [driverId, rideId, toRands(split.fare_cents), toRands(split.commission_cents), toRands(split.net_cents)]
      ).catch(() => { });
    }
  });

  const type = platformPaid ? "card_credit_pending" : "commission_debit";
  const amount = platformPaid ? split.net_cents : -split.commission_cents;

  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM wallet_ledger WHERE ride_id = $1 AND type = $2",
    [rideId, type]
  ).catch(() => null);
  if (existing) return; // idempotent

  const pendingStatus = platformPaid ? "pending" : "posted";
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO wallet_ledger
       (driver_id, ride_id, type, amount_cents, status,
        paystack_fee_cents, vat_cents, margin_cents, commission_cents, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (ride_id, type) DO NOTHING
     RETURNING id`,
    [driverId, rideId, type, amount, pendingStatus,
     split.paystack_fee_cents, split.vat_cents, split.margin_cents,
     split.commission_cents, `fare ${toRands(split.fare_cents).toFixed(2)} · commission ${split.commission_cents}c`]
  ).catch(() => null);
  if (!inserted) return; // lost the idempotency race — someone else posted it

  // Only posted entries move the balance (pending waits for Paystack) —
  // and the ledger row records what the driver holds AFTER this ride.
  if (!platformPaid) {
    const after = await applyDeltaCents(driverId, amount);
    await execute("UPDATE wallet_ledger SET balance_after_cents = $2 WHERE id = $1", [
      inserted.id,
      after,
    ]).catch(() => { });
  }
}

/**
 * THE webhook confirm (preauthorization.capture.success): promote the ride's
 * pending card credit to posted and move the money. Idempotent — the
 * `WHERE status = 'pending'` guard makes a duplicate delivery a no-op, and a
 * ride whose entry is missing (legacy, captured without completion) posts a
 * catch-up credit so the driver is never under-paid.
 */
export async function confirmCardRideCredit(
  driverId: string,
  rideId: string,
  paystackFeeCents?: number | null
): Promise<void> {
  await ensureWalletTables();

  // Enrich the split with Paystack's REAL fee when the webhook carries it.
  if (paystackFeeCents != null && Number.isFinite(paystackFeeCents) && paystackFeeCents >= 0) {
    await execute(
      `UPDATE wallet_ledger
          SET paystack_fee_cents = $2,
              margin_cents = commission_cents - vat_cents - $2
        WHERE ride_id = $1 AND type = 'card_credit_pending' AND status = 'pending'`,
      [rideId, Math.round(paystackFeeCents)]
    ).catch(() => { });
  }

  const promoted = await queryOne<{ id: string; driver_id: string; amount_cents: number }>(
    `UPDATE wallet_ledger
        SET status = 'posted', type = 'card_credit'
      WHERE ride_id = $1 AND type = 'card_credit_pending' AND status = 'pending'
      RETURNING id, driver_id, amount_cents`,
    [rideId]
  ).catch(() => null);
  if (promoted) {
    const after = await applyDeltaCents(promoted.driver_id, Number(promoted.amount_cents));
    await execute("UPDATE wallet_ledger SET balance_after_cents = $2 WHERE id = $1", [
      promoted.id, after,
    ]).catch(() => { });
    return;
  }

  // Already posted (duplicate webhook) → nothing to do.
  const already = await queryOne<{ id: string }>(
    "SELECT id FROM wallet_ledger WHERE ride_id = $1 AND type = 'card_credit'",
    [rideId]
  ).catch(() => null);
  if (already) return;

  // Deliberately VOIDED credit (cancelled ride) → never resurrect it.
  const voided = await queryOne<{ id: string }>(
    "SELECT id FROM wallet_ledger WHERE ride_id = $1 AND type = 'card_credit_pending' AND status = 'void'",
    [rideId]
  ).catch(() => null);
  if (voided) return;

  // Catch-up credit for captures that arrive without a pending row.
  const fare = await queryOne<{ fare: number | null; driver_id: string | null }>(
    `SELECT COALESCE(captured_amount, actual_fare, estimated_fare, 0)::float AS fare, driver_id
       FROM rides WHERE id = $1`,
    [rideId]
  ).catch(() => null);
  if (!fare?.driver_id) return;
  const cfg = await getWalletConfig();
  const split = commissionSplit(Number(fare.fare || 0), cfg, paystackFeeCents);
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO wallet_ledger
       (driver_id, ride_id, type, amount_cents, status, paystack_fee_cents, vat_cents,
        margin_cents, commission_cents, note)
     VALUES ($1, $2, 'card_credit', $3, 'posted', $4, $5, $6, $7, 'webhook catch-up credit')
     ON CONFLICT (ride_id, type) DO NOTHING
     RETURNING id`,
    [fare.driver_id, rideId, split.net_cents, split.paystack_fee_cents, split.vat_cents,
     split.margin_cents, split.commission_cents]
  ).catch(() => null);
  if (!inserted) return;
  const after = await applyDeltaCents(fare.driver_id, split.net_cents);
  await execute("UPDATE wallet_ledger SET balance_after_cents = $2 WHERE id = $1", [
    inserted.id, after,
  ]).catch(() => { });
}

/**
 * The ride ended WITHOUT completing (cancelled / capture failed / refunded):
 * void a pending card credit; reverse already-posted ride entries ONCE
 * (append-only audit — reversals reference the original rows).
 */
export async function closeRideWalletEntries(
  rideId: string,
  reason: string
): Promise<void> {
  await ensureWalletTables();
  await execute(
    `UPDATE wallet_ledger SET status = 'void'
      WHERE ride_id = $1 AND type = 'card_credit_pending' AND status = 'pending'`,
    [rideId]
  ).catch(() => { });

  const posted = await query<{ id: string; driver_id: string; amount_cents: number }>(
    `SELECT id, driver_id, amount_cents FROM wallet_ledger
      WHERE ride_id = $1 AND status = 'posted'
        AND type IN ('card_credit', 'commission_debit')`,
    [rideId]
  ).catch(() => []);
  for (const entry of posted) {
    const rev = await queryOne<{ id: string }>(
      `INSERT INTO wallet_ledger
         (driver_id, ride_id, type, amount_cents, status, ledger_ref_id, note, balance_after_cents)
       VALUES ($1, $2, 'reversal', $3, 'posted', $4, $5, 0)
       ON CONFLICT (ride_id, type) DO NOTHING
       RETURNING id`,
      [entry.driver_id, rideId, -Number(entry.amount_cents), entry.id, `reversed: ${reason}`]
    ).catch(() => null);
    if (!rev) continue; // already reversed — idempotent
    const after = await applyDeltaCents(entry.driver_id, -Number(entry.amount_cents));
    await execute("UPDATE wallet_ledger SET balance_after_cents = $2 WHERE id = $1", [
      rev.id, after,
    ]).catch(() => { });
  }
}

/** Successful payout → posted ledger debit (idempotent per payout id). */
export async function recordPayoutDebit(
  driverId: string,
  payoutId: string,
  amountRands: number
): Promise<void> {
  await ensureWalletTables();
  const cents = -Math.max(0, toCents(amountRands));
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM wallet_ledger WHERE payout_id = $1 AND type = 'payout'",
    [payoutId]
  ).catch(() => null);
  if (existing) return;
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO wallet_ledger (driver_id, type, amount_cents, status, payout_id, note)
     VALUES ($1, 'payout', $2, 'posted', $3, 'cash-out')
     RETURNING id`,
    [driverId, cents, payoutId]
  ).catch(() => null);
  if (!inserted) return;
  const after = await applyDeltaCents(driverId, cents);
  await execute("UPDATE wallet_ledger SET balance_after_cents = $2 WHERE id = $1", [
    inserted.id, after,
  ]).catch(() => { });
}

export interface WalletViewEntry {
  id: string;
  ride_id: string | null;
  type: string;
  status: string;
  amount_cents: number;
  balance_after_cents: number;
  commission_cents: number;
  // The inner split of that commission — what the driver asked to see per
  // ride: Paystack's cut, the VAT slice and the platform's margin (all parts
  // OF the commission, never on top of the driver).
  paystack_fee_cents: number;
  vat_cents: number;
  margin_cents: number;
  created_at: string;
  payment_method: string | null;
  fare_rands: number | null;
}

/** Balance + the ride list the driver's wallet page renders (§5). */
export async function getWalletView(driverId: string): Promise<{
  balance_cents: number;
  commission_pct: number;
  entries: WalletViewEntry[];
}> {
  await ensureWalletTables();
  const cfg = await getWalletConfig();
  const balance = await getBalanceCents(driverId);
  const entries = await query<WalletViewEntry>(
    `SELECT wl.id, wl.ride_id, wl.type, wl.status, wl.amount_cents,
            wl.balance_after_cents, wl.commission_cents,
            wl.paystack_fee_cents, wl.vat_cents, wl.margin_cents,
            wl.created_at,
            LOWER(COALESCE(r.payment_method, '')) AS payment_method,
            COALESCE(r.actual_fare, r.estimated_fare, 0)::float AS fare_rands
       FROM wallet_ledger wl
       LEFT JOIN rides r ON r.id = wl.ride_id
      WHERE wl.driver_id = $1 AND wl.status <> 'void'
      ORDER BY wl.created_at DESC
      LIMIT 150`,
    [driverId]
  ).catch(() => []);
  return { balance_cents: balance, commission_pct: cfg.commission_pct, entries };
}

/**
 * Backfill — seed the ledger from completed rides for drivers who predate
 * the wallet. Idempotent: a driver who already has ONE ledger row is never
 * re-seeded (that is the whole guard — rerunning can't double-credit).
 */
export async function backfillDriverLedger(driverId: string): Promise<void> {
  await ensureWalletTables();
  // Once the driver has ANY ledger row we are post-wallet — seeding is a
  // one-time event per driver (per-ride UNIQUE backs it up as well), so this
  // costs one cheap SELECT on every subsequent completion.
  const seeded = await queryOne<{ one: number }>(
    "SELECT 1 AS one FROM wallet_ledger WHERE driver_id = $1 LIMIT 1",
    [driverId]
  ).catch(() => null);
  if (seeded) return;
  const rides = await query<{ id: string; fare: number; method: string }>(
    `SELECT id, COALESCE(captured_amount, actual_fare, estimated_fare, 0)::float AS fare,
            LOWER(COALESCE(payment_method, '')) AS method
       FROM rides
      WHERE driver_id = $1 AND status = 'completed'
      ORDER BY created_at ASC
      LIMIT 500`,
    [driverId]
  ).catch(() => []);
  for (const r of rides) {
    await recordRideCompletion(driverId, r.id, Number(r.fare || 0), r.method).catch(() => { });
    // Historical card captures will never receive a fresh webhook — post now.
    if (["card", "pay_later"].includes(r.method)) {
      await confirmCardRideCredit(driverId, r.id).catch(() => { });
    }
  }
}



