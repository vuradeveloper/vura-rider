-- ROLLBACK for 012_promos.sql — destructive by nature (promo definitions are
-- lost); rides keep promo_id/promo_code/promo_discount values dropped here too.
ALTER TABLE rides DROP COLUMN IF EXISTS promo_discount;
ALTER TABLE rides DROP COLUMN IF EXISTS promo_code;
ALTER TABLE rides DROP COLUMN IF EXISTS promo_id;
DROP INDEX IF EXISTS idx_admin_promos_active;
DROP TABLE IF EXISTS admin_promos;
