-- ROLLBACK for 004_admin_v2.sql — additive objects only, reverse order.
-- Idempotent: safe to run twice. Drops the admin role table and the audit log
-- (back up first if the audit trail matters: pg_dump admin_audit_log).

DROP INDEX IF EXISTS idx_admin_audit_log_created;
DROP INDEX IF EXISTS idx_admin_audit_log_entity;
DROP INDEX IF EXISTS idx_admin_audit_log_actor;
DROP TABLE IF EXISTS admin_audit_log;

DROP INDEX IF EXISTS idx_admin_users_email;
DROP TABLE IF EXISTS admin_users;