/** The ONLY database a real-PG integration suite may touch. */
export declare const SCRATCH_DB: {
    readonly host: "127.0.0.1";
    readonly port: "55432";
    readonly name: "vura_test";
};
/**
 * SAFETY GUARD — call BEFORE the first statement (schema creation included).
 * Throws loudly when the env points anywhere except the scratch container.
 */
export declare function assertScratchDatabase(host: string, port: string, dbName: string): void;
/**
 * Point the shared database pool at the scratch container. Must run BEFORE the
 * first query (the pool reads env lazily on first use) and, for suites that
 * import route modules with import-time SQL, before those imports execute.
 */
export declare function useScratchDatabaseEnv(): void;
//# sourceMappingURL=integrationGuard.d.ts.map