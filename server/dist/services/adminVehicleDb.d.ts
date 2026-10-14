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
    bodyType?: string | null;
    categories?: string[] | null;
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
 * Clear the whole image library (console "Clear Car DB") — used right before a
 * curated re-import of the white masters + v11 colours. Audited; returns how
 * many rows were removed. Driver/rider apps fall back to silhouettes until the
 * re-import lands, so run it only as part of a refresh.
 */
export declare function purgeCarDb(actor: AdminActor): Promise<{
    removed: number;
}>;
/**
 * Generate this car's missing colours from the WHITE original:
 *   • source = the uploaded file when given, else the car's existing approved
 *     WHITE row from the Car DB (zero upload needed),
 *   • one recolour per requested palette colour (default: every missing one),
 *   • each variant goes through the standard pipeline → approved → matching
 *     requests auto-resolve and drivers are pushed "photo ready".
 */
export declare function generateImages(input: {
    make: string;
    model: string;
    year?: number | null;
    yearRange?: string | null;
    colours?: string[];
    bodyType?: string | null;
    categories?: string[] | null;
    imageBase64?: string | null;
}, actor: AdminActor): Promise<{
    generated: any[];
    failed: any[];
    source: "upload" | "car-db";
}>;
/** Static catalogue (makes/models/body/years) for the console's pickers. */
export declare function catalogue(): {
    makes: Array<{
        make: string;
        models: any[];
    }>;
};
//# sourceMappingURL=adminVehicleDb.d.ts.map