-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN V2 — PHASE 1: DRIVER LIFECYCLE, DOCUMENT EXPIRY, STATUS HISTORY.
-- ADDITIVE ONLY: every object uses IF NOT EXISTS, so re-running is safe.
-- Rollback: 005_admin_drivers.rollback.sql
--
-- GAP FOUND IN THE AUDIT (reported, not silently changed):
--   POST /api/drivers/online today SETS verification_status='approved' on
--   first call and NO document or approval check runs anywhere. The new
--   `lifecycle` gate column below exists so admin-v2 can start recording
--   state immediately; enforcement in dispatch/offline goes behind the
--   `driver_gate_enabled` flag (default FALSE) in a later item, per brief.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. LIFECYCLE — the operational state machine for onboarding + standing:
--    REGISTERED → DOCUMENTS_SUBMITTED → UNDER_REVIEW → CHANGES_REQUESTED /
--    APPROVED → ACTIVE → SUSPENDED / BLOCKED / REJECTED.
--    Existing drivers get 'ACTIVE' (they already drive) — no live behaviour
--    changes; the column is recorded, not yet enforced.
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS lifecycle_reason TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_driver_profiles_lifecycle
  ON driver_profiles (lifecycle_status, updated_at DESC);

-- 2. STATUS HISTORY — append-only transitions (who changed what, why).
CREATE TABLE IF NOT EXISTS driver_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status VARCHAR(30) NOT NULL,
  to_status VARCHAR(30) NOT NULL,
  reason TEXT,
  actor_email TEXT NOT NULL,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_status_history_driver
  ON driver_status_history (driver_id, created_at DESC);

-- 3. DOCUMENT EXPIRY — expiry dates drive the 30/14/7/1-day reminders and
--    the (flagged, default OFF) auto-suspend on expiry.
ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_driver_documents_expiring
  ON driver_documents (expires_at)
  WHERE expires_at IS NOT NULL;

-- 4. REQUIRED DOCUMENTS — configurable list (super_admin editable later).
CREATE TABLE IF NOT EXISTS admin_required_docs (
  doc_type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100
);
INSERT INTO admin_required_docs (doc_type, label, sort_order) VALUES
  ('id_document', 'ID Document', 10),
  ('drivers_license', 'Driver''s License', 20),
  ('prdp', 'PRDP', 30),
  ('criminal_record', 'Criminal Record', 40),
  ('carscan_report', 'CarScan Report', 50)
ON CONFLICT (doc_type) DO NOTHING;

-- 5. REJECT REASONS — the dropdown list for document rejection.
CREATE TABLE IF NOT EXISTS admin_reject_reasons (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100
);
INSERT INTO admin_reject_reasons (code, label, sort_order) VALUES
  ('blurry', 'Photo is blurry or unreadable', 10),
  ('expired', 'Document has expired', 20),
  ('wrong_document', 'Wrong document type', 30),
  ('partial', 'Document is cropped or incomplete', 40),
  ('mismatch', 'Name does not match the account', 50),
  ('other', 'Other (see free-text reason)', 900)
ON CONFLICT (code) DO NOTHING;
