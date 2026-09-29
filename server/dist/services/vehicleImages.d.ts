export declare const CANVAS: {
    w: number;
    h: number;
};
export declare const MAX_BYTES: number;
export type VehicleImageStatus = "queued" | "pending" | "approved" | "rejected" | "none_found";
export interface Candidate {
    url: string;
    storageKey: string;
    sourceUrl: string;
    contextLink: string;
    width: number;
    height: number;
    bytes: number;
    score: number;
    note: string;
}
export interface VehicleLike {
    make?: string | null;
    model?: string | null;
    year?: number | string | null;
    colour?: string | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_year?: number | string | null;
    vehicle_color?: string | null;
}
/**
 * The "generation" bucket of a model year. 2017, 2018, 2019 and 2020 all land in
 * "2017-2020" (4-year blocks), which is what makes rule 2b work: a 2019 Picanto
 * request reuses the image imported for 2018 with NO api call.
 */
export declare function generationRange(year?: number | string | null): string;
/** lowercase make|model|year_range|colour — the DB's unique key. */
export declare function vehicleImageCacheKey(v: VehicleLike | null | undefined): string;
export declare function ensureVehicleImageTables(): Promise<void>;
export declare function carsxeMaxCalls(): number;
export interface CarsxeBudget {
    used: number;
    max: number;
    left: number;
    blocked: boolean;
}
/** Counts EVERY logged call, including the ones imported from the dashboard. */
export declare function carsxeUsage(): Promise<CarsxeBudget>;
/**
 * Records one call. NEVER pass the request URL here — it carries the API key.
 */
export declare function logCarsxeCall(cacheKey: string, resultCount: number | null, httpStatus: number | null, note: string): Promise<void>;
export interface ResolvedVehicleImage {
    url: string | null;
    cacheKey: string;
    matched: "exact" | "model-colour" | "model" | "none";
}
/**
 * Fallback order, resolved server-side so every client agrees:
 *   1. approved, exact make+model+generation+colour
 *   2. approved, same make+model+colour, another generation   (the 2019 -> 2018 image)
 *   3. approved, same make+model, another colour              (colour fetch queued meanwhile)
 *   4. none -> the app draws the body-type icon, then the generic car
 */
export declare function resolveVehicleImage(v?: VehicleLike | null): Promise<ResolvedVehicleImage>;
/**
 * Returns true ONLY for the caller that created the row. Two drivers saving the
 * same car in the same second therefore queue exactly ONE CarsXE call — the
 * unique constraint on cache_key decides the winner, not application logic.
 * A pre-existing row of ANY status (pending/rejected/none_found) is left alone,
 * which is what makes "never retry a rejected or none_found key automatically"
 * true without a second check.
 */
export declare function claimVehicleImageFetch(v: VehicleLike): Promise<boolean>;
export interface RawCarsxeImage {
    link?: string;
    mime?: string;
    width?: number;
    height?: number;
    byteSize?: number;
    thumbnailLink?: string;
    contextLink?: string;
}
/**
 * Scores every image on the criteria you specified and returns them best-first:
 *   + png/webp preferred, + width >= 600 (and 1000), + aspect ratio 1.2–2.2,
 *   − dealer/classifieds context pages, − watermarked stock libraries.
 * Nothing here calls the API — it only reads the array we already paid for.
 */
export declare function scoreCandidates(images: RawCarsxeImage[]): Array<RawCarsxeImage & {
    score: number;
    note: string;
}>;
export declare function imageBaseUrl(): string;
export declare const storageKeyFor: (cacheKey: string, index?: number) => string;
export declare const fileNameFor: (cacheKey: string, index?: number) => string;
/**
 * Downloads a candidate ONCE. Never hotlinks: the bytes are re-uploaded to our
 * own bucket and only our own URL is ever stored or shown.
 */
export declare function downloadImage(url: string): Promise<Buffer>;
/**
 * Studio shots sit on a plain light background, so keying it out is deterministic
 * and needs no ML model (a 40 MB ONNX runtime does not belong in an EB deploy).
 * Pure white -> fully transparent, near-white -> feathered, then trim, fit the
 * shared 900x560 canvas (same as scripts/generate-vehicle-images.js) and step the
 * WebP quality down until it fits 80 KB.
 */
export declare function processVehicleImage(input: Buffer): Promise<Buffer>;
/**
 * Runs for a row that is already 'queued' — the caller must have WON the claim,
 * so there is exactly one of these per cache_key. Logs the call (status and count
 * only — never the URL, which carries the key), stores up to three processed
 * candidates as 'pending' and leaves the row for human approval.
 */
export declare function runCarsxeFetch(cacheKey: string): Promise<void>;
export declare function startVehicleImageWorker(intervalMs?: number): NodeJS.Timeout;
export declare function stopVehicleImageWorker(): void;
export declare function listVehicleImages(status?: string): Promise<any[]>;
/** Approves the row, optionally promoting a different candidate than the auto-pick. */
export declare function approveVehicleImage(id: string, candidateIndex?: number): Promise<{
    id: string;
    candidateIndex: number;
    imageUrl: any;
} | null>;
export declare function rejectVehicleImage(id: string): Promise<{
    id: string;
}>;
/**
 * Step 0 — a finished image produced by scripts/import-seed.js from a dashboard
 * search you already made. ZERO CarsXE calls: the bytes arrive already processed,
 * we only store them. Idempotent: re-running overwrites the same row instead of
 * adding a second one, and the usage log records the import exactly once.
 */
export declare function importSeedImage(input: {
    cacheKey: string;
    make: string;
    model: string;
    year?: number | null;
    colour?: string | null;
    sourceUrl?: string | null;
    contextLink?: string | null;
    licenceNote?: string | null;
    webpBase64: string;
    candidates?: Candidate[];
}): Promise<{
    row: any;
    candidate: Candidate;
    budget: CarsxeBudget;
}>;
export declare function resolveVehicleImageCached(v?: VehicleLike | null): Promise<ResolvedVehicleImage>;
export declare function noteDriverVehicle(v: VehicleLike): Promise<ResolvedVehicleImage>;
//# sourceMappingURL=vehicleImages.d.ts.map