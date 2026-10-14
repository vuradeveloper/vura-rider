import type { AdminActor } from "./adminAuth";
import { ensureVehicleRequestTable, recordVehicleRequestMiss, resolveVehicleRequests } from "./vehicleImages";
/** Idempotent — the migration creates this too; the guard covers first-boot order. */
export declare const ensureRequestTable: typeof ensureVehicleRequestTable;
/**
 * Called from noteDriverVehicle's Car-DB-miss branch: queue the gap and alert
 * the driver exactly ONCE (driver_notified_at gates the push). Thin delegate —
 * the logic lives in vehicleImages next to the pipeline hooks.
 */
export declare const recordCarDbMiss: typeof recordVehicleRequestMiss;
/** Console list: open (oldest first) or resolved; driver identity included. */
export declare function listVehicleRequests(status?: string): Promise<any[]>;
/** Manual console resolution (e.g. driver fixed their details). Audited. */
export declare function resolveVehicleRequest(id: string, actor: AdminActor, reason?: string): Promise<any | null>;
/**
 * THE AUTO-PULL: when an image for cache_key becomes approved (via upload or
 * the review flow), every open request for that key resolves and its driver
 * is pushed. Thin delegate to the pipeline-side implementation.
 */
export declare const resolveRequestsForCacheKey: typeof resolveVehicleRequests;
/** Admin uploads a photo for a missing car: pipeline → S3 → approved → auto-pull. */
export declare function addCarDbImage(input: {
    make: string;
    model: string;
    year?: number | null;
    yearRange?: string | null;
    colour?: string | null;
    imageBase64: string;
    sourceNote?: string | null;
}, actor: AdminActor): Promise<{
    image: any;
    resolvedRequests: number;
}>;
/** Trigger the web (CarsXE) search for a car — the worker + approval finish it. */
export declare function searchCarsXe(v: {
    make: string;
    model: string;
    year?: number | null;
    colour?: string | null;
}, actor: AdminActor): Promise<{
    queued: boolean;
}>;
/** Approve a pending image (from search or upload) → resolves matching requests. */
export declare function approveImage(id: string, candidateIndex: number, actor: AdminActor): Promise<{
    approval: any;
    resolvedRequests: number;
}>;
export declare function refetchImage(id: string, actor: AdminActor): Promise<any>;
export declare function rejectImage(id: string, actor: AdminActor): Promise<any>;
export declare function listImages(status?: string): Promise<any[]>;
/**
 * Generate this car in EVERY palette colour (default: the requested colour
 * only) — one Gemini call per colour, then the standard key-out/900x560/WebP
 * pipeline, approved straight away so requests auto-resolve. CarsXE is never
 * touched. Costs ~$0.04 per colour.
 */
export declare function generateImages(input: {
    make: string;
    model: string;
    year?: number | null;
    yearRange?: string | null;
    colours?: string[];
}, actor: AdminActor): Promise<{
    generated: any[];
    failed: any[];
}>;
/** Static catalogue (makes/models/body/years) for the console's pickers. */
export declare function catalogue(): {
    makes: Array<{
        make: string;
        models: any[];
    }>;
};
//# sourceMappingURL=adminVehicleDb.d.ts.map