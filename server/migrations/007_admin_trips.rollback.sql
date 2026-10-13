-- ROLLBACK for 007_admin_trips.sql — drops the support inbox tables.
-- Destructive (all tickets + messages are deleted); run only when undoing.
DROP TABLE IF EXISTS support_ticket_messages;
DROP TABLE IF EXISTS support_tickets;
