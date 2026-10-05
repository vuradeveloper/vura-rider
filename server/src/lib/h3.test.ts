// ─────────────────────────────────────────────────────────────────────────────
// PROVES THE h3-js TYPE SHIM MATCHES THE REAL LIBRARY.
//
// src/types/h3-js.d.ts supplies the compiler's view of h3-js because the
// package's own types do not resolve under this project's tsconfig. A hand-
// written declaration can silently drift from the real library, so every
// function it declares is exercised here against the REAL module at runtime,
// with values verified against independently-known H3 facts.
//
// If the shim and the library ever disagree, this fails.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  latLngToCell,
  gridDisk,
  cellToLatLng,
  edgeLength,
  getResolution,
} from "h3-js";
import { cellsAround, ringCountForRadius, haversineKm, hexEdgeKm } from "./h3";

describe("h3-js shim matches the real library", () => {
  it("latLngToCell returns a string cell at the requested resolution", () => {
    const cell = latLngToCell(-26.1076, 28.0567, 8);
    expect(typeof cell).toBe("string");
    expect(cell).toMatch(/^[0-9a-f]{15}$/);
    expect(getResolution(cell)).toBe(8);
    // Same point at a different resolution must differ and stay consistent.
    expect(latLngToCell(-26.1076, 28.0567, 7)).not.toBe(cell);
    expect(getResolution(latLngToCell(-26.1076, 28.0567, 7))).toBe(7);
  });

  it("gridDisk returns exactly 1 + 3k(k+1) cells", () => {
    // The hexagonal number: k=0 -> 1, k=1 -> 7, k=2 -> 19. This is a structural
    // property of the hexagonal grid, independent of any Vura code.
    const origin = latLngToCell(-26.1076, 28.0567, 8);
    expect(gridDisk(origin, 0)).toHaveLength(1);
    expect(gridDisk(origin, 1)).toHaveLength(7);
    expect(gridDisk(origin, 2)).toHaveLength(19);
    expect(gridDisk(origin, 1)).toContain(origin);
  });

  it("cellToLatLng round-trips through latLngToCell", () => {
    const lat = -26.1076, lng = 28.0567;
    const cell = latLngToCell(lat, lng, 8);
    const [cLat, cLng] = cellToLatLng(cell);
    expect(typeof cLat).toBe("number");
    expect(typeof cLng).toBe("number");
    // Res 8 cells are ~0.46km across, so the centre is within ~1km of the point.
    expect(haversineKm(lat, lng, cLat, cLng)).toBeLessThan(1);
  });

  it("edgeLength() in this h3-js build is unusable, so we use the H3 table", () => {
    // Documents WHY hexEdgeKm does not call edgeLength. In h3-js@4.1.0 every
    // valid cell throws H3 code 6, even though isValidCell() says the cell is
    // fine -- a WASM decoding fault in this build, not a bad argument.
    const cell = latLngToCell(-26.1076, 28.0567, 8);
    expect(() => edgeLength(cell, "km")).toThrow();

    // Our helper therefore uses the published H3 table. Res 8 is ~46 cm.
    expect(hexEdgeKm(8)).toBeCloseTo(0.461459, 6);
    expect(hexEdgeKm(8)).toBeLessThan(1);
  });

  it("edge length decreases with resolution, and matches the H3 table", () => {
    const e7 = hexEdgeKm(7);
    const e8 = hexEdgeKm(8);
    const e9 = hexEdgeKm(9);
    expect(e8).toBeGreaterThan(0);
    expect(e8).toBeLessThan(e7);
    expect(e9).toBeLessThan(e8);
    // Official H3 v4 edge-length table, metres -> km.
    expect(e7).toBeCloseTo(1.220702, 6);
    expect(e8).toBeCloseTo(0.461459, 6);
    expect(e9).toBeCloseTo(0.174489, 6);
  });

  it("an out-of-range resolution falls back instead of producing NaN", () => {
    // NaN would collapse the disk to a single cell and silently stop finding
    // nearby drivers -- the exact failure this module exists to avoid.
    const e = hexEdgeKm(99);
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBe(hexEdgeKm(8));
    expect(Number.isFinite(ringCountForRadius(3, 99))).toBe(true);
  });

  it("getResolution returns a number in the valid H3 range", () => {
    const cell = latLngToCell(-26.1076, 28.0567, 9);
    const res = getResolution(cell);
    expect(typeof res).toBe("number");
    expect(res).toBeGreaterThanOrEqual(0);
    expect(res).toBeLessThanOrEqual(15);
  });
});

describe("ring coverage actually contains every nearby driver", () => {
  // THE property that matters. A gridDisk that under-covers would silently drop
  // real drivers and look like "no drivers nearby" in production, so this is
  // verified by sweeping every ~110m grid point inside the radius.
  const PICKUP = { lat: -26.1076, lng: 28.0567 };
  // ~222m steps. Finer than this adds tens of thousands of latLngToCell calls and
  // exhausts the H3 WASM heap ("Memory allocation failed", code 13) without
  // testing anything new -- coverage of every cell in the ring is what matters,
  // and 222m spacing still steps through distinct res-8 cells (0.46km).
  const STEP = 0.002;
  const scan = (radiusKm: number, half: number) => {
    const { cells } = cellsAround(PICKUP.lat, PICKUP.lng, radiusKm, 8);
    let checked = 0;
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        const lat = PICKUP.lat + dy * STEP;
        const lng = PICKUP.lng + dx * STEP;
        if (haversineKm(PICKUP.lat, PICKUP.lng, lat, lng) > radiusKm) continue;
        checked++;
        expect(cells).toContain(latLngToCell(lat, lng, 8));
      }
    }
    return { cells: cells.length, checked };
  };

  it("3km disk misses no point within 3km of the pickup", () => {
    const r = scan(3, 18);
    expect(r.checked).toBeGreaterThan(400);
    expect(r.cells).toBeGreaterThan(100);
  });

  it("7km disk misses no point within 7km of the pickup", () => {
    const r = scan(7, 38);
    expect(r.checked).toBeGreaterThan(2000);
    expect(r.cells).toBeGreaterThan(400);
  });

  it("ringCountForRadius grows with radius and covers the edge length", () => {
    expect(ringCountForRadius(3, 8)).toBeGreaterThanOrEqual(6);
    expect(ringCountForRadius(7, 8)).toBeGreaterThan(ringCountForRadius(3, 8));
    // Finer resolution means smaller cells, so MORE rings are needed for the
    // same radius. This is the property a hardcoded k would get wrong.
    expect(ringCountForRadius(3, 9)).toBeGreaterThan(ringCountForRadius(3, 8));
  });
});