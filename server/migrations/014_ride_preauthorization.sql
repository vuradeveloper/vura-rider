-- ─────────────────────────────────────────────────────────────────────────────
-- 014 — CARD PREAUTHORIZATION (Paystack holds against rides).
--
-- Source: https://paystack.com/docs/payments/card-preauthorization/
-- Additive only; every statement is a no-op when it already exists.
--
-- rides.payment_status ALREADY exists on installs that ran the affiliate /
-- pay-later flows (VARCHAR(20), legacy value 'paid') — IF NOT EXISTS leaves
-- that column exactly as it is; fresh databases get the enum column with the
-- default 'NONE'. Enum values (see services/preauthorization.ts):
--   NONE | HOLD_PENDING | HOLD_ACTIVE | CAPTURE_PENDING | PAID |
--   PAYMENT_FAILED | RELEASED | HOLD_EXPIRED
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'NONE';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS preauth_reference TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_checkout_url TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_amount_cents INTEGER;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS captured_amount NUMERIC(10,2);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS rides_preauth_reference_key
  ON rides (preauth_reference) WHERE preauth_reference IS NOT NULL;

-- One row per webhook event instance — replayed deliveries hit the primary key
-- and become no-ops before any state transition (webhook idempotency).
CREATE TABLE IF NOT EXISTS paystack_webhook_events (
  event_key   TEXT PRIMARY KEY,
  event       TEXT NOT NULL,
  data        JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ledger table, same shape routes/payments.ts creates lazily, so a
-- preauthorization.capture.success webhook can always record the trail.
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  ride_id UUID REFERENCES rides(id),
  reference VARCHAR(100),
  amount NUMERIC(10,2),
  currency VARCHAR(3) DEFAULT 'ZAR',
  status VARCHAR(20),
  provider VARCHAR(20),
  raw_response JSONB,
  authorization_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
