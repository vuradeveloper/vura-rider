-- 020: Remove the Kia Picanto from the vehicle image library so it drops out of
-- the driver dropdown and the admin catalogue. The owner re-adds it by hand
-- (v12 recolour + admin upload) — the admin form takes FREE-TEXT make/model, so
-- re-adding is never blocked by this, and once rows are approved the driver
-- dropdown serves it again automatically (the dropdown reads this table, not the
-- static catalogue). Idempotent; runs ONCE (tracked in schema_migrations), so a
-- later hand-re-add is never re-deleted. A DELETE cannot be rolled back without a
-- snapshot — take `aws rds create-db-snapshot` first if you want an undo point.
DELETE FROM vehicle_images
 WHERE LOWER(TRIM(make)) = 'kia'
   AND LOWER(TRIM(model)) = 'picanto';
