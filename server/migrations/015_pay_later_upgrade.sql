-- ─────────────────────────────────────────────────────────────────────────────
-- 015 — RIDE NOW, PAY LATER upgrade: ledger, consent, same-card provenance.
--
-- Additive only; every statement is IF NOT EXISTS. The money tables are also
-- declared here (byte-for-byte the lazy-ensure shapes) so the file is safe on
-- a fresh database where payments/PayLaterService's ensure has not run yet.
--
-- Ledger semantics (the brief: "store the rider's current amount owed in a
-- ledger table … rather than a single number"):
--   entry_type 'debit'  status 'open'|'settled'  — one per pay-later ride,
--       settled_amount grows as repayments are FIFO-allocated against it; a
--       fully settled debit marks its ride payment_status='paid'.
--   entry_type 'credit' status 'pending'|'confirmed'|'failed' — a repayment:
--       'pending' until Paystack's charge.success webhook CONFIRMS it
--       (brief: webhooks confirm before the ledger updates), then settled
--       FIFO across the oldest open debits. reference = Paystack reference
--       (PLR-…), unique → webhook replays are DB-level no-ops.
-- pay_later_accounts.outstanding stays as a MIRROR of the ledger sum so the
-- existing booking guard keeps working unchanged; every writer recomputes it
-- from the ledger in the same transaction (ledger is the source of truth).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── accounts (existing shape first, then the new consent/cycle columns) ──
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
);
ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS auto_debit_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS auto_debit_consent_at TIMESTAMPTZ;
ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE pay_later_accounts ADD COLUMN IF NOT EXISTS repay_ride_count INTEGER NOT NULL DEFAULT 0;

-- ── attempt log (existing table + Paystack reference for webhook matching) ──
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
);
ALTER TABLE payment_collections ADD COLUMN IF NOT EXISTS reference VARCHAR(100);

CREATE TABLE IF NOT EXISTS pay_later_blacklist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  identity_fingerprint VARCHAR(255) NOT NULL UNIQUE,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── THE LEDGER ──
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
);
-- One debit per ride, one ride-to-repay credit per ride → every completion
-- hook firing twice still books the money once.
CREATE UNIQUE INDEX IF NOT EXISTS pay_later_ledger_ride_source_key
  ON pay_later_ledger (ride_id, source) WHERE ride_id IS NOT NULL;
-- A Paystack repayment reference may confirm only once (webhook idempotency
-- is enforced by the database itself, not just the event log).
CREATE UNIQUE INDEX IF NOT EXISTS pay_later_ledger_reference_key
  ON pay_later_ledger (reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS pay_later_ledger_rider_idx ON pay_later_ledger (rider_id, created_at);
CREATE INDEX IF NOT EXISTS pay_later_ledger_open_debits_idx
  ON pay_later_ledger (rider_id, due_at) WHERE entry_type = 'debit' AND status = 'open';

-- ── rides: which card paid (eligibility provenance) + legacy lazy columns ──
ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS card_auth_code VARCHAR(100);

-- ── saved_cards: Paystack authorization signature (per-card fingerprint) ──
CREATE TABLE IF NOT EXISTS saved_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  card_type VARCHAR(20),
  last4 VARCHAR(4),
  bank VARCHAR(100),
  exp_month INTEGER,
  exp_year INTEGER,
  card_number_masked VARCHAR(30),
  transaction_index VARCHAR(100),
  signature VARCHAR(64),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS signature VARCHAR(64);
