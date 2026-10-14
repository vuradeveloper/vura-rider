-- 009_admin_vehicle_requests — ADMIN V2 Phase 7: Car DB request queue.
--
-- When a driver saves a vehicle whose photo is NOT in the Car DB (and the
-- image source is "carb"), we record the gap here so operations can fill it:
-- upload a photo or trigger a web search, and the moment an image for that
-- cache_key is approved the request auto-resolves and the driver is pushed
-- "photo ready" - no driver action needed after the first alert.
--
-- Deliberately NO FK to vehicle_images: that table is created lazily by the
-- app (ensureVehicleImageTables), so a migration FK would be order-fragile.
CREATE TABLE IF NOT EXISTS admin_vehicle_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_key VARCHAR(160) NOT NULL,
  make VARCHAR(60),
  model VARCHAR(80),
  year INTEGER,
  colour VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'open',      -- open | resolved
  image_id UUID,                                   -- vehicle_images.id (no FK, see above)
  driver_notified_at TIMESTAMPTZ,                  -- first "photo missing" push
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cache_key, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_vehicle_requests_status
  ON admin_vehicle_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_vehicle_requests_driver
  ON admin_vehicle_requests (driver_id);
