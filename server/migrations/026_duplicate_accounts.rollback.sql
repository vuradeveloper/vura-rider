-- Rollback for 026_duplicate_accounts.sql.
-- Destructive for the duplicate-review columns only. The accounts themselves
-- and their raw phone/id_number fields are untouched.
ALTER TABLE users DROP COLUMN IF EXISTS duplicate_reviewed_by;
ALTER TABLE users DROP COLUMN IF EXISTS duplicate_reviewed_at;
ALTER TABLE users DROP COLUMN IF EXISTS duplicate_detected_at;
ALTER TABLE users DROP COLUMN IF EXISTS duplicate_status;
ALTER TABLE users DROP COLUMN IF EXISTS duplicate_score;
ALTER TABLE users DROP COLUMN IF EXISTS duplicate_reason;
ALTER TABLE users DROP COLUMN IF EXISTS duplicate_of_user_id;
ALTER TABLE users DROP COLUMN IF EXISTS id_number_normalized;
ALTER TABLE users DROP COLUMN IF EXISTS phone_normalized;
