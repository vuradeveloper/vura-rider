-- ROLLBACK for 002_destination_mode.sql — additive objects only, in reverse
-- order. Idempotent: safe to run twice; loses session history (by design —
-- back up first if the audit trail matters: pg_dump destination_sessions).

DROP TABLE IF EXISTS destination_events;
DROP TABLE IF EXISTS destination_sessions;
DROP INDEX IF EXISTS idx_destination_sessions_active;
DROP INDEX IF EXISTS idx_destination_sessions_driver_day;
DROP INDEX IF EXISTS idx_destination_events_driver;

ALTER TABLE driver_profiles DROP COLUMN IF EXISTS destination_expires_at;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS destination_set_at;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS destination_label;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS destination_lng;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS destination_lat;

DELETE FROM app_config WHERE key = 'destination';
