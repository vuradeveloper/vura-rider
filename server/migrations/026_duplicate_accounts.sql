-- 026: duplicate account detection.
--
-- A person must not be able to create several driver accounts by changing the
-- email while reusing the same phone number or ID number. The app normalises
-- both into indexed columns; signup refuses a strong match and queues a weak
-- (near-identical email) match for an admin decision.
--
-- ADDITIVE ONLY. The application also creates these lazily on boot
-- (services/duplicateDetection.ts), because production runs with
-- RUN_MIGRATIONS_ON_BOOT=false.
--
-- Idempotent. Rollback: 026_duplicate_accounts.rollback.sql.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number_normalized VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_of_user_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_score INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_status VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_detected_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_reviewed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_reviewed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_users_phone_normalized
  ON users (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_id_number_normalized
  ON users (id_number_normalized)
  WHERE id_number_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_duplicate_open
  ON users (duplicate_status)
  WHERE duplicate_status = 'open';

-- Backfill. Last 9 digits is the canonical South African number, so
-- 0821234567, +27821234567 and 0027821234567 all land on 821234567.
UPDATE users
   SET phone_normalized = NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), 9), '')
 WHERE phone IS NOT NULL AND phone <> '';

UPDATE users
   SET id_number_normalized = NULLIF(UPPER(REGEXP_REPLACE(COALESCE(id_number, ''), '[^0-9A-Za-z]', '', 'g')), '')
 WHERE id_number IS NOT NULL AND id_number <> '';
