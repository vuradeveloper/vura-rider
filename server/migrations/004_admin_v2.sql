-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN V2 — PHASE 0: ROLES + IMMUTABLE AUDIT LOG.
-- ADDITIVE ONLY: every object uses IF NOT EXISTS, so re-running is safe.
-- Rollback: 004_admin_v2.rollback.sql
--
-- Nothing here touches rides, dispatch, drivers or location paths. The admin
-- API treats a missing table as "feature off" (503, never a ride-path throw).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. ADMIN USERS — one row per human with back-office access, keyed by the
--    Firebase-verified email (lowercased). ADMIN_EMAILS in the server env stays
--    the SUPER-ADMIN FALLBACK: those emails resolve to super_admin even with
--    no row here, so a broken table can never lock operators out.
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'super_admin', 'onboarding_reviewer', 'support_agent', 'operations', 'finance'
  )),
  -- A disabled row keeps the history but stops resolving to a role.
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Who invited/created this admin (email of the acting admin).
  invited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One row per email, case-insensitive (emails arrive from Firebase mixed-case).
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email
  ON admin_users (LOWER(email));

-- 2. AUDIT LOG — append-only record of every admin ACTION: who, when, what,
--    the old and new value (JSONB, null for creates), and the reason where the
--    action requires one (suspend, reject, role change, …). No UPDATE/DELETE
--    endpoint exists; the table is only ever INSERTed into.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,                -- e.g. 'driver.suspend', 'admin.role_change'
  entity_type TEXT NOT NULL,           -- e.g. 'driver', 'admin_user', 'document'
  entity_id TEXT,                      -- uuid of the row acted on, when there is one
  old_value JSONB,
  new_value JSONB,
  reason TEXT,                         -- required by some actions, validated in code
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
  ON admin_audit_log (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity
  ON admin_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON admin_audit_log (created_at DESC);
