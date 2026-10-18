-- 015 rollback — removes only what 015 ADDED.
DROP TABLE IF EXISTS pay_later_ledger;
DROP INDEX IF EXISTS pay_later_ledger_ride_source_key;
DROP INDEX IF EXISTS pay_later_ledger_reference_key;
DROP INDEX IF EXISTS pay_later_ledger_rider_idx;
DROP INDEX IF EXISTS pay_later_ledger_open_debits_idx;
ALTER TABLE pay_later_accounts DROP COLUMN IF EXISTS auto_debit_enabled;
ALTER TABLE pay_later_accounts DROP COLUMN IF EXISTS auto_debit_consent_at;
ALTER TABLE pay_later_accounts DROP COLUMN IF EXISTS terms_accepted_at;
ALTER TABLE pay_later_accounts DROP COLUMN IF EXISTS repay_ride_count;
ALTER TABLE payment_collections DROP COLUMN IF EXISTS reference;
ALTER TABLE rides DROP COLUMN IF EXISTS card_auth_code;
ALTER TABLE saved_cards DROP COLUMN IF EXISTS signature;
