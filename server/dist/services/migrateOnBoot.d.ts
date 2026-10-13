export declare const MIGRATION_ORDER: readonly ["001_h3_driver_index.sql", "001b_offer_unique_index.sql", "002_destination_mode.sql", "003_performance_tier.sql", "004_admin_v2.sql", "005_admin_drivers.sql"];
export type MigrationOutcome = "applied" | "skipped" | "failed";
export interface MigrationResult {
    file: string;
    outcome: MigrationOutcome;
    detail?: string;
}
export interface MigrateSummary {
    enabled: boolean;
    applied: number;
    skipped: number;
    failed: number;
    results: MigrationResult[];
}
/** Same pre-check the 001b file itself documents (STEP 3). */
export declare const DUPLICATE_PENDING_PRECHECK_SQL = "\nSELECT driver_id,\n       COUNT(*) AS pending_offers,\n       array_agg(id ORDER BY created_at) AS offer_ids\n  FROM ride_offers\n WHERE status = 'pending'\n GROUP BY driver_id\nHAVING COUNT(*) > 1";
export declare function migrationsDir(): string;
/**
 * Split SQL into top-level statements. Handles single-quoted strings (with ''
 * and \-escapes), `--` line comments and `$$…$$` bodies — enough for the four
//  migration files, which contain no nested dollar tags.
 */
export declare function splitStatements(sql: string): string[];
/**
 * Never throws. Returns a summary even on total failure so boot always has
 * exactly one summary line to read.
 */
export declare function runMigrationsOnBoot(): Promise<MigrateSummary>;
//# sourceMappingURL=migrateOnBoot.d.ts.map