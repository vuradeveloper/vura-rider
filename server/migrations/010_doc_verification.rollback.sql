-- 010 rollback — document auto-verification columns.
ALTER TABLE driver_documents DROP COLUMN IF EXISTS auto_status;
ALTER TABLE driver_documents DROP COLUMN IF EXISTS auto_reasons;
ALTER TABLE driver_documents DROP COLUMN IF EXISTS extracted;
ALTER TABLE driver_documents DROP COLUMN IF EXISTS ocr_confidence;
ALTER TABLE driver_documents DROP COLUMN IF EXISTS verified_at;
