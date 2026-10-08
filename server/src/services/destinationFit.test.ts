// ─────────────────────────────────────────────────────────────────────────────
// DESTINATION FIT — every fixture from the approved §8.3 table, as unit tests.
// Fixture sphere: 0.01° = 1.112 km (KM = degrees→km factor used below).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { destinationFit, GeoPoint, DEFAULT_FIT_THRESHOLDS } from "./destinationFit";

const p = (lat: number, lng: number): GeoPoint => ({ lat, lng });
const KM = 111.195; // 1° on the R=6371 sphere
const D = p(0, 0);
const T10 = p(0, 0.10); // dAB = 11.12 km, θ = north

interface Fixture {
  n: string;
  D: GeoPoint;
  T: GeoPoint;
  P: GeoPoint;
  X: GeoPoint | null;
  want: "accept" | "reject" | "skip";
  note: string;
}

const FIXTURES: Fixture[] = [
  { n: "1", D, T: T10, P: p(0, 0.02), X: p(0, 0.06), want: "accept", note: "on-corridor: (b) 4.45<8.90, xt≈0, along≈6.67" },
  { n: "2", D, T: T10, P: p(0, 0.03), X: p(0, 0.01), want: "reject", note: "(b): drop-off away from T (9.91 > 7.78)" },
  { n: "3", D, T: T10, P: p(0, 0.05), X: p(0.01, 0.099), want: "accept", note: "(c1): 1.12 km ≤ 3, off-line" },
  { n: "4", D, T: T10, P: p(0, 0.04), X: p(0.04, 0.07), want: "accept", note: "(c2) only: xt≈4.45≤5, 5.56>3, along≈7.78" },
  { n: "5", D, T: T10, P: p(0, 0.03), X: p(0.05, 0.07), want: "reject", note: "closer than pickup but outside both allowances: (b)✓, c1 6.48>3 ✗, xt 5.56>5 ✗" },
  { n: "6a", D, T: T10, P: p(0, 0.03), X: p(0.044966, 0.05), want: "accept", note: "xt exactly 5 km boundary → ACCEPT (inclusive ≤, float-true)" },
  { n: "6b", D, T: T10, P: p(0, 0.02), X: p(0, 0.10 + 3 / KM), want: "accept", note: "X exactly 3 km beyond T → (c1) inclusive ≤" },
  { n: "6c", D, T: T10, P: p(0, 0.06), X: p(0, 0.06), want: "reject", note: "hav(X,T)==hav(P,T) exactly (X at pickup) → (b) strict < REJECTS" },
  { n: "6d-", D, T: p(0, 0.09), P: p(0.06, 0), X: p(0, -0.5 / KM), want: "accept", note: "along exactly −0.5 → ACCEPT (inclusive)" },
  { n: "6d+", D, T: p(0, 0.09), P: p(0.06, 0), X: p(0, -0.501 / KM), want: "reject", note: "along −0.501 < −0.5 → REJECT" },
  { n: "6e-", D, T: p(0, 0.09), P: p(0.06, 0), X: p(4 / KM, 10.49 / KM), want: "accept", note: "along just inside dAB+0.5 (50 m margin, float-safe)" },
  { n: "6e+", D, T: p(0, 0.09), P: p(0.06, 0), X: p(4 / KM, 10.55 / KM), want: "reject", note: "along 10.55 > dAB+0.5 (≈10.51) → REJECT" },
  { n: "7", D, T: T10, P: p(0, 0.02), X: null, want: "skip", note: "X = null → destination-mode driver skipped, plain drivers unaffected" },
  { n: "8a", D: p(0, 0), T: p(0, 0), P: p(0, 0.10), X: p(0, 0.018), want: "accept", note: "dAB≈0 guard → xt:=dAP disk: 2 km ≤ 5 ACCEPT (c1 also passes)" },
  { n: "8b", D: p(0, 0), T: p(0, 0), P: p(0, 0.10), X: p(0, 0.06), want: "reject", note: "dAB≈0 guard: 6.7 km > 5 km disk, (b) still passes" },
  { n: "10", D, T: T10, P: p(0, 0.02), X: p(0, 0.14), want: "reject", note: "beyond T on the line: (b) passes, along≈15.6 > 11.62" },
  { n: "11", D, T: p(0, 0.09), P: p(0.063, 0), X: p(0, -0.018), want: "reject", note: "BEHIND the driver: (b) 12.01<12.22 ✓ xt=0 ✓ — only along (−2.0 < −0.5) rejects" },
  { n: "12", D, T: p(0, 0.09), P: p(0.063, 0), X: p(0, 0.13), want: "reject", note: "BEYOND destination: c1 4.45>3 ✗ xt=0 ✓ along 14.46 > 10.51 ✗" },
  { n: "13", D, T: T10, P: p(0, 0.02), X: p(0, 0.05), want: "accept", note: "exactly on the line mid-segment: xt=0, along≈5.56" },
  { n: "14", D, T: p(0, 0.09), P: p(0.063, 0), X: p(0, 0.09 + 2.99 / KM), want: "accept", note: "3 km boundary just inside (2.99 past T) → (c1) pure disk ACCEPTS even past T" },
  { n: "15", D, T: p(0, 0.09), P: p(0.063, 0), X: p(0, 0.09 + 3.001 / KM), want: "reject", note: "3 km boundary just outside: c1 ✗ xt=0 ✓ along 13.01 > 10.51 ✗" },
  { n: "16", D, T: T10, P: p(0.0648, 0), X: p(0, 0.06), want: "accept", note: "pickup 7.21 km > 7 km rung — radius is SQL's (a); the predicate must not re-implement it" },
  { n: "17", D, T: p(0, 0.008), P: p(0, 0.006), X: p(0, 0.009), want: "accept", note: "D inside the 1 km activation radius — that guard belongs to destinationSession (tested as L1), never to the predicate" },
];

describe("destinationFit — approved §8.2 formula, fixtures 1–17", () => {
  for (const f of FIXTURES) {
    it(`fixture ${f.n}: ${f.note}`, () => {
      expect(destinationFit(f.D, f.T, f.P, f.X)).toBe(f.want);
    });
  }

  it("fixture 9: pure — identical inputs give identical verdicts (×10)", () => {
    const first = destinationFit(D, T10, p(0, 0.02), p(0, 0.06));
    for (let i = 0; i < 10; i++) {
      expect(destinationFit(D, T10, p(0, 0.02), p(0, 0.06))).toBe(first);
    }
    expect(first).toBe("accept");
  });

  it("missing D, T or P fails closed as skip (mode-only geometry)", () => {
    expect(destinationFit(null, T10, p(0, 0.02), p(0, 0.06))).toBe("skip");
    expect(destinationFit(D, null, p(0, 0.02), p(0, 0.06))).toBe("skip");
    expect(destinationFit(D, T10, null, p(0, 0.06))).toBe("skip");
    expect(destinationFit(D, T10, p(0, 0.02), p(NaN, 0))).toBe("skip");
  });

  it("thresholds are injectable (a tightened corridor rejects fixture 4)", () => {
    expect(destinationFit(D, T10, p(0, 0.04), p(0.04, 0.07))).toBe("accept");
    expect(
      destinationFit(D, T10, p(0, 0.04), p(0.04, 0.07), {
        ...DEFAULT_FIT_THRESHOLDS,
        crossTrackKm: 4, // xt ≈ 4.45 > 4
      })
    ).toBe("reject");
  });
});
