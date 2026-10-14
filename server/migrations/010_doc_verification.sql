-- ─────────────────────────────────────────────────────────────────────────────
-- 010 — document auto-verification (ridevura-verification port).
-- Adds the automatic-check columns to driver_documents. Purely ADDITIVE:
-- nullable/defaulted columns only, so re-running is safe.
-- Rollback: 010_doc_verification.rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- What the automatic checks decided for THIS document:
--   approved | needs_review | rejected   (staff still clicks Approve/Reject)
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS auto_status TEXT;
-- Human-readable reasons for the decision (shown to staff AND to the driver
-- when the document is rejected — same channel as the existing note).
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS auto_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Fields read off the document (ID numbers, VIN, expiry, markers, cross-doc
-- issues) so staff can see WHAT was extracted without opening the file.
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS extracted JSONB NOT NULL DEFAULT '{}'::jsonb;
-- OCR confidence (0-100), null when no OCR ran.
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS ocr_confidence INT;
-- When the automatic check last ran.
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
