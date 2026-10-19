export type RidePromo = {
    id: string;
    code: string;
    title: string;
    subtitle: string | null;
    audience: string;
    discount_pct: number;
    discount_fixed: number;
    valid_days: number | null;
    rides_limit: number | null;
    target_user_ids: string[] | null;
    rides_used?: number | null;
    expires_at?: string | null;
    usable?: boolean;
};
/** Parse/validate the console's targeting list; null = everyone. */
export declare function parseTargetUserIds(raw: unknown): string[] | null;
/** Lazy v2 columns/table — same pattern as every money table (works pre-016). */
export declare function ensurePromoTables(): Promise<void>;
/**
 * Everything currently live for ONE side of the marketplace. `both` promos
 * appear for riders and drivers alike; newest first so the apps can show [0].
 * With a userId the per-user redemption state rides along (usable flag), so
 * the app can grey out an exhausted/expired promo instead of offering it.
 */
export declare function activePromosForSide(side: "rider" | "driver", userId?: string | null): Promise<RidePromo[]>;
/**
 * Resolve the promo a booking refers to (id OR code, case-insensitive),
 * re-checking window + audience for THIS side. Null when it doesn't exist,
 * isn't live, or doesn't apply here — the booking then simply isn't discounted.
 */
export declare function ridePromoFor(side: "rider" | "driver", idOrCode: string | null | undefined, userId?: string | null): Promise<RidePromo | null>;
/**
 * Per-user redemption guard: is THIS user still inside the promo's ride budget
 * and validity window? Promos with neither limit set behave exactly as 012.
 */
export declare function promoUsableFor(promo: RidePromo, userId: string): Promise<boolean>;
/**
 * Burn one redemption for this user: the N-DAYS window starts at the FIRST
 * use (expires_at stamped once, then frozen) and rides_used counts up to
 * rides_limit. Fire-and-forget safe — a tracking failure must never break
 * the booking that already happened.
 */
export declare function recordPromoUse(promo: RidePromo, userId: string): Promise<void>;
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