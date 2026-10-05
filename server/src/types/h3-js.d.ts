// ─────────────────────────────────────────────────────────────────────────────
// TYPE DECLARATIONS FOR h3-js
//
// WHY THIS FILE EXISTS
//
// h3-js@4.1.0 ships its types at `dist/types.d.ts` but resolves them as
// `types.d.ts.js` under this project's tsconfig (module: commonjs, strict).
// tsc therefore reports every H3 import as unresolvable:
//
//   Module 'h3-js' has no exported member 'latLngToCell'
//   Cannot find module '...\types.d.ts.js'
//
// Fixing that properly would mean changing moduleResolution for the WHOLE
// server, which risks unrelated build behaviour. So we declare only the five
// functions we actually use, with the signatures from h3-js's own types.
// Runtime behaviour is unchanged: the real library is still imported and
// executed -- only the compiler's view of it is supplied here.
//
// src/lib/h3.test.ts proves every one of these declarations against the real
// library at runtime, so this file cannot silently drift out of sync.
//
// H3 string type: a 15-character lowercase hexadecimal cell index.
type H3Index = string;

declare module "h3-js" {
  /** Convert a lat/lng to an H3 cell at the given resolution (0-15). */
  export function latLngToCell(lat: number, lng: number, res: number): H3Index;

  /** The origin cell plus `k` rings around it. Total cells: 1 + 3k(k+1). */
  export function gridDisk(origin: H3Index, k: number): H3Index[];

  /** Centre point of a cell, as [lat, lng]. */
  export function cellToLatLng(cell: H3Index): [number, number];

  /**
   * Average hexagon edge length for a CELL (not a bare resolution).
   * `unit` is one of: "km" | "m" | "mi" | "ft" | "yd" | "nmi" | "rads".
   *
   * NOTE: the first argument is a valid H3 cell index. Passing a plain
   * resolution number is an error ("Directed edge argument was not valid",
   * code 6) -- the C library decodes the cell, so it must be a real cell.
   */
  export function edgeLength(cell: H3Index, unit: string): number;

  /** The resolution a cell was indexed at. */
  export function getResolution(cell: H3Index): number;
}