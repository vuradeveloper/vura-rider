export type BodyType = "hatchback" | "sedan" | "suv" | "bakkie" | "minibus";
export type VehicleCategory = "economy" | "comfort" | "xl";
export declare const BODY_TYPES: {
    id: BodyType;
    label: string;
}[];
/** Stored BY NAME in the DB; mapped to hex here (used by the SVG recolouring). */
export declare const COLOURS: {
    name: string;
    hex: string;
}[];
export declare const DEFAULT_COLOUR = "Silver";
export declare const FALLBACK_BODY: BodyType;
type Entry = {
    model: string;
    body: BodyType;
    category?: VehicleCategory;
};
/** make -> models, most common first. Bakkies and minibuses default to XL. */
export declare const MAKE_MODELS: Record<string, Entry[]>;
/** The catalogue's spelling of a make, or null when it is not in the catalogue. */
export declare function canonicalMake(make?: string | null): string | null;
/** The catalogue entry for a make + model pair (tolerant of spelling and trim). */
export declare function findModel(make?: string | null, model?: string | null): Entry | null;
/**
 * Body type for a car. `explicit` is honoured ONLY when the make/model are not in
 * the catalogue (driver picked "Other" and chose a shape) — a catalogued car can
 * never be given a wrong shape by a client.
 */
export declare function resolveBodyType(make?: string | null, model?: string | null, explicit?: string | null): BodyType;
/** economy / comfort / xl — used by the map marker and the tier list. */
export declare function resolveCategory(make?: string | null, model?: string | null, body?: BodyType | null): VehicleCategory;
/** Map any typed colour onto a palette NAME (the DB stores names, not hex). */
export declare function colourName(raw?: string | null): string;
/** Hex for a colour name — never throws, never returns an empty string. */
export declare function colourHex(raw?: string | null): string;
/** Plates are stored uppercase with no spaces/dashes: "CA 123 456" -> "CA123456". */
export declare function normalisePlate(raw?: string | null): string;
/** Does this record still need the one-time "Confirm your vehicle" screen? */
export declare function vehicleNeedsConfirming(v: {
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_color?: string | null;
    license_plate?: string | null;
    body_type?: string | null;
} | null | undefined): boolean;
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
export declare function catalogueForApi(pairs?: {
    make: string;
    model: string;
}[] | null): {
    body_types: {
        id: BodyType;
        label: string;
    }[];
    colours: {
        name: string;
        hex: string;
    }[];
    default_colour: string;
    fallback_body_type: BodyType;
    makes: {
        make: string;
        models: {
            model: string;
            body_type: BodyType;
            category: VehicleCategory;
        }[];
    }[];
};
export {};
//# sourceMappingURL=vehicleCatalogue.d.ts.map