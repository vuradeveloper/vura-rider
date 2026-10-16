// ─────────────────────────────────────────────────────────────────────────────
// Ride class categories — pure-logic unit tests (no DB).
//
// The fixtures are REAL CarScan values:
//   • document (2).pdf — DATSUN GO, 7 seats, "Eligible Categories: Economy,XL,Send"
//   • document (3).pdf — old Scans.ai format, NO Eligible section (5-seat hatch)
//   • the Bolt class list the product spec names: Economy, Bolt (standard),
//     Wait & Save, Comfort, Business, Premium, XL, Van, Women for Women,
//     Electric, Send.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import {
  canonicalCategory,
  canonicalTier,
  deriveVehicleCategories,
  effectiveCategories,
  hasExplicitCategories,
  normaliseVehicleCategories,
  tierAcceptsCategory,
} from "./rideCategories";

describe("canonicalCategory — the Bolt class list", () => {
  it("maps every printed Bolt value to its token", () => {
    const boltList: Array<[string, string]> = [
      ["Economy", "economy"],
      ["Bolt (standard)", "standard"],
      ["Wait & Save", "wait_save"],
      ["Comfort", "comfort"],
      ["Business", "business"],
      ["Premium", "premium"],
      ["XL", "xl"],
      ["Van", "van"],
      ["Women for Women", "women"],
      ["Electric", "electric"],
      ["Send", "send"],
    ];
    for (const [printed, token] of boltList) {
      expect(canonicalCategory(printed), printed).toBe(token);
    }
  });

  it("drops words it does not know instead of guessing", () => {
    expect(canonicalCategory("Sky Taxi")).toBeNull();
    expect(canonicalCategory("")).toBeNull();
  });
});

describe("normaliseVehicleCategories — every shape a report/client can send", () => {
  it("splits the comma form printed on the report", () => {
    expect(normaliseVehicleCategories("Economy,XL,Send")).toEqual(["economy", "xl", "send"]);
  });

  it("accepts arrays, dedupes and drops unknowns", () => {
    expect(normaliseVehicleCategories(["Economy", "economy", "Comfort", "???"])).toEqual([
      "economy",
      "comfort",
    ]);
  });

  it("is idempotent on already-canonical tokens (stored JSONB round-trip)", () => {
    expect(normaliseVehicleCategories(["economy", "xl", "send"])).toEqual(["economy", "xl", "send"]);
  });
});

describe("deriveVehicleCategories — reports without an Eligible section", () => {
  it("reproduces the real Bolt output for a 7-seat hatchback (Datsun Go)", () => {
    // document (2).pdf: Seat Count 7, "Hatch back" — Bolt printed Economy,XL,Send.
    expect(deriveVehicleCategories(7, "hatchback")).toEqual(["economy", "xl", "send"]);
  });

  it("keeps a plain 5-seat car on economy until a fresh report grants more", () => {
    // document (3).pdf: Seat Count 5, "Hatch back", no Eligible section.
    expect(deriveVehicleCategories(5, "hatchback")).toEqual(["economy"]);
  });

  it("adds Van for large bodies", () => {
    expect(deriveVehicleCategories(8, "minibus")).toEqual(["economy", "xl", "van", "send"]);
    expect(deriveVehicleCategories(null, "van")).toEqual(["economy", "xl", "van", "send"]);
  });

  it("defaults to economy when the report said nothing at all", () => {
    expect(deriveVehicleCategories(null, null)).toEqual(["economy"]);
    expect(deriveVehicleCategories(0, "")).toEqual(["economy"]);
  });
});

describe("effectiveCategories / hasExplicitCategories", () => {
  it("an explicit CarScan grant beats seat/body derivation", () => {
    expect(effectiveCategories({ vehicle_categories: ["premium"], vehicle_seats: 4, body_type: "hatch" })).toEqual([
      "premium",
    ]);
    expect(hasExplicitCategories({ vehicle_categories: ["premium"] })).toBe(true);
  });

  it("falls back to derivation, then plain economy", () => {
    expect(effectiveCategories({ vehicle_seats: 7, body_type: "hatchback" })).toEqual([
      "economy",
      "xl",
      "send",
    ]);
    expect(effectiveCategories(undefined)).toEqual(["economy"]);
    expect(hasExplicitCategories(undefined)).toBe(false);
  });
});

describe("tierAcceptsCategory — rider tier → eligible cars", () => {
  it("go is served by economy/standard/wait_save/electric", () => {
    expect(tierAcceptsCategory("go", ["economy"])).toBe(true);
    expect(tierAcceptsCategory("go", ["standard"])).toBe(true);
    expect(tierAcceptsCategory("go", ["wait_save"])).toBe(true);
    expect(tierAcceptsCategory("go", ["premium"])).toBe(false);
    // The real Datsun Go car: its full grant Economy,XL,Send still serves 'go'
    // because the list contains economy.
    expect(tierAcceptsCategory("go", ["economy", "xl", "send"])).toBe(true);
  });

  it("comfort takes comfort/business (+electric), xl takes xl/van (+electric)", () => {
    expect(tierAcceptsCategory("comfort", ["business"])).toBe(true);
    expect(tierAcceptsCategory("comfort", ["economy"])).toBe(false);
    expect(tierAcceptsCategory("xl", ["van"])).toBe(true);
    expect(tierAcceptsCategory("xl", ["economy"])).toBe(false);
    expect(tierAcceptsCategory("xl", ["electric"])).toBe(true);
  });

  it("black is the premium end; the legacy native 'x' id behaves like xl", () => {
    expect(tierAcceptsCategory("black", ["premium"])).toBe(true);
    expect(tierAcceptsCategory("black", ["economy"])).toBe(false);
    expect(tierAcceptsCategory("x", ["xl"])).toBe(true);
  });

  it("an unclassified driver (default economy) serves go but never black", () => {
    const unclassified = effectiveCategories(undefined);
    expect(tierAcceptsCategory("go", unclassified)).toBe(true);
    expect(tierAcceptsCategory("black", unclassified)).toBe(false);
  });

  it("canonicalTier normalises anything the client may send to go", () => {
    expect(canonicalTier("GO")).toBe("go");
    expect(canonicalTier(undefined)).toBe("go");
    expect(canonicalTier("nonsense")).toBe("go");
    expect(canonicalTier("black")).toBe("black");
  });
});
