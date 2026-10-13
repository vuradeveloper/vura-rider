-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN V2 — PHASE 3: SUPPORT INBOX (tickets + replies).
-- ADDITIVE ONLY: new tables, no legacy object touched. Trips/live-map read
-- existing tables (rides, ride_events, driver_profiles) — nothing to migrate.
-- Rollback: 007_admin_trips.rollback.sql
--
-- MODELLING NOTE: a ticket may exist without a user row (walk-ups, chat from
-- before signup), so rider_id/driver_id are nullable and the contact details
-- are denormalised onto the ticket — support sees what the rider said at the
-- time even if the account is later deleted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(16) NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  priority VARCHAR(10) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  rider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rider_name TEXT,
  rider_email TEXT,
  rider_phone TEXT,
  ride_id UUID,
  assignee_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_rider
  ON support_tickets (rider_id, created_at DESC);

-- Append-only thread: first entry is the rider's message, later entries are
-- admin replies (author_email NOT NULL makes "who said this" unambiguous).
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
  ON support_ticket_messages (ticket_id, created_at);
