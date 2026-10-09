export type CounterName = "upsert_failures" | "h3_path_failures" | "fallback_used" | "offer_driver_busy" | "no_drivers" | "offer_socket_down" | "push_delivered_zero" | "offer_undeliverable" | "offer_acked" | "offer_not_acked" | "destination_activated" | "destination_filtered" | "destination_predicate_error" | "destination_ended";
/** Increment a counter (in-memory, sync, infallible). */
export declare function bump(name: CounterName): void;
/** Snapshot for the debug endpoints. Counters are PER INSTANCE (one EB
 * instance has its own memory); `instance` names the host and `started_at`
 * says when this process's counters began — both reset on redeploy. */
export declare function getCounters(): Record<CounterName, number> & {
    instance: string;
    started_at: string;
};
/** Test seam. */
export declare function resetCounters(): void;
export declare function rateLimitedLog(key: string, message: string): boolean;
/**
 * A driver_cells index write failed. GPS itself was already saved — this only
 * costs H3 indexing for that driver — so: count it, and say it at most once a
 * minute per driver instead of once per ping.
 */
export declare function noteIndexUpsertFailure(driverId: string, err: any): void;
//# sourceMappingURL=metrics.d.ts.map