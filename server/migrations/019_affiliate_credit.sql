-- 019: rides.affiliate_credit — how much "Invite & earn" credit (the referral
-- balance where the R5 lands) discounted THIS trip at booking. Additive only;
-- the booking paths also ALTER IF NOT EXISTS, so a database that has not run
-- this file still books and spends — only the receipt line degrades.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS affiliate_credit NUMERIC(12,2) NOT NULL DEFAULT 0;
