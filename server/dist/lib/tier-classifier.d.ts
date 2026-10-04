export interface TierDefinition {
    tier_code: string;
    display_name: string;
    is_overlay?: boolean;
    max_age_years?: number | null;
    min_doors?: number;
    min_seats?: number;
    allowed_body_types?: string[];
    requires_brand_allowlist?: boolean;
    active?: boolean;
}
export declare const TIER_DEFINITIONS: Record<string, TierDefinition>;
export declare const TIER_RANK: Record<string, number>;
export declare const PREMIUM_BRAND_ALLOWLIST: Set<string>;
export declare const MAKE_ALIASES: Record<string, string>;
interface CatalogRow {
    make: string;
    model: string | null;
    derivative: string | null;
    tier: string;
}
export declare const CATALOG: CatalogRow[];
export declare function normalizeMake(make: string): string;
export declare function normalizeModel(model: string): string;
export declare function normalizeDerivative(d: string | null | undefined): string | null;
export interface VehicleInput {
    vin: string;
    make: string;
    model: string;
    model_year: number;
    body_type: string;
    fuel_type: string;
    doors: number;
    seats: number;
    derivative?: string | null;
    color?: string | null;
}
export interface TierAssignment {
    tier_code: string;
    method: "catalog_match" | "catalog_match_failed_filters" | "heuristic_fallback";
    confidence: number;
    status: "active" | "pending_review";
}
export declare function classifyVehicle(v: VehicleInput, today?: Date): TierAssignment[];
/** Primary (base, non-overlay) tier code from a list of assignments. */
export declare function primaryTier(assignments: TierAssignment[]): string | null;
export {};
//# sourceMappingURL=tier-classifier.d.ts.map