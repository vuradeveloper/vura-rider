-- ROLLBACK for 005_admin_drivers.sql — additive objects only, reverse order.
-- Idempotent: safe to run twice. Drops the lifecycle columns, status history,
-- document expiry columns, required-docs and reject-reasons tables.

DROP TABLE IF EXISTS admin_reject_reasons;
DROP TABLE IF EXISTS admin_required_docs;
DROP INDEX IF EXISTS idx_driver_documents_expiring;
ALTER TABLE driver_documents
  DROP COLUMN IF EXISTS last_reminder_at,
  DROP COLUMN IF EXISTS expires_at;

DROP INDEX IF EXISTS idx_driver_status_history_driver;
DROP TABLE IF EXISTS driver_status_history;

DROP INDEX IF EXISTS idx_driver_profiles_lifecycle;
ALTER TABLE driver_profiles
  DROP COLUMN IF EXISTS suspended_until,
  DROP COLUMN IF EXISTS lifecycle_updated_at,
  DROP COLUMN IF EXISTS lifecycle_reason,
  DROP COLUMN IF EXISTS lifecycle_status;