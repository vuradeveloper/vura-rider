-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN V2 — MULTI-ROLE SUPPORT: an admin user can hold more than one role.
-- ADDITIVE ONLY. Rollback: 024_admin_multi_role.rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extra roles per admin user (in addition to the primary `role` column).
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS extra_roles TEXT[] NOT NULL DEFAULT '{}';

-- 2. Backfill: ensure extra_roles is never null.
UPDATE admin_users SET extra_roles = '{}' WHERE extra_roles IS NULL;
