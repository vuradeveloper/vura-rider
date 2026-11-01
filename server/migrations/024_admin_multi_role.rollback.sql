-- Rollback for 024_admin_multi_role.sql
ALTER TABLE admin_users DROP COLUMN IF EXISTS extra_roles;
