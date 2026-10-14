-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN V2 — PHASE 4: CAMPAIGNS (targeted push messaging).
-- ADDITIVE ONLY. Rollback: 008_admin_messaging.rollback.sql
--
-- DELIVERY MODEL: a campaign is a named push broadcast to an audience
-- (riders / drivers / all). Fan-out goes through the EXISTING push path
-- (sendPushToUsers → notifications_log), so per-recipient delivery history
-- lands where it always did; this table only tracks the campaign itself and
-- its counters. `campaign_id` on notifications_log ties the two together.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  audience VARCHAR(20) NOT NULL DEFAULT 'riders'
    CHECK (audience IN ('riders', 'drivers', 'all')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  created_by TEXT NOT NULL,
  sent_by TEXT,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_admin_campaigns_status
  ON admin_campaigns (status, created_at DESC);

-- Ties notifications_log rows to the campaign that produced them.
-- The table is created HERE if migration 008 runs before the index.ts
-- bootstrap does (fresh DB): identical shape, so whichever runs first wins
-- and the other is a no-op.
CREATE TABLE IF NOT EXISTS notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  type VARCHAR(40),
  ride_id UUID,
  title VARCHAR(200),
  body TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_status VARCHAR(20),
  error TEXT,
  provider VARCHAR(20)
);
ALTER TABLE notifications_log
  ADD COLUMN IF NOT EXISTS campaign_id UUID;
