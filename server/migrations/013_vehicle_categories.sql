-- ─────────────────────────────────────────────────────────────────────────────
-- 013: RIDE CLASS CATEGORIES (CarScan "Eligible Categories" → matching).
--
-- A CarScan report prints which ride classes a car is cleared for (real
-- example: DATSUN GO, 7 seats → "Eligible Categories: Economy,XL,Send").
-- The rider app books a tier (go / comfort / xl / black) and dispatch must
-- offer that request ONLY to drivers whose car is in the matching class,
-- starting from the first 3 km of the search ladder.
--
-- ADDITIVE ONLY: two new columns, both with defaults — a database that never
-- runs this migration behaves exactly as before (unclassified drivers are
-- treated as economy, which is what dispatch did before this landed).
-- Idempotent: safe to run twice (TEST_MIGRATION covers it). Rollback:
-- 013_vehicle_categories.rollback.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- The car's ride classes, canonical tokens as JSONB (["economy","xl","send"]).
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS vehicle_categories JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The tier the rider chose at booking. Was a dead column in the old design;
-- booking now writes it and dispatch reads it (unknown values normalise to
-- 'go' in code, so mixed old/new clients are safe).
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'go';

-- WHY THIS SECOND STATEMENT EXISTS (production bug, 2026-10-24):
-- the bootstrap schema (src/index.ts) created `rides.tier` with DEFAULT 'x'
-- years before this migration, so ADD COLUMN IF NOT EXISTS above did nothing
-- and the live column kept DEFAULT 'x' — the legacy native VuraX id. The
-- socket booking path then inserted rides WITHOUT a tier and only wrote one
-- when the rider picked something other than 'go', so every ordinary (Go)
-- booking was stored as 'x' = XL: dispatch offered it to XL cars and the
-- rider's economy driver never saw it. Force the correct default here and
-- backfill the rows that were never written at all.
ALTER TABLE rides ALTER COLUMN tier SET DEFAULT 'go';
UPDATE rides SET tier = 'go' WHERE tier IS NULL;

