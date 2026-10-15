-- 011 — extend driver_documents.doc_type to the full app set. The console/API
-- already allow profile_photo + face_scan (the driver app's 9-step flow ends
-- with a face scan), but the table's CHECK constraint still held the original
-- 7 types — every face-scan upload failed with:
--   new row for relation "driver_documents" violates check constraint
--   "driver_documents_doc_type_check"
-- DROP + re-ADD of a CHECK is metadata-only: no rows are rewritten.

ALTER TABLE driver_documents DROP CONSTRAINT IF EXISTS driver_documents_doc_type_check;
ALTER TABLE driver_documents ADD CONSTRAINT driver_documents_doc_type_check
  CHECK (doc_type IN ('drivers_license', 'id_document', 'prdp', 'criminal_record',
                      'license_disk', 'carscan_report', 'vehicle_scan',
                      'profile_photo', 'face_scan'));