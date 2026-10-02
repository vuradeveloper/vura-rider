// ─────────────────────────────────────────────────────────────────────────────
// VEHICLE CATALOGUE — the single source of truth for a driver's car.
//
// WHY THIS EXISTS: the driver typed make / model / colour by hand, so the same car
// arrived as "VW Polo", "polo" or "Volkswagen" and the colour as "White", "white"
// or "wit". The rider's car card needs a body SHAPE and a colour HEX, which free
// text can never give reliably, so this table normalises the common South African
// cars into a body type and the colours into hex values.
//
// Plain data only — no images, no API keys, no third-party service, nothing
// licensed. Safe to serve to both apps.
// ─────────────────────────────────────────────────────────────────────────────

export type BodyType = "hatchback" | "sedan" | "suv" | "bakkie" | "minibus";
export type VehicleCategory = "economy" | "comfort" | "xl";

export const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: "hatchback", label: "Hatchback" },
  { id: "sedan", label: "Sedan" },
  { id: "suv", label: "SUV / Crossover" },
  { id: "bakkie", label: "Bakkie / Pickup" },
  { id: "minibus", label: "Minibus / MPV" },
];

/** Stored BY NAME in the DB; mapped to hex here (used by the SVG recolouring). */
export const COLOURS: { name: string; hex: string }[] = [
  { name: "White", hex: "#F5F5F5" },
  { name: "Black", hex: "#1C1C1E" },
  { name: "Silver", hex: "#C0C4C8" },
  { name: "Grey", hex: "#7A7F85" },
  { name: "Red", hex: "#C62828" },
  { name: "Blue", hex: "#1E4FA3" },
  { name: "Green", hex: "#2E7D32" },
  { name: "Brown", hex: "#6D4C41" },
  { name: "Gold", hex: "#C9A227" },
  { name: "Orange", hex: "#EF6C00" },
  { name: "Yellow", hex: "#F9C80E" },
  { name: "Beige", hex: "#D9C7A3" },
];

export const DEFAULT_COLOUR = "Silver";
export const FALLBACK_BODY: BodyType = "hatchback";

type Entry = { model: string; body: BodyType; category?: VehicleCategory };

/** make -> models, most common first. Bakkies and minibuses default to XL. */
export const MAKE_MODELS: Record<string, Entry[]> = {
  Volkswagen: [
    { model: "Polo", body: "hatchback" },
    { model: "Polo Vivo", body: "hatchback" },
    { model: "Polo Sedan", body: "sedan" },
    { model: "Golf", body: "hatchback" },
    { model: "Caddy", body: "minibus" },
    { model: "T-Cross", body: "suv" },
    { model: "Tiguan", body: "suv" },
    { model: "Amarok", body: "bakkie" },
    { model: "Crafter", body: "minibus", category: "xl" },
    // Every model below is in the image library, so a driver can pick it. Without an
    // entry here the body shape and the tier would be GUESSED (hatchback/economy).
    { model: "Jetta", body: "sedan" },
    { model: "Touran", body: "minibus", category: "xl" },
    // NOT a Volkswagen at all - the Car DB carries a `volkswagen|v-class` row by mistake
    // (it is a Mercedes V-Class). It is listed here only so that the nonsense car still
    // gets a sane shape and tier; the real fix is to delete that DB row.
    { model: "V-Class", body: "minibus", category: "xl" },
  ],
  Toyota: [
    { model: "Starlet", body: "hatchback" },
    { model: "Etios", body: "hatchback" },
    { model: "Corolla Quest", body: "sedan" },
    { model: "Corolla", body: "sedan" },
    { model: "Rush", body: "suv" },
    { model: "Urban Cruiser", body: "suv" },
    { model: "Fortuner", body: "suv", category: "xl" },
    { model: "Hilux", body: "bakkie", category: "xl" },
    { model: "Quantum", body: "minibus", category: "xl" },
    { model: "Avanza", body: "minibus", category: "xl" },
    { model: "Yaris", body: "hatchback" },
    { model: "Prius", body: "hatchback" },
    { model: "Starlet GP", body: "hatchback" },
    { model: "Etios Liva", body: "hatchback" },
    { model: "Avalon", body: "sedan" },
    { model: "Camry", body: "sedan" },
    { model: "RAV4", body: "suv" },
    { model: "Corolla Cross", body: "suv" },
    { model: "Hiace", body: "minibus", category: "xl" },
    { model: "Innova", body: "minibus", category: "xl" },
    { model: "Sienna", body: "minibus", category: "xl" },
  ],
  Suzuki: [
    { model: "Swift", body: "hatchback" },
    { model: "Dzire", body: "sedan" },
    { model: "Vitara Brezza", body: "suv" },
    { model: "Jimny", body: "suv" },
    { model: "Ertiga", body: "minibus", category: "xl" },
    { model: "Baleno", body: "hatchback" },
    { model: "Celerio", body: "hatchback" },
    { model: "S-Presso", body: "hatchback" },
    { model: "Ciaz", body: "sedan" },
  ],
  Hyundai: [
    { model: "i10", body: "hatchback" },
    { model: "Grand i10", body: "hatchback" },
    { model: "Atos", body: "hatchback" },
    { model: "i20", body: "hatchback" },
    { model: "Accent", body: "sedan" },
    { model: "Venue", body: "suv" },
    { model: "H1", body: "minibus", category: "xl" },
    { model: "Elantra", body: "sedan" },
    { model: "Ioniq", body: "hatchback" },
    { model: "Creta", body: "suv" },
    { model: "Kona EV", body: "suv" },
    { model: "Staria", body: "minibus", category: "xl" },
  ],
  Kia: [
    { model: "Picanto", body: "hatchback" },
    { model: "Rio", body: "hatchback" },
    { model: "Pegas", body: "sedan" },
    { model: "Sonet", body: "suv" },
    { model: "Sportage", body: "suv" },
    { model: "K2700", body: "bakkie", category: "xl" },
    { model: "Ceed", body: "hatchback" },
    { model: "Soul", body: "hatchback" },
    { model: "Cerato", body: "sedan" },
    { model: "Niro EV", body: "suv" },
    { model: "Carnival", body: "minibus", category: "xl" },
    { model: "Sedona", body: "minibus", category: "xl" },
  ],
  Renault: [
    { model: "Kwid", body: "hatchback" },
    { model: "Clio", body: "hatchback" },
    { model: "Sandero", body: "hatchback" },
    { model: "Duster", body: "suv" },
    { model: "Triber", body: "minibus", category: "xl" },
    { model: "Logan", body: "sedan" },
  ],
  Ford: [
    { model: "Figo", body: "hatchback" },
    { model: "Fiesta", body: "hatchback" },
    { model: "Focus", body: "hatchback" },
    { model: "EcoSport", body: "suv" },
    { model: "Ranger", body: "bakkie", category: "xl" },
    { model: "Everest", body: "suv", category: "xl" },
    { model: "Transit", body: "minibus", category: "xl" },
    { model: "Tourneo Custom", body: "minibus", category: "xl" },
  ],
  Nissan: [
    { model: "Micra", body: "hatchback" },
    { model: "Almera", body: "sedan" },
    { model: "Magnite", body: "suv" },
    { model: "X-Trail", body: "suv" },
    { model: "NP200", body: "bakkie" },
    { model: "NP300", body: "bakkie" },
    { model: "Navara", body: "bakkie" },
    { model: "NV350", body: "minibus", category: "xl" },
    { model: "Leaf", body: "hatchback" },
    { model: "Tiida", body: "hatchback" },
    { model: "Sentra", body: "sedan" },
    { model: "Versa", body: "sedan" },
    { model: "NV200", body: "minibus", category: "xl" },
    { model: "Serena", body: "minibus", category: "xl" },
  ],
  Isuzu: [
    { model: "D-Max", body: "bakkie", category: "xl" },
    { model: "MU-X", body: "suv", category: "xl" },
  ],
  Haval: [
    { model: "Jolion", body: "suv" },
    { model: "H6", body: "suv" },
  ],
  Chery: [
    { model: "Tiggo 4 Pro", body: "suv" },
    { model: "Tiggo 7 Pro", body: "suv" },
  ],
  Honda: [
    { model: "Fit", body: "hatchback" },
    { model: "Ballade", body: "sedan" },
    { model: "Amaze", body: "sedan" },
    { model: "BR-V", body: "minibus", category: "xl" },
    { model: "Jazz", body: "hatchback" },
    { model: "City", body: "sedan" },
    { model: "Civic", body: "sedan" },
    { model: "Accord", body: "sedan" },
    { model: "Odyssey", body: "minibus", category: "xl" },
  ],
  Mahindra: [
    { model: "XUV300", body: "suv" },
    { model: "Scorpio", body: "suv", category: "xl" },
    { model: "Pik Up", body: "bakkie", category: "xl" },
  ],
  Mazda: [
    { model: "Mazda2", body: "hatchback" },
    { model: "Mazda3", body: "sedan" },
    { model: "CX-3", body: "suv" },
    { model: "CX-5", body: "suv" },
    { model: "2", body: "hatchback" },
    { model: "2 Hatch", body: "hatchback" },
    { model: "3", body: "sedan" },
    { model: "3 Hatch", body: "hatchback" },
  ],
  "Mercedes-Benz": [
    { model: "A-Class", body: "hatchback" },
    { model: "C-Class", body: "sedan" },
    { model: "GLC", body: "suv", category: "xl" },
    { model: "Vito", body: "minibus", category: "xl" },
    { model: "Sprinter", body: "minibus", category: "xl" },
    { model: "E-Class", body: "sedan" },
    { model: "S-Class", body: "sedan" },
    { model: "V-Class", body: "minibus", category: "xl" },
  ],
  BMW: [
    { model: "1 Series", body: "hatchback" },
    { model: "3 Series", body: "sedan" },
    { model: "X1", body: "suv" },
    { model: "X3", body: "suv" },
    { model: "5 Series", body: "sedan" },
    { model: "7 Series", body: "sedan" },
  ],
  Audi: [
    { model: "A1", body: "hatchback" },
    { model: "A3", body: "sedan" },
    { model: "Q3", body: "suv" },
    { model: "A4", body: "sedan" },
    { model: "A5", body: "sedan" },
    { model: "Q5", body: "suv" },
  ],
  Opel: [
    { model: "Corsa", body: "hatchback" },
    { model: "Astra", body: "hatchback" },
  ],
  Mitsubishi: [
    { model: "Triton", body: "bakkie", category: "xl" },
    { model: "Pajero", body: "suv", category: "xl" },
    { model: "Attrage", body: "sedan" },
    { model: "Mirage", body: "hatchback" },
    { model: "Mirage Hatch", body: "hatchback" },
  ],
  GWM: [
    { model: "Steed", body: "bakkie" },
    { model: "P-Series", body: "bakkie", category: "xl" },
    { model: "Ora 07", body: "sedan" },
    { model: "Ora Excel", body: "hatchback" },
  ],
  Datsun: [{ model: "Go", body: "hatchback" }],
  Fiat: [{ model: "Uno", body: "hatchback" }],
  Peugeot: [
    { model: "208", body: "hatchback" },
    { model: "2008", body: "suv" },
    { model: "108", body: "hatchback" },
    { model: "308", body: "hatchback" },
    { model: "301", body: "sedan" },
  ],
  // ── makes that came in with the Car DB image library ────────────────────────
  // None of these were in the original short list, but every one of them is a car a
  // driver can now pick, so each needs a real body type and tier rather than a guess.
  Bajaj: [{ model: "Qute", body: "hatchback" }],
  Byd: [
    { model: "Dolphin", body: "hatchback" },
    { model: "Atto 3", body: "suv" },
    { model: "Yuan Plus", body: "suv" },
    { model: "Seal", body: "sedan" },
  ],
  Chevrolet: [
    { model: "Spark", body: "hatchback" },
    { model: "Aveo Sonic", body: "sedan" },
    { model: "Cruze", body: "sedan" },
    { model: "Spin", body: "minibus", category: "xl" },
    { model: "Suburban", body: "suv", category: "xl" },
  ],
  Citroen: [{ model: "C3 Aircross", body: "suv" }],
  Lexus: [
    { model: "ES", body: "sedan" },
    { model: "NX", body: "suv" },
  ],
  Maxus: [{ model: "G10", body: "minibus", category: "xl" }],
  MG: [{ model: "ZS EV", body: "suv" }],
  Tesla: [
    { model: "Model 3", body: "sedan" },
    { model: "Model S", body: "sedan" },
    { model: "Model Y", body: "suv" },
  ],
  Volvo: [
    { model: "EX30", body: "suv" },
    { model: "S60", body: "sedan" },
    { model: "XC90", body: "suv", category: "xl" },
  ],
};

/** Drivers and old records type the short forms; map them onto the real make. */
const MAKE_ALIASES: Record<string, string> = {
  vw: "Volkswagen",
  volkswagen: "Volkswagen",
  toyota: "Toyota",
  suzuki: "Suzuki",
  hyundai: "Hyundai",
  kia: "Kia",
  renault: "Renault",
  ford: "Ford",
  nissan: "Nissan",
  isuzu: "Isuzu",
  haval: "Haval",
  chery: "Chery",
  honda: "Honda",
  mahindra: "Mahindra",
  mazda: "Mazda",
  mercedes: "Mercedes-Benz",
  "mercedes-benz": "Mercedes-Benz",
  "mercedes benz": "Mercedes-Benz",
  benz: "Mercedes-Benz",
  bmw: "BMW",
  audi: "Audi",
  opel: "Opel",
  mitsubishi: "Mitsubishi",
  gwm: "GWM",
  datsun: "Datsun",
  fiat: "Fiat",
  peugeot: "Peugeot",
};

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    // Dashes and underscores mean a SPACE here, because the same car arrives as
    // "3 Series" (this catalogue) and "3-series" (the DB, via normToken on save).
    // Without this they never matched, so `findModel("BMW", "3-series")` returned null
    // and the car fell back to a GUESSED hatchback/economy - which is wrong for a 3
    // Series in every way that matters (shape on the card, tier on the map).
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

/** The catalogue's spelling of a make, or null when it is not in the catalogue. */
export function canonicalMake(make?: string | null): string | null {
  const raw = norm(make);
  if (!raw) return null;
  const direct = Object.keys(MAKE_MODELS).find((m) => norm(m) === raw);
  if (direct) return direct;
  const alias = MAKE_ALIASES[raw.replace(/[.]/g, "")];
  if (alias) return alias;
  // A model typed into the make field ("Polo") still resolves to its make.
  const inside = Object.keys(MAKE_MODELS).find((m) => raw.includes(norm(m)));
  return inside || null;
}

/** The catalogue entry for a make + model pair (tolerant of spelling and trim). */
export function findModel(make?: string | null, model?: string | null): Entry | null {
  const mk = canonicalMake(make);
  if (!mk) return null;
  const raw = norm(model);
  if (!raw) return null;
  const list = MAKE_MODELS[mk];
  const exact = list.find((e) => norm(e.model) === raw);
  if (exact) return exact;
  // "Polo Vivo 1.4" or "Polo hatch" — longest catalogue model contained in input.
  return (
    list
      .filter((e) => raw.includes(norm(e.model)))
      .sort((a, b) => b.model.length - a.model.length)[0] || null
  );
}

/**
 * Body type for a car. `explicit` is honoured ONLY when the make/model are not in
 * the catalogue (driver picked "Other" and chose a shape) — a catalogued car can
 * never be given a wrong shape by a client.
 */
export function resolveBodyType(
  make?: string | null,
  model?: string | null,
  explicit?: string | null
): BodyType {
  const found = findModel(make, model);
  if (found) return found.body;
  const wanted = norm(explicit);
  const known = BODY_TYPES.find((b) => b.id === wanted);
  return known ? known.id : FALLBACK_BODY;
}

/** economy / comfort / xl — used by the map marker and the tier list. */
export function resolveCategory(
  make?: string | null,
  model?: string | null,
  body?: BodyType | null
): VehicleCategory {
  const found = findModel(make, model);
  if (found?.category) return found.category;
  const b = found?.body || body || FALLBACK_BODY;
  if (b === "bakkie" || b === "minibus" || b === "suv") return "xl";
  if (b === "sedan") return "comfort";
  return "economy";
}

/** Map any typed colour onto a palette NAME (the DB stores names, not hex). */
export function colourName(raw?: string | null): string {
  const s = norm(raw);
  if (!s) return DEFAULT_COLOUR;
  const exact = COLOURS.find((c) => norm(c.name) === s);
  if (exact) return exact.name;
  if (/^(wit|white|blanc)/.test(s)) return "White";
  if (/^(black|swart)/.test(s)) return "Black";
  if (/^(silver|chrome)/.test(s)) return "Silver";
  if (/^(grey|gray|charcoal)/.test(s)) return "Grey";
  if (/red|rooi/.test(s)) return "Red";
  if (/blue|blou/.test(s)) return "Blue";
  if (/green|groen/.test(s)) return "Green";
  if (/brown|maroon/.test(s)) return "Brown";
  if (/gold|champagne/.test(s)) return "Gold";
  if (/orange/.test(s)) return "Orange";
  if (/yellow|geel/.test(s)) return "Yellow";
  if (/beige|cream|tan/.test(s)) return "Beige";
  return DEFAULT_COLOUR;
}

/** Hex for a colour name — never throws, never returns an empty string. */
export function colourHex(raw?: string | null): string {
  const name = colourName(raw);
  return (COLOURS.find((c) => c.name === name) || COLOURS[2]).hex;
}

/** Plates are stored uppercase with no spaces/dashes: "CA 123 456" -> "CA123456". */
export function normalisePlate(raw?: string | null): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

/** Does this record still need the one-time "Confirm your vehicle" screen? */
export function vehicleNeedsConfirming(
  v:
    | {
        vehicle_make?: string | null;
        vehicle_model?: string | null;
        vehicle_color?: string | null;
        license_plate?: string | null;
        body_type?: string | null;
      }
    | null
    | undefined
): boolean {
  if (!v) return true;
  if (!String(v.vehicle_make || "").trim()) return true;
  if (!String(v.vehicle_model || "").trim()) return true;
  if (normalisePlate(v.license_plate).length < 4) return true;
  if (!COLOURS.some((c) => norm(c.name) === norm(v.vehicle_color))) return true;
  return !findModel(v.vehicle_make, v.vehicle_model);
}

/**
 * Payload for GET /api/drivers/vehicle-catalogue (reference data, not personal).
 *
 * Pass `pairs` (make|model tokens from vehicle_images) to restrict the dropdown to
 * cars that actually HAVE a photo. That is the difference between a driver picking a
 * car and a driver picking a car the rider will then see drawn as an SVG: every entry
 * returned here is guaranteed to resolve to an image.
 *
 * `model` is returned as a human label ("Polo Hatch"), not the raw DB token
 * ("polo-hatch"). The two round-trip: the server's normToken() converts the label
 * back to the token on save, so the app needs no change and the model still matches.
 */
export function catalogueForApi(
  pairs?: { make: string; model: string }[] | null
) {
  const base = {
    body_types: BODY_TYPES,
    colours: COLOURS,
    default_colour: DEFAULT_COLOUR,
    fallback_body_type: FALLBACK_BODY,
  };

  if (!pairs || !pairs.length) {
    return {
      makes: Object.keys(MAKE_MODELS).map((make) => ({
        make,
        models: MAKE_MODELS[make].map((e) => ({
          model: e.model,
          body_type: e.body,
          category: e.category || resolveCategory(make, e.model, e.body),
        })),
      })),
      ...base,
    };
  }

  const byMake = new Map<string, { model: string; body_type: BodyType; category: VehicleCategory; order: number }[]>();
  pairs.forEach((p, i) => {
    // Prefer the CATALOGUE's own spelling when this IS a catalogue car, so the dropdown
    // reads "XC90", "BR-V", "ZS EV", "S-Presso" instead of the prettifier's "Xc90",
    // "Br V", "Zs Ev", "S Presso". A car that only matches as a variant (polo-hatch ->
    // Polo, golf-mk7 -> Golf) keeps its own label, because there the extra word IS the
    // generation the driver is choosing between.
    const hit = findModel(p.make, p.model);
    const label = hit && norm(hit.model) === norm(p.model) ? hit.model : prettifyModel(p.model);
    if (!label) return;
    if (!byMake.has(p.make)) byMake.set(p.make, []);
    const list = byMake.get(p.make)!;
    if (list.some((e) => norm(e.model) === norm(label))) return;
    const body = resolveBodyType(p.make, p.model);
    list.push({
      model: label,
      body_type: body,
      category: resolveCategory(p.make, p.model, body),
      order: i,
    });
  });

  return {
    makes: [...byMake.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([make, models]) => ({
        make: displayMake(make),
        models: models
          .sort((a, b) => a.model.localeCompare(b.model))
          .map(({ model, body_type, category }) => ({ model, body_type, category })),
      })),
    ...base,
  };
}

/** "polo-hatch" -> "Polo Hatch"; "3-series" -> "3 Series"; "a4" -> "A4". */
function prettifyModel(token?: string | null): string {
  const s = String(token ?? "").trim().replace(/-+/g, " ").replace(/\s+/g, " ");
  if (!s) return "";
  return s
    .split(" ")
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Catalogue spelling when known, else a readable fallback ("byd" -> "Byd"). */
function displayMake(token: string): string {
  return canonicalMake(token) || prettifyModel(token);
}



