-- 014 rollback — removes only what 014 ADDED on a fresh database.
-- payment_status is deliberately NOT dropped: on installs where it pre-existed
-- (affiliate / pay-later flows) that column is shared history.
ALTER TABLE rides DROP COLUMN IF EXISTS preauth_reference;
ALTER TABLE rides DROP COLUMN IF EXISTS hold_checkout_url;
ALTER TABLE rides DROP COLUMN IF EXISTS hold_expires_at;
ALTER TABLE rides DROP COLUMN IF EXISTS hold_amount_cents;
ALTER TABLE rides DROP COLUMN IF EXISTS captured_amount;
ALTER TABLE rides DROP COLUMN IF EXISTS paid_at;
DROP INDEX IF EXISTS rides_preauth_reference_key;
DROP TABLE IF EXISTS paystack_webhook_events;
