-- Rollback for 025_vehicle_review.sql.
-- Destructive for the review columns only. The ride classes themselves are
-- left untouched so dispatch keeps working.
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_engine;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_suspended_by;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_suspended_at;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_suspended_reason;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_suspended;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_classified_at;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_admin_note;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_reviewed_by;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_reviewed_at;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_review_key;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_review_reason;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_needs_review;
