-- Driver break mode: while status = 'break' the dispatch query (which already
-- filters on status = 'available') skips the driver, and break_until lets the
-- availability poll put them back automatically. Idempotent.
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS break_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_driver_profiles_break_until
  ON driver_profiles (break_until)
  WHERE break_until IS NOT NULL;
