-- ROLLBACK for 008_admin_messaging.sql — drops campaigns + the log column.
DROP TABLE IF EXISTS admin_campaigns;
ALTER TABLE notifications_log DROP COLUMN IF EXISTS campaign_id;
