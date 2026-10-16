-- Idempotent: safe to run twice. Destructive for the two columns only —
-- back up first if the stored classifications matter; matching degrades to
-- pre-013 behaviour (everyone counts as economy) once they are gone.
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS vehicle_categories;
ALTER TABLE rides DROP COLUMN IF EXISTS tier;
