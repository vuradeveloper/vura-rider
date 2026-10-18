-- 016 — PROMOS v2: per-rider validity (N days + N rides after first use) and
-- specific targeting (chosen rider/driver user ids). Additive only; every
-- statement is IF NOT EXISTS so this is safe on any 012-era database.
--
-- valid_days   — NULL = usable until ends_at (012 behaviour). Set = the
--                redemption is valid this many days from the rider's FIRST use.
-- rides_limit  — NULL = unlimited uses (012 behaviour). Set = the rider may
--                redeem this promo this many times (counted per booked ride).
-- target_user_ids — NULL = everyone on the side (012 behaviour). Set = ONLY
--                these user ids ever see/qualify for the promo.
ALTER TABLE admin_promos ADD COLUMN IF NOT EXISTS valid_days INTEGER;
ALTER TABLE admin_promos ADD COLUMN IF NOT EXISTS rides_limit INTEGER;
ALTER TABLE admin_promos ADD COLUMN IF NOT EXISTS target_user_ids UUID[];

-- One row per (promo, user): how many rides they have redeemed it on, when it
-- started counting (the clock for valid_days) and when their window ends.
CREATE TABLE IF NOT EXISTS admin_promo_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id      UUID NOT NULL REFERENCES admin_promos(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rides_used    INTEGER NOT NULL DEFAULT 0,
  first_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promo_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_promo_redemptions_user
  ON admin_promo_redemptions (user_id, promo_id);
