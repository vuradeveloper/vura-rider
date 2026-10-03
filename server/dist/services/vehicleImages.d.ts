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
    /** Share of the outer border that was transparent/white in the RAW download (0..1). */
    borderWhite?: number;
    /** studioBonus() of that same measurement: +10 clean ring and corners, -4 busy. */
    studioBonus?: number;
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
export interface CarsxeCallRow {
    cache_key: string | null;
    called_at: string;
    result_count: number | null;
    http_status: number | null;
    note: string | null;
}
/**
 * The most recent calls, newest first. This is the answer to "why did that search find
 * nothing?": it shows the result count and the HTTP status of every call, including the
 * fallbacks, without ever exposing the API key (the key only ever travels in the URL).
 */
export declare function recentCarsxeCalls(limit?: number): Promise<CarsxeCallRow[]>;
/**
 * The DB's spelling of a make or model name: lowercase, with spaces and dots
 * collapsed to single hyphens. "Polo Vivo" and "Polo  Vivo." both become
 * "polo-vivo", which is exactly how the Car DB's filenames spell it — so a driver
 * who types a space still finds a photo that is filed under a hyphen.
 */
export declare function normToken(raw: unknown): string;
/** The Car DB's spelling of a make the driver typed. */
export declare function canonicalMake(raw: unknown): string;
/**
 * True when a Car DB range label covers a model year. Handles the three forms the
 * DB actually uses: "2016-2019", "2020-Present" and a bare "2021". A label we
 * cannot parse covers nothing, so an unreadable row can never outrank a readable
 * one.
 */
export declare function rangeCoversYear(label: unknown, year: unknown): boolean;
/**
 * How well a DB model name answers the one the driver saved.
 *
 * 100 exact, 60 for a hyphen-bounded variant — the only real shape in this DB:
 * "Polo" must find "Polo-Hatch" / "Polo-Vivo", and "Corolla Quest" must find
 * "Corolla-Cross". A loose `startsWith` is deliberately NOT used: it would let
 * "Go" match "Golf" and would only ever work by luck.
 */
export declare function modelScore(want: unknown, have: unknown): number;
export interface WhiteRow {
    cache_key: string;
    make: string | null;
    model: string | null;
    year: number | null;
    year_range: string | null;
    /** "white" | "red" | … Absent is treated as white (older fixtures omit it). */
    colour?: string | null;
    image_url: string | null;
    approved_at: string | null;
}
export interface WhitePick {
    row: WhiteRow;
    score: number;
}
/**
 * Chooses the ONE row that best answers a driver's colour, model and year. This is
 * the whole "which photo does this driver see" decision, kept as a pure function
 * so it can be tested against every car in the DB without a database.
 *
 * ORDER: the driver's own colour first, then white as the fallback. A row of any
 * OTHER colour is never eligible, so a driver who picked red can never be shown a
 * blue car. Inside one colour: exact model beats a variant; a stated production
 * range that covers the year beats one that does not; the nearest such range beats
 * a looser one; and only then does the newest approval win, exactly as it always did.
 *
 * Called WITHOUT `want.colour` only white rows are eligible — the pre-colour
 * behaviour, which is what the importer self-test and the year test rely on.
 */
export declare function pickBestWhiteRow(rows: WhiteRow[], want: {
    model: string;
    year?: unknown;
    colour?: string | null;
}): WhitePick | null;
export interface ResolvedVehicleImage {
    url: string | null;
    cacheKey: string;
    matched: "exact" | "model-colour" | "model" | "none";
}
/**
 * Fallback order, resolved server-side so every client agrees.
 *
 *   1. the exact row for this make|model|generation|COLOUR
 *   2. same make, the driver's colour (or white as the fallback), strongest model
 *      score, preferring a stated production range that covers the driver's year
 *   3. none -> the app draws the body-type icon, then the generic car
 *
 * A row of another colour is NEVER eligible, so a driver who picked red is shown a
 * red car — or the white model of it while a red render is still being made — and
 * never the blue one. Colour has to come first here: a red Polo and a blue Polo are
 * different photographs of the same car, not two names for one row.
 */
export declare function resolveVehicleImage(v?: VehicleLike | null): Promise<ResolvedVehicleImage>;
/**
 * Every make|model the approved library can ACTUALLY serve.
 *
 * This is what stops the driver app offering cars that have no photo: the dropdown is
 * built from this list, so whatever a driver picks is guaranteed to resolve to an
 * image. Before this the dropdown came from the static catalogue (24 makes / 150+
 * models) while only ~126 models had a picture, so the rest fell through to the SVG.
 *
 * This list stays WHITE on purpose, even now that coloured renders exist: white is
 * the fallback every colour can fall back TO, so a car listed here is guaranteed to
 * show a photo whatever colour the driver picks. A car that only had a red render
 * would leave every other colour with nothing.
 *
 * `year_range` is returned purely as information — see pickBestWhiteRow: the year
 * only ever BREAKS A TIE, it can never make a lookup fail.
 */
export interface CataloguePair {
    make: string;
    model: string;
    yearRange: string | null;
}
export declare function approvedVehicleCatalogue(): Promise<CataloguePair[]>;
/**
 * Returns true ONLY for the caller that won a fetch for this key. Two drivers saving
 * the same car in the same second therefore queue exactly ONE CarsXE call, because the
 * unique constraint on cache_key decides the winner, not application logic.
 *
 * A 'none_found' row may be RETRIED, under three guards, because a search that returns
 * nothing today (Kia Picanto 2017 asked with the colour filter returned zero images)
 * must not leave that car on an SVG icon for ever:
 *   - only when a driver saves that car again (i.e. somebody actually wants it),
 *   - at most MAX_FETCH_ATTEMPTS times (counted per CarsXE call, in runCarsxeFetch),
 *   - never more often than RETRY_COOLDOWN_MINUTES.
 * Pending, rejected and approved rows are still left alone.
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
export declare const storageKeyFor: (cacheKey: string, index?: number, hash?: string) => string;
export declare const fileNameFor: (cacheKey: string, index?: number, hash?: string) => string;
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
 * How much of the picture is a plain, keyable background?
 *
 * Only the OUTER BORDER RING and the four CORNERS of a small thumbnail are
 * measured, and a pixel counts as background when it is either transparent or
 * near-pure white - the very same test the keying loop in processVehicleImage()
 * uses. A studio shot on a white/transparent backdrop scores ~1.0; a forecourt,
 * press or street photo has road, sky, grass or a building along the border and
 * scores low. Measuring the ring rather than the whole frame is deliberate: a
 * WHITE CAR sits inside the frame, not on its border, so it cannot inflate the
 * number the way a "count the white pixels" rule would.
 *
 * Must run on the RAW download, before processVehicleImage(): the stored WebP has
 * its background already keyed to transparent, so measuring that file would make
 * every candidate look like a studio shot.
 */
export declare function measureStudioBackground(input: Buffer): Promise<{
    borderWhite: number;
    corners: number;
}>;
/**
 * Points added to a candidate's text score for looking like a studio shot.
 *
 * Both the ring AND the corners have to be clean for the full bonus: a car shot
 * against a bright sky has a white top border but a road along the bottom and dark
 * corners, which is not the clean catalogue look the rider card wants.
 */
export declare function studioBonus(m: {
    borderWhite: number;
    corners: number;
}): number;
/**
 * Runs for a row that is already 'queued' — the caller must have WON the claim,
 * so there is exactly one of these per cache_key. Logs the call (status and count
 * only — never the URL, which carries the key), stores up to three processed
 * candidates as 'pending' and leaves the row for human approval.
 */
export declare function runCarsxeFetch(cacheKey: string, options?: {
    keepStatus?: boolean;
}): Promise<void>;
export declare function startVehicleImageWorker(intervalMs?: number): NodeJS.Timeout;
export declare function stopVehicleImageWorker(): void;
export declare function listVehicleImages(status?: string): Promise<any[]>;
/** Approves the row, optionally promoting a different candidate than the auto-pick. */
export declare function approveVehicleImage(id: string, candidateIndex?: number): Promise<{
    id: string;
    candidateIndex: number;
    imageUrl: any;
} | null>;
/**
 * Re-runs the (single) CarsXE call for a row that already exists, so a car approved
 * before the studio-shot picker existed can be re-picked. Costs ONE API call.
 *
 * For an approved row the live image stays up until the operator approves one of the
 * fresh candidates (see runCarsxeFetch keepStatus). Any other status is re-queued
 * first, which is exactly what a first fetch does.
 */
export declare function refetchVehicleImage(id: string): Promise<{
    id: string;
    cacheKey: string;
    statusKept: boolean;
    status: any;
    liveImage: any;
    candidates: number;
    bestWhiteBorder: number | null;
    budget: CarsxeBudget;
} | null>;
export declare function rejectVehicleImage(id: string): Promise<{
    id: string;
}>;
/**
 * Step 0 — an image that did NOT come from a CarsXE call. Two producers use it:
 * scripts/import-seed.js (a dashboard search you already made) and
 * scripts/import-car-db.js (the local Car DB folder). ZERO API calls either way.
 *
 * Idempotent: re-running overwrites the same row instead of adding a second one,
 * and the usage log records the import exactly once.
 *
 * Car DB additions:
 *   `yearRange`  the model's stated production range ("2016-2019", "2020-Present"),
 *                which is what a driver's year is matched against.
 *   `processRaw` the payload is the ORIGINAL jpg/png and the server runs it through
 *                processVehicleImage() — the same key-out/trim/canvas/WebP pipeline
 *                every other photo goes through, so an import cannot look different
 *                from a fetched image.
 *   `approve`    land the row 'approved' so it serves immediately. A curated DB of
 *                hand-checked images does not need 196 manual approvals.
 */
export declare function importSeedImage(input: {
    cacheKey: string;
    make: string;
    model: string;
    year?: number | null;
    yearRange?: string | null;
    colour?: string | null;
    sourceUrl?: string | null;
    contextLink?: string | null;
    licenceNote?: string | null;
    webpBase64: string;
    candidates?: Candidate[];
    processRaw?: boolean;
    approve?: boolean;
}): Promise<{
    row: any;
    candidate: Candidate;
    budget: CarsxeBudget;
}>;
export declare function resolveVehicleImageCached(v?: VehicleLike | null): Promise<ResolvedVehicleImage>;
/**
 * Attach the approved photo to ride / driver rows as `vehicle_image_url`.
 *
 * This is the ONE place that decides which photo a rider sees, so the active
 * trip card, the "driver accepted" socket event, trip history and the public
 * share page can never disagree. Before this existed each query matched
 * `vehicle_images` on the DRIVER'S COLOUR, so a driver who saved a red Polo got
 * no row back (the curated Car DB stores white models only) and the rider kept
 * the SVG icon.
 *
 * Rows carry the driver's car as `vehicle_make` / `vehicle_model` /
 * `vehicle_year`. A lookup failure is swallowed on purpose: the app then draws
 * its own body-type icon, exactly as before.
 */
export declare function attachVehicleImages<R = any>(rows: R | R[] | null): Promise<R | R[] | null>;
/**
 * Where vehicle photos come from.
 *
 *   "cardb" (the default) — the curated local Car DB, imported by
 *        scripts/import-car-db.js. A lookup miss means the car is simply not in
 *        the DB yet; there is nothing to fetch and nothing to pay for.
 *   "carsxe" — the previous behaviour: queue a paid CarsXE search on a miss.
 *
 * The switch exists so the CarsXE path stays intact and auditable rather than
 * deleted: flipping VEHICLE_IMAGES_SOURCE=carsxe restores it exactly.
 */
export declare function vehicleImageSource(): "cardb" | "carsxe";
export declare function noteDriverVehicle(v: VehicleLike): Promise<ResolvedVehicleImage>;
//# sourceMappingURL=vehicleImages.d.ts.map