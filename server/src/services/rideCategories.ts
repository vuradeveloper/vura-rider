// ─────────────────────────────────────────────────────────────────────────────
// RIDE CLASS CATEGORIES — CarScan "Eligible Categories" → dispatch matching.
//
// WHY: a CarScan report states which ride classes a car is cleared for
// (document (2).pdf: DATSUN GO, 7 seats, "Eligible Categories: Economy,XL,Send").
// Riders pick a tier (go / comfort / xl / black) at booking — so the REQUEST for
// that tier must land on drivers whose car is actually IN that class, near them
// (the match ladder starts at 3 km — config `match_radius_km: [3,5,7]`).
//
// This module is the single source of truth for both sides of that contract:
// the profile PATCH canonicalises what CarScan printed, and dispatch asks
// `tierAcceptsCategory` about every candidate. Unknown words from future
// reports are dropped by canonicalisation and never mis-mapped.
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical tokens. Everything in the DB is one of these. */
export type RideCategory =
  | "economy"
  | "standard"
  | "wait_save"
  | "comfort"
  | "business"
  | "premium"
  | "xl"
  | "van"
  | "women"
  | "electric"
  | "send";

/**
 * Which categories serve which RIDER tier.
 *
 *   go      — the affordable class: Bolt Economy / Bolt (standard) / Wait & Save /
 *             electric cars (an EV is still an economy car for matching).
 *   comfort — Comfort and Business.
 *   xl      — XL and Van (6+ seats), plus electric.
 *   x       — the native app's legacy VuraX id; same class as xl.
 *   black   — Premium and Business (the premium end).
 *
 * A driver with NO recorded categories counts as ['economy'] — most of a new
 * fleet — so ordinary cars keep serving the ordinary tier before every report
 * has been re-imported.
 */
const TIER_ACCEPTS: Record<string, readonly RideCategory[]> = {
  go: ["economy", "standard", "wait_save", "electric"],
  comfort: ["comfort", "business", "electric"],
  xl: ["xl", "van", "electric", "standard", "economy"],
  x: ["xl", "van", "electric", "standard", "economy"],
  black: ["premium", "business"],
};

/** Booking payloads may carry anything; normalise to a known tier id. */
export function canonicalTier(raw?: string | null): string {
  const t = String(raw ?? "go").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TIER_ACCEPTS, t) ? t : "go";
}

/**
 * One printed value ("Economy", "Bolt (standard)", "Wait & Save") → token.
 * Order matters: the first matching rule wins, so "women for women" is never
 * swallowed by a shorter keyword. Returns null for words we don't know — they
 * are dropped, not guessed.
 */
export function canonicalCategory(raw: string): RideCategory | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!s) return null;
  if (s.includes("women")) return "women";
  if (s.includes("wait")) return "wait_save";
  if (s.includes("standard") || s.startsWith("bolt")) return "standard";
  if (s.includes("econom")) return "economy";
  if (s.includes("business")) return "business";
  if (s.includes("comfort")) return "comfort";
  if (s.includes("premium")) return "premium";
  if (s === "xl" || s === "x l" || s.includes("extra large")) return "xl";
  if (s.includes("van") || s.includes("minibus")) return "van";
  if (s.includes("electric") || s === "ev" || s.includes(" e.v.")) return "electric";
  if (s.includes("send")) return "send";
  return null;
}

/** Split any shape the client/report may send (array, "A,B", "A / B") → tokens. */
export function normaliseVehicleCategories(raw: unknown): RideCategory[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) parts.push(...raw.map((v) => String(v ?? "")));
  else if (typeof raw === "string") parts.push(...raw.split(/[,;/|]/));
  else if (raw != null && typeof raw === "object") {
    // JSONB may arrive as { categories: [...] } from an older payload.
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.categories)) parts.push(...o.categories.map((v) => String(v ?? "")));
  }
  const out: RideCategory[] = [];
  for (const p of parts) {
    const tok = canonicalCategory(p);
    if (tok && !out.includes(tok)) out.push(tok);
  }
  return out;
}

/**
 * What an OLD report (no Eligible section — document (3).pdf, Scans.ai 2025)
 * still tells us: Seat Count + Vehicle Desc. Mirrors the real Bolt example —
 * a 7-seat hatchback came back "Economy,XL,Send" — and keeps a plain 5-seat
 * car on economy until a fresh report grants more.
 */
export function deriveVehicleCategories(
  seats?: number | null,
  bodyType?: string | null
): RideCategory[] {
  const n = Number(seats);
  const s = seats != null && Number.isFinite(n) && n > 0 ? n : null;
  const body = String(bodyType ?? "").toLowerCase();
  const isLargeBody = body.includes("van") || body.includes("minibus") || body.includes("mpv");
  if (s == null && !body) return ["economy"];
  if (s != null && s >= 6) {
    return isLargeBody ? ["economy", "xl", "van", "send"] : ["economy", "xl", "send"];
  }
  if (isLargeBody) return ["economy", "xl", "van", "send"];
  return ["economy"];
}

export interface CategoryProfileLike {
  vehicle_categories?: unknown;
  vehicle_seats?: number | null;
  body_type?: string | null;
}

/**
 * The categories a candidate actually has: explicit CarScan grant first,
 * seat/body derivation second, plain economy last.
 */
export function effectiveCategories(p?: CategoryProfileLike | null): RideCategory[] {
  const explicit = normaliseVehicleCategories(p?.vehicle_categories);
  if (explicit.length > 0) return explicit;
  return deriveVehicleCategories(p?.vehicle_seats, p?.body_type);
}

/** True when the profile carries a real CarScan grant (not a derivation). */
export function hasExplicitCategories(p?: CategoryProfileLike | null): boolean {
  return normaliseVehicleCategories(p?.vehicle_categories).length > 0;
}

/** Does this driver's car belong to the tier the rider asked for? */
export function tierAcceptsCategory(tier: string, cats: readonly RideCategory[]): boolean {
  const accepts = TIER_ACCEPTS[canonicalTier(tier)] ?? TIER_ACCEPTS.go;
  return cats.some((c) => accepts.includes(c));
}
