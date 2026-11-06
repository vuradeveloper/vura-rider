-- 025: vehicle classification review.
--
-- classifyVehicle() has always returned a fallback with status "pending_review"
-- for an unknown make/model, but nothing stored or displayed that status. The
-- result was a silent wrong ride class for the driver and no queue for the
-- admin.
--
-- ADDITIVE ONLY. Every column has a default or is nullable. The application
-- also creates these lazily on boot (services/vehicleReview.ts), because
-- production runs with RUN_MIGRATIONS_ON_BOOT=false; this file is the durable
-- schema record for a fresh database.
--
-- Idempotent. Rollback: 025_vehicle_review.rollback.sql.

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_needs_review BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_review_reason TEXT;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_review_key TEXT;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_reviewed_at TIMESTAMPTZ;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_reviewed_by TEXT;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_admin_note TEXT;

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_classified_at TIMESTAMPTZ;

-- CarScan prints an engine number; the Cars page needs it next to the plate
-- and VIN. Evidence only, never editable in the console.
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_engine VARCHAR(50);

-- Vehicle-level suspension. Dispatch skips a suspended car; the driver account
-- itself is not suspended, so the same person can later link another car.
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_suspended_reason TEXT;
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_suspended_at TIMESTAMPTZ;
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_suspended_by TEXT;

CREATE INDEX IF NOT EXISTS idx_driver_profiles_vehicle_needs_review
  ON driver_profiles (vehicle_needs_review)
  WHERE vehicle_needs_review = TRUE;

-- Catch-up for vehicles saved before this feature. Only cars with no ride
-- classes are flagged; a CarScan report that already granted classes is not
-- "unclassified" merely because the classifier is new.
UPDATE driver_profiles
   SET vehicle_needs_review = TRUE,
       vehicle_review_reason = COALESCE(vehicle_review_reason,
         'No ride classes yet - classify this car')
 WHERE vehicle_needs_review = FALSE
   AND vehicle_reviewed_at IS NULL
   AND (vehicle_make IS NOT NULL OR vehicle_model IS NOT NULL)
   AND (vehicle_categories IS NULL OR vehicle_categories = '[]'::jsonb);
