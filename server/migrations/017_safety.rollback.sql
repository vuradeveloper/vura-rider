-- 017 rollback — safety suite tables (data is review-only; dropping is accepted).
DROP TABLE IF EXISTS safety_config;
DROP TABLE IF EXISTS sos_alerts;
DROP TABLE IF EXISTS driver_preferences;
DROP TABLE IF EXISTS ride_pins;
DROP TABLE IF EXISTS ride_checkins;
DROP TABLE IF EXISTS ride_anomalies;
DROP TABLE IF EXISTS ride_location_points;
ALTER TABLE driver_profiles DROP COLUMN IF EXISTS gender;
