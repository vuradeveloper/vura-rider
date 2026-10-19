-- 018 — DRIVER WALLET + COMMISSION (10%): the ledger is the source of truth.
-- Every completed ride produces a wallet_ledger entry in CENTS (integers):
--   • card / pay_later → card_credit_pending (+net) until the Paystack
--     preauthorization.capture.success webhook confirms, then posted;
--   • cash             → commission_debit (-10% immediately; wallet may go
--     negative — the driver already holds the rider's cash);
--   • cancel/refund    → reversal entries (one per original, idempotent);
--   • payout           → debit per successful transfer.
-- driver_wallets keeps the running balance (atomic deltas); config holds the
-- commission/VAT/fee/negative-limit numbers the console can tune.

CREATE TABLE IF NOT EXISTS wallet_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS driver_wallets (
  driver_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'card_credit_pending', 'card_credit', 'commission_debit',
    'reversal', 'payout', 'adjustment')),
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending', 'posted', 'void')),
  -- The internal 10% split (records/reporting only — the driver sees ONE
  -- commission figure): Paystack's cut, the VAT slice, our margin.
  paystack_fee_cents BIGINT NOT NULL DEFAULT 0,
  vat_cents BIGINT NOT NULL DEFAULT 0,
  margin_cents BIGINT NOT NULL DEFAULT 0,
  commission_cents BIGINT NOT NULL DEFAULT 0,
  ledger_ref_id UUID REFERENCES wallet_ledger(id),
  payout_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotency: one entry of each ride-linked type per ride (a duplicate
  -- webhook/retry conflicts and becomes a no-op instead of double-crediting).
  UNIQUE (ride_id, type)
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_driver
  ON wallet_ledger (driver_id, created_at DESC);
