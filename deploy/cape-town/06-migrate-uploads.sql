-- Cape Town (af-south-1) incremental migration for driver document uploads.
-- Run ONCE against the cape RDS (keeps existing data):
--   PGPASSWORD='...' psql "host=vura-cape.cbcs4yqg4704.af-south-1.rds.amazonaws.com dbname=vura user=vura_admin sslmode=require" -f deploy/cape-town/06-migrate-uploads.sql
-- (uses gen_random_uuid() from pgcrypto — pre-installed on RDS Postgres 14+)

-- 1. Allow the 'admin' role on users (for the document review endpoints)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('driver', 'passenger', 'admin'));

-- 2. Driver documents (S3-backed metadata) for the admin review panel
CREATE TABLE IF NOT EXISTS driver_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type        VARCHAR(40) NOT NULL CHECK (doc_type IN (
                    'drivers_license', 'id_document', 'prdp',
                    'criminal_record', 'license_disk',
                    'carscan_report', 'vehicle_scan'
                  )),
  file_name       VARCHAR(255),
  mime_type       VARCHAR(100),
  s3_key          TEXT NOT NULL,
  s3_bucket       VARCHAR(255),
  size_bytes      INTEGER,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('pending_review', 'approved', 'rejected')),
  note            TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON driver_documents(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_type   ON driver_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_driver_documents_status ON driver_documents(status);
CREATE INDEX IF NOT EXISTS idx_driver_documents_created ON driver_documents(created_at DESC);

-- 3. Extra vehicle fields sent by the driver app
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_vin VARCHAR(50);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS odometer_km INTEGER;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS carscan_report_name VARCHAR(255);

-- 4. Promote an admin to review documents (replace with the real email):
-- UPDATE users SET role = 'admin' WHERE email = 'you@example.com';