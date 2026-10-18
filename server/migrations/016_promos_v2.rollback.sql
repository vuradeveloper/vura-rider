-- 016 rollback — removes only what 016 ADDED (promo definitions + redemption
-- history stay intact for everything 012 created).
DROP TABLE IF EXISTS admin_promo_redemptions;
ALTER TABLE admin_promos DROP COLUMN IF EXISTS target_user_ids;
ALTER TABLE admin_promos DROP COLUMN IF EXISTS rides_limit;
ALTER TABLE admin_promos DROP COLUMN IF EXISTS valid_days;
