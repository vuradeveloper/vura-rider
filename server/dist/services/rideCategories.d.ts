/** Canonical tokens. Everything in the DB is one of these. */
export type RideCategory = "economy" | "standard" | "wait_save" | "comfort" | "business" | "premium" | "xl" | "van" | "women" | "electric" | "send";
/** Booking payloads may carry anything; normalise to a known tier id. */
export declare function canonicalTier(raw?: string | null): string;
/**
 * One printed value ("Economy", "Bolt (standard)", "Wait & Save") → token.
 * Order matters: the first matching rule wins, so "women for women" is never
 * swallowed by a shorter keyword. Returns null for words we don't know — they
 * are dropped, not guessed.
 */
export declare function canonicalCategory(raw: string): RideCategory | null;
/** Split any shape the client/report may send (array, "A,B", "A / B") → tokens. */
export declare function normaliseVehicleCategories(raw: unknown): RideCategory[];
/**
 * What an OLD report (no Eligible section — document (3).pdf, Scans.ai 2025)
 * still tells us: Seat Count + Vehicle Desc. Mirrors the real Bolt example —
 * a 7-seat hatchback came back "Economy,XL,Send" — and keeps a plain 5-seat
 * car on economy until a fresh report grants more.
 */
export declare function deriveVehicleCategories(seats?: number | null, bodyType?: string | null): RideCategory[];
export interface CategoryProfileLike {
    vehicle_categories?: unknown;
    vehicle_seats?: number | null;
    body_type?: string | null;
}
/**
 * The categories a candidate actually has: explicit CarScan grant first,
 * seat/body derivation second, plain economy last.
 */
export declare function effectiveCategories(p?: CategoryProfileLike | null): RideCategory[];
/** True when the profile carries a real CarScan grant (not a derivation). */
export declare function hasExplicitCategories(p?: CategoryProfileLike | null): boolean;
/** Does this driver's car belong to the tier the rider asked for? */
export declare function tierAcceptsCategory(tier: string, cats: readonly RideCategory[]): boolean;
//# sourceMappingURL=rideCategories.d.ts.map