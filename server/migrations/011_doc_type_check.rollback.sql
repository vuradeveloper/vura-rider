-- 011 rollback — back to the original 7 document types.
ALTER TABLE driver_documents DROP CONSTRAINT IF EXISTS driver_documents_doc_type_check;
ALTER TABLE driver_documents ADD CONSTRAINT driver_documents_doc_type_check
  CHECK (doc_type IN ('drivers_license', 'id_document', 'prdp', 'criminal_record',
                      'license_disk', 'carscan_report', 'vehicle_scan'));