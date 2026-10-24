-- ─────────────────────────────────────────────────────────────────────────────
-- 022: ride tier default (production bug found 2026-10-24).
--
-- The bootstrap schema (src/index.ts) created rides.tier with DEFAULT 'x' (the
-- legacy native VuraX id) long before migration 013 ran, so 013's
-- ADD COLUMN IF NOT EXISTS was a no-op and the live column kept DEFAULT 'x'.
-- The socket booking path inserted rides WITHOUT a tier and only wrote one when
-- the rider picked something other than 'go' — so every ordinary Go booking was
-- stored as 'x' = XL: dispatch offered it to XL cars and the rider's economy
-- driver never saw it (the rider's ride "never reached the driver"), while the
-- driver's 2-second polling list showed every nearby ride (the "random rides").
--
-- Booking now always writes the tier explicitly; this migration fixes the
-- column default so any insert that omits it lands in Go, and backfills rows
-- that were never written at all.
--
-- Idempotent. No rollback file: restoring DEFAULT 'x' would reintroduce the bug.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE rides ALTER COLUMN tier SET DEFAULT 'go';
UPDATE rides SET tier = 'go' WHERE tier IS NULL;
