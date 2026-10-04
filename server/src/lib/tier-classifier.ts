// server/src/lib/tier-classifier.ts
// Vura Vehicle Tier Classification Engine (TypeScript port of the Python
// reference module). Input: driver-submitted vehicle details (assumed already
// correct/complete — extraction/verification happens upstream). Output: a
// list of TierAssignment objects — a vehicle can hold more than one tier at
// once (e.g. COMFORT + GREEN).
//
// Design rules (see vura-vehicle-tier-schema.md for the full rationale):
//   1. Catalog lookup first (exact make+model+derivative, then make+model,
//      then brand-level for premium marques).
//   2. Catalog matches are STILL run through the hard filters (age/body/
//      doors/seats) — a curated entry doesn't override a vehicle that's
//      aged out or has the wrong body type.
//   3. Unmatched vehicles fall through to a heuristic scorer based on body
//      type, doors, seats and age — and always land on the LOWEST eligible
//      tier, flagged 'pending_review', never guessed into Premium.
//   4. Brand-gated tiers (requires_brand_allowlist) can NEVER be reached by
//      heuristic fallback — only by an exact/brand-level catalog match that
//      also passes the hard filters, or a manual override.
//   5. GREEN is an overlay tag, independent of base tier assignment.

// ---------------------------------------------------------------------------
// Tier definitions — edit this table to change business rules; nothing below
// this block should need to change when tiers/thresholds are adjusted.
// ---------------------------------------------------------------------------

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

export const TIER_DEFINITIONS: Record<string, TierDefinition> = {
  GO: {
    tier_code: "GO",
    display_name: "Vura Go",
    max_age_years: 12,
    min_doors: 4,
    min_seats: 4,
    allowed_body_types: ["hatchback", "sedan"],
  },
  COMFORT: {
    tier_code: "COMFORT",
    display_name: "Vura Comfort",
    max_age_years: 5,
    min_doors: 4,
    min_seats: 4,
    allowed_body_types: ["sedan", "suv", "mpv"],
  },
  PREMIUM: {
    tier_code: "PREMIUM",
    display_name: "Vura Premium",
    max_age_years: 5,
    min_doors: 4,
    min_seats: 4,
    allowed_body_types: ["sedan", "suv"],
    requires_brand_allowlist: true,
  },
  GREEN: {
    tier_code: "GREEN",
    display_name: "Vura Green",
    is_overlay: true,
  },
};

// Used to pick the "lowest" eligible tier when several qualify heuristically
export const TIER_RANK: Record<string, number> = { GO: 0, COMFORT: 1, PREMIUM: 2 };

export const PREMIUM_BRAND_ALLOWLIST = new Set(["bmw", "audi", "mercedes-benz", "lexus"]);

export const MAKE_ALIASES: Record<string, string> = {
  vw: "volkswagen",
  "mercedes benz": "mercedes-benz",
  mercedes: "mercedes-benz",
};

// Seed catalog — (make, model, derivative) -> tier. model/derivative = null
// means "any". Grow this over time from the review queue (see schema doc).
interface CatalogRow {
  make: string;
  model: string | null;
  derivative: string | null;
  tier: string;
}

export const CATALOG: CatalogRow[] = [
  { make: "kia", model: "picanto", derivative: null, tier: "GO" },
  { make: "volkswagen", model: "polo vivo", derivative: null, tier: "GO" },
  { make: "toyota", model: "corolla quest", derivative: null, tier: "GO" },
  { make: "toyota", model: "corolla", derivative: "quest", tier: "GO" },
  { make: "toyota", model: "corolla", derivative: null, tier: "COMFORT" },
  { make: "volkswagen", model: "polo", derivative: "vivo", tier: "GO" },
  { make: "volkswagen", model: "polo", derivative: null, tier: "COMFORT" },
  { make: "nissan", model: "almera", derivative: null, tier: "COMFORT" },
  { make: "hyundai", model: "elantra", derivative: null, tier: "COMFORT" },
  { make: "hyundai", model: "grand i10", derivative: null, tier: "GO" },
  { make: "bmw", model: null, derivative: null, tier: "PREMIUM" },
  { make: "audi", model: null, derivative: null, tier: "PREMIUM" },
  { make: "mercedes-benz", model: null, derivative: null, tier: "PREMIUM" },
  { make: "lexus", model: null, derivative: null, tier: "PREMIUM" },
];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeMake(make: string): string {
  const m = (make || "").trim().toLowerCase();
  return MAKE_ALIASES[m] ?? m;
}

export function normalizeModel(model: string): string {
  return (model || "").trim().toLowerCase();
}

export function normalizeDerivative(d: string | null | undefined): string | null {
  return d ? d.trim().toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

export interface VehicleInput {
  vin: string;
  make: string;
  model: string;
  model_year: number;
  body_type: string; // 'hatchback','sedan','suv','mpv','van'
  fuel_type: string; // 'petrol','diesel','electric','hybrid'
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

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function catalogLookup(
  nmake: string,
  nmodel: string,
  nderiv: string | null
): { row: CatalogRow | null; confidence: number } {
  // exact match incl. derivative
  for (const row of CATALOG) {
    if (row.make === nmake && row.model === nmodel && row.derivative === nderiv) {
      return { row, confidence: 1.0 };
    }
  }
  // make + model, ignore derivative
  for (const row of CATALOG) {
    if (row.make === nmake && row.model === nmodel && row.derivative === null) {
      return { row, confidence: 0.9 };
    }
  }
  // brand-level (premium marques)
  for (const row of CATALOG) {
    if (row.make === nmake && row.model === null) {
      return { row, confidence: 0.85 };
    }
  }
  return { row: null, confidence: 0 };
}

function passesHardFilters(tier: TierDefinition, v: VehicleInput, today: Date): boolean {
  const bodyTypes = tier.allowed_body_types || [];
  if (!bodyTypes.includes(v.body_type)) return false;
  if (v.doors < (tier.min_doors ?? 0)) return false;
  if (v.seats < (tier.min_seats ?? 0)) return false;
  if (tier.max_age_years != null && today.getFullYear() - v.model_year > tier.max_age_years) {
    return false;
  }
  if (tier.requires_brand_allowlist && !PREMIUM_BRAND_ALLOWLIST.has(normalizeMake(v.make))) {
    return false;
  }
  return true;
}

export function classifyVehicle(v: VehicleInput, today: Date = new Date()): TierAssignment[] {
  const nmake = normalizeMake(v.make);
  const nmodel = normalizeModel(v.model);
  const nderiv = normalizeDerivative(v.derivative);

  const assignments: TierAssignment[] = [];

  const { row: match, confidence: baseConf } = catalogLookup(nmake, nmodel, nderiv);

  if (match) {
    const tier = TIER_DEFINITIONS[match.tier];
    if (passesHardFilters(tier, v, today)) {
      assignments.push({ tier_code: tier.tier_code, method: "catalog_match", confidence: baseConf, status: "active" });
    } else {
      // Catalog says this model belongs in tier X, but this specific
      // vehicle's specs disqualify it (too old, wrong body type...).
      // Don't trust the catalog blindly — send it to review instead.
      assignments.push({
        tier_code: tier.tier_code,
        method: "catalog_match_failed_filters",
        confidence: baseConf * 0.5,
        status: "pending_review",
      });
    }
  } else {
    // Outlier path — nothing in the catalog matches this make/model.
    const candidates = Object.values(TIER_DEFINITIONS).filter(
      (tier) =>
        tier.tier_code !== "GREEN" &&
        (tier.active ?? true) &&
        !tier.is_overlay &&
        !tier.requires_brand_allowlist && // NEVER heuristically grant brand-gated tiers
        passesHardFilters(tier, v, today)
    );
    if (candidates.length === 0) {
      assignments.push({ tier_code: "GO", method: "heuristic_fallback", confidence: 0.3, status: "pending_review" });
    } else {
      const best = candidates.reduce((a, b) =>
        TIER_RANK[a.tier_code] <= TIER_RANK[b.tier_code] ? a : b
      );
      const confidence = candidates.length === 1 ? 0.6 : 0.45;
      assignments.push({
        tier_code: best.tier_code,
        method: "heuristic_fallback",
        confidence,
        status: "pending_review",
      });
    }
  }

  // Green overlay — independent of base tier, doesn't consume the match/no-match path above
  if (v.fuel_type === "electric" || v.fuel_type === "hybrid") {
    assignments.push({
      tier_code: "GREEN",
      method: match ? "catalog_match" : "heuristic_fallback",
      confidence: match ? 1.0 : 0.8,
      status: "active",
    });
  }

  return assignments;
}

/** Primary (base, non-overlay) tier code from a list of assignments. */
export function primaryTier(assignments: TierAssignment[]): string | null {
  const base = assignments.find((a) => a.tier_code !== "GREEN");
  return base ? base.tier_code : null;
}
