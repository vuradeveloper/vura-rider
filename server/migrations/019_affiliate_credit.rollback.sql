-- 019 rollback — drops only what 019 ADDED.
ALTER TABLE rides DROP COLUMN IF EXISTS affiliate_credit;
