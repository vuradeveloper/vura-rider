-- ROLLBACK for 006_admin_riders.sql — drops the Phase 2 rider tables.
-- Destructive by nature (history + notes are deleted); run only when undoing.
DROP TABLE IF EXISTS rider_notes;
DROP TABLE IF EXISTS rider_status_history;
DROP TABLE IF EXISTS rider_moderation;
