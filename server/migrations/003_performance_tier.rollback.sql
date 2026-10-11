-- ROLLBACK for 003_performance_tier.sql — additive objects only, in reverse
-- order. Idempotent: safe to run twice; loses tier history and the metrics
-- snapshot (by design — back up first if the audit trail matters:
-- pg_dump driver_tier_history).
-- Config flag goes too: with the row gone, getPerformanceTierConfig() fails to
-- defaults (flag OFF), so a rolled-back server is inert even before this file.

DROP TABLE IF EXISTS driver_tier_history;
DROP INDEX IF EXISTS idx_driver_tier_history_driver;
DROP TABLE IF EXISTS performance_tier_runs;
DROP INDEX IF EXISTS idx_performance_tier_runs_nightly;
DROP TABLE IF EXISTS performance_tier_thresholds;
DROP TABLE IF EXISTS driver_tiers;

DELETE FROM app_config WHERE key = 'performance_tier';
