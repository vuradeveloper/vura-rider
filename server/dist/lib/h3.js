"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// H3 HEXAGONAL HELPERS — driver-cell indexing and candidate collection.
//
// WHY H3 AND NOT JUST SQL HAVERSINE
//
// The old findCandidates() computed haversine over EVERY driver_profiles row in
// one query: a full scan that grows linearly with the driver base, with no index
// able to help because the distance is computed inside the WHERE clause. H3 lets
// us index a fixed, uniform grid: a pickup point maps to a cell, and only the
// handful of cells within `k` rings can possibly contain a driver near enough.
//
// THE ONE RULE THAT MUST NOT BE FORGOTTEN
//
// gridDisk() gives CANDIDATES, never a guarantee. H3 cells are hexagons, not
// circles, and "ring k" is measured in hex edges, not kilometres. A driver 2.9km
// away can sit in a cell outside the disk we asked for; a driver inside the disk
// can be 4km away. So EVERY result set from this module is filtered by exact
// haversine before it is used. The cells are an index; the distance is the truth.
//
// WHY `k` IS COMPUTED, NEVER GUESSED
//
// Ring size depends on the resolution's edge length, which changes by ~57% per
// level. A hardcoded k=7 is only correct for res 8 and silently under-covers at
// other resolutions, which would drop nearby drivers and look like "no drivers
// nearby" in production. k is derived from h3.edgeLength() below, and we take a
// conservative ceiling.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HEATMAP_RES = exports.DEFAULT_MATCH_RES = void 0;
exports.hexEdgeKm = hexEdgeKm;
exports.ringCountForRadius = ringCountForRadius;
exports.toCell = toCell;
exports.cellsAround = cellsAround;
exports.cellCentre = cellCentre;
exports.cellResolution = cellResolution;
exports.haversineKm = haversineKm;
const h3_js_1 = require("h3-js");
/** Canonical matching resolution (Q6: single resolution, no cross-res coverage). */
exports.DEFAULT_MATCH_RES = 8;
/** Coarser resolution, stored purely so Phase 2 heatmaps are a counter later. */
exports.DEFAULT_HEATMAP_RES = 7;
/**
 * OFFICIAL H3 average hexagon edge length per resolution, in METRES.
 *
 * From the H3 v4 reference table (h3geo.org/documentation/core-library/tables/
 * edge-length-table). Index 0-15, one entry per resolution.
 *
 * NOTE: that page publishes these numbers in KILOMETRES (res 8 = 0.461459 km).
 * The values below are that table x1000 so the unit matches the name and
 * hexEdgeKm's /1000 conversion is correct. Getting this wrong by 1000x shrinks
 * every ring count into the thousands and blows up gridDisk — so h3.test.ts
 * pins each value against the published table.
 *
 * WHY A TABLE AND NOT h3.edgeLength()
 *
 * edgeLength() is broken in the h3-js@4.1.0 build installed here: it throws
 * "Directed edge argument was not valid" (H3 code 6) for EVERY valid cell at
 * EVERY resolution, even though isValidCell() returns true for the same cells:
 *
 *     sandton 88bcc350e7fffff THREW Directed edge argument was not valid
 *     isValid sandton: true
 *
 * So it is a WASM decoding fault in this build, not a bad argument. Rather than
 * depend on a broken binding, the published table is used directly -- it is the
 * same number the C library would return, it cannot break at runtime, and it is
 * a compile-time constant rather than a per-call WASM invocation on the matching
 * hot path.
 *
 * src/lib/h3.test.ts pins these values and cross-checks the resulting ring
 * coverage against a real coordinate sweep, so a wrong number here cannot hide.
 */
const EDGE_LENGTH_M = [
    1107712.591, // res 0  (~1108 km)
    418675.339, // res 1
    158005.700, // res 2
    59810.543, // res 3
    22606.379, // res 4
    8544.892, // res 5
    3229.962, // res 6
    1220.702, // res 7  (~1.22 km)
    461.459, // res 8  (~461 m)
    174.489, // res 9
    65.979, // res 10
    24.946, // res 11
    9.434, // res 12
    3.568, // res 13
    1.349, // res 14
    0.510, // res 15
];
/** Average hexagon edge length in km for a resolution. */
function hexEdgeKm(res) {
    const metres = EDGE_LENGTH_M[res];
    // An out-of-range resolution means a misconfigured app_config; fall back to
    // the canonical resolution rather than producing NaN, which would silently
    // turn ringCountForRadius into Math.max(1, NaN) and collapse the disk to a
    // single cell and quietly stop finding nearby drivers.
    return (metres ?? EDGE_LENGTH_M[exports.DEFAULT_MATCH_RES]) / 1000;
}
/**
 * How many rings are needed to cover `radiusKm`.
 *
 * Derived from the resolution's own edge length, then rounded UP, then given one
 * extra ring of headroom. The headroom is deliberate: hex-edge distance
 * under-reaches toward the corners of a hexagon, and under-covering here means
 * silently dropping real drivers. Over-covering only costs a few extra rows,
 * which the exact haversine filter then removes.
 */
function ringCountForRadius(radiusKm, res = exports.DEFAULT_MATCH_RES) {
    const edge = hexEdgeKm(res);
    if (!Number.isFinite(edge) || edge <= 0)
        return 7;
    return Math.max(1, Math.ceil(radiusKm / edge) + 1);
}
/** Pickup/driver position -> H3 cell at the given resolution. */
function toCell(lat, lng, res = exports.DEFAULT_MATCH_RES) {
    return (0, h3_js_1.latLngToCell)(Number(lat), Number(lng), res);
}
/**
 * Every cell whose hexagon could contain a point within `radiusKm`.
 *
 * Returns the centre cell plus k rings. The caller MUST still apply an exact
 * distance filter — see the rule at the top of this file.
 */
function cellsAround(lat, lng, radiusKm, res = exports.DEFAULT_MATCH_RES) {
    const centre = toCell(lat, lng, res);
    const k = ringCountForRadius(radiusKm, res);
    // gridDisk's k=0 returns just the centre cell.
    return { cells: (0, h3_js_1.gridDisk)(centre, k), k };
}
/** Centre coordinates of a cell (used for logging/debug only). */
function cellCentre(cell) {
    const [lat, lng] = (0, h3_js_1.cellToLatLng)(cell);
    return { lat, lng };
}
function cellResolution(cell) {
    return (0, h3_js_1.getResolution)(cell);
}
/**
 * Exact great-circle distance in km. This is the only distance that decides
 * whether a driver is eligible.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (Number(d) * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
//# sourceMappingURL=h3.js.map