/** The canonical stages, in the order a healthy ride walks through them. */
export declare const TRACE_STAGES: readonly ["request_received", "trip_saved", "dispatch_started", "drivers_found", "offer_sent", "offer_delivered_ack", "driver_response"];
export type TraceStage = (typeof TRACE_STAGES)[number] | string;
export type TraceCtx = {
    traceId: string;
    /** High-resolution start, for sub-millisecond deltas. */
    t0: number;
    rideId: string;
    createdAt: number;
};
/** Mint a trace for a ride. Re-using an existing one keeps the id stable. */
export declare function startTrace(rideId: string): TraceCtx;
/** Read the active trace, or mint one if this ride never started a trace. */
export declare function traceFor(rideId: string): TraceCtx;
export declare function getActiveTrace(rideId: string): TraceCtx | undefined;
/**
 * Record one stage.
 *
 * Deliberately NOT awaited by callers on the dispatch path. `detail` carries the
 * trace_id, the stage, wall-clock ISO time, and milliseconds-since-start, so the
 * debug endpoint can rebuild the whole journey from the ride_events it already
 * stores -- including traces for rides whose process died mid-flow.
 */
export declare function trace(rideId: string | null, stage: TraceStage, detail?: Record<string, unknown>): void;
/**
 * Rebuild a ride's timeline from the persisted events.
 *
 * Reads ALL stages for the ride in insertion order and computes the gap to the
 * previous stage, so slow hops are visible at a glance rather than requiring
 * the reader to subtract timestamps by hand.
 */
export declare function readTrace(rideId: string): Promise<{
    ride_id: string;
    trace_id: string | null;
    stage_count: number;
    total_ms: number;
    stages: {
        stage: string;
        at: string;
        ms_from_start: number;
        ms_since_previous: number | null;
        trace_id: string | null;
        detail: Record<string, unknown>;
    }[];
}>;
//# sourceMappingURL=trace.d.ts.map