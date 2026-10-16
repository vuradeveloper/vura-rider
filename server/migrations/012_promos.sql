-- 012 — PROMOS: admin-managed promotions targeted at ONE side (rider / driver /
-- both). The app fetches its own list (GET /api/promos/active?side=…) and the
-- booking handler re-applies the discount SERVER-side — the client only says
-- which promo it displayed, never the amount.
CREATE TABLE IF NOT EXISTS admin_promos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  subtitle       TEXT,
  audience       TEXT NOT NULL DEFAULT 'rider'
                 CHECK (audience IN ('rider','driver','both')),
  discount_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
  discount_fixed NUMERIC(10,2) NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_promos_discount CHECK (
    (discount_pct > 0 AND discount_pct <= 100) OR discount_fixed > 0
  ),
  CONSTRAINT admin_promos_window CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at
  )
);
CREATE INDEX IF NOT EXISTS idx_admin_promos_active
  ON admin_promos (active, audience, created_at DESC);

-- The ride remembers what was applied (receipts, audits, support).
ALTER TABLE rides ADD COLUMN IF NOT EXISTS promo_id UUID;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS promo_discount NUMERIC(10,2) NOT NULL DEFAULT 0;
