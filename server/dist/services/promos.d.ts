export type RidePromo = {
    id: string;
    code: string;
    title: string;
    subtitle: string | null;
    audience: string;
    discount_pct: number;
    discount_fixed: number;
};
/**
 * Everything currently live for ONE side of the marketplace. `both` promos
 * appear for riders and drivers alike; newest first so the apps can show [0].
 */
export declare function activePromosForSide(side: "rider" | "driver"): Promise<RidePromo[]>;
/**
 * Resolve the promo a booking refers to (id OR code, case-insensitive),
 * re-checking window + audience for THIS side. Null when it doesn't exist,
 * isn't live, or doesn't apply here — the booking then simply isn't discounted.
 */
export declare function ridePromoFor(side: "rider" | "driver", idOrCode: string | null | undefined): Promise<RidePromo | null>;
/**
 * Apply a promo to a base fare. Percentage promos scale the fare; fixed promos
 * subtract Rands and can never drive the fare below zero. Everything rounds to
 * whole cents — the same precision the payments and ledger code uses.
 */
export declare function applyPromoToFare(fare: number, promo: RidePromo): {
    fare: number;
    discount: number;
};
//# sourceMappingURL=promos.d.ts.map