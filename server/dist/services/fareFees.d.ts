import { type WalletConfig } from "./walletService";
/** Default booking fee, percent of the fare. Rider-paid, on top of the fare. */
export declare const DEFAULT_BOOKING_FEE_PCT = 4;
/**
 * Configured booking fee percentage. Clamped to a sane range so a typo in the
 * environment can never charge a rider 400%.
 */
export declare function bookingFeePct(): number;
/** Booking fee in cents for a fare in cents. Rounds to the nearest cent. */
export declare function bookingFeeCentsFor(fareCents: number, pct?: number): number;
export interface RideFareBreakdown {
    fare_cents: number;
    booking_fee_cents: number;
    rider_total_cents: number;
    commission_cents: number;
    platform_cents: number;
    driver_net_cents: number;
}
/** Rand-denominated breakdown the driver app can display before accepting. */
export interface DriverOfferBreakdown {
    fare: number;
    commission: number;
    bookingFee: number;
    riderTotal: number;
    driverNet: number;
}
/**
 * Complete money breakdown for one fare. `commissionSplit` is the same
 * function the driver wallet uses, so the number sent to Paystack and the
 * number shown to the driver can never disagree.
 */
export declare function rideFareBreakdown(fareRands: number, cfg?: WalletConfig, bookingFeePercent?: number): RideFareBreakdown;
/**
 * The driver-facing version of the same calculation, in rands. Used by the
 * offer payload and the driver feed so the number on the request screen is the
 * exact number that will be written to the wallet after the trip.
 */
export declare function driverOfferBreakdown(fareRands: number, cfg?: WalletConfig, bookingFeePercent?: number): DriverOfferBreakdown;
/** The amount Vura keeps from one fare, in cents (commission + booking fee). */
export declare function platformShareCents(fareRands: number, cfg?: WalletConfig): number;
//# sourceMappingURL=fareFees.d.ts.map