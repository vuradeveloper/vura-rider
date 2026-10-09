/** Canonical matching resolution (Q6: single resolution, no cross-res coverage). */
export declare const DEFAULT_MATCH_RES = 8;
/** Coarser resolution, stored purely so Phase 2 heatmaps are a counter later. */
export declare const DEFAULT_HEATMAP_RES = 7;
/** Average hexagon edge length in km for a resolution. */
export declare function hexEdgeKm(res: number): number;
/**
 * How many rings are needed to cover `radiusKm`.
 *
 * Derived from the resolution's own edge length, then rounded UP, then given one
 * extra ring of headroom. The headroom is deliberate: hex-edge distance
 * under-reaches toward the corners of a hexagon, and under-covering here means
 * silently dropping real drivers. Over-covering only costs a few extra rows,
 * which the exact haversine filter then removes.
 */
export declare function ringCountForRadius(radiusKm: number, res?: number): number;
/** Pickup/driver position -> H3 cell at the given resolution. */
export declare function toCell(lat: number, lng: number, res?: number): string;
/**
 * Every cell whose hexagon could contain a point within `radiusKm`.
 *
 * Returns the centre cell plus k rings. The caller MUST still apply an exact
 * distance filter — see the rule at the top of this file.
 */
export declare function cellsAround(lat: number, lng: number, radiusKm: number, res?: number): {
    cells: string[];
    k: number;
};
/** Centre coordinates of a cell (used for logging/debug only). */
export declare function cellCentre(cell: string): {
    lat: number;
    lng: number;
};
export declare function cellResolution(cell: string): number;
/**
 * Exact great-circle distance in km. This is the only distance that decides
 * whether a driver is eligible.
 */
export declare function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number;
//# sourceMappingURL=h3.d.ts.map