// ─────────────────────────────────────────────────────────────────────────────
// RIDE FARE FEES — the single source of truth for what a rider pays and what
// the platform keeps.
//
// Option A (approved by the owner, 10 Nov 2026):
//   fare                 F
//   booking fee          4% of F, paid BY THE RIDER on top of the fare
//   Vura commission      min(10% of F, R5) — taken OUT of the fare
//   driver receives      F − commission
//   Vura receives        commission + booking fee
//   rider pays           F + booking fee
//
// The R5 cap is on the COMMISSION only. The 4% booking fee is a separate
// rider-paid fee, so Vura's total take can exceed R5 on a large fare. The
// driver never pays any part of the booking fee, and never pays more than
// R5 commission.
//
// The Paystack split must use `platform_cents` (commission + booking fee),
// not 10% of the fare: a percentage split would take R10 on a R100 ride.
// ─────────────────────────────────────────────────────────────────────────────

import {
  commissionSplit,
  DEFAULT_WALLET_CONFIG,
  toCents,
  type WalletConfig,
} from "./walletService";

/** Default booking fee, percent of the fare. Rider-paid, on top of the fare. */
export const DEFAULT_BOOKING_FEE_PCT = 4;

/**
 * Configured booking fee percentage. Clamped to a sane range so a typo in the
 * environment can never charge a rider 400%.
 */
export function bookingFeePct(): number {
  const raw = Number(process.env.BOOKING_FEE_PCT);
  if (!Number.isFinite(raw) || raw < 0 || raw > 25) return DEFAULT_BOOKING_FEE_PCT;
  return raw;
}

/** Booking fee in cents for a fare in cents. Rounds to the nearest cent. */
export function bookingFeeCentsFor(
  fareCents: number,
  pct: number = bookingFeePct()
): number {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0));
  const feePct = Number.isFinite(pct) && pct > 0 ? pct : 0;
  return Math.round((fare * feePct) / 100);
}

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
export function rideFareBreakdown(
  fareRands: number,
  cfg: WalletConfig = DEFAULT_WALLET_CONFIG,
  bookingFeePercent: number = bookingFeePct()
): RideFareBreakdown {
  const fareCents = Math.max(0, toCents(fareRands));
  const commissionCents = commissionSplit(fareCents / 100, cfg).commission_cents;
  const bookingFeeCents = bookingFeeCentsFor(fareCents, bookingFeePercent);
  const platformCents = commissionCents + bookingFeeCents;
  return {
    fare_cents: fareCents,
    booking_fee_cents: bookingFeeCents,
    rider_total_cents: fareCents + bookingFeeCents,
    commission_cents: commissionCents,
    platform_cents: platformCents,
    driver_net_cents: fareCents - commissionCents,
  };
}

/**
 * The driver-facing version of the same calculation, in rands. Used by the
 * offer payload and the driver feed so the number on the request screen is the
 * exact number that will be written to the wallet after the trip.
 */
export function driverOfferBreakdown(
  fareRands: number,
  cfg: WalletConfig = DEFAULT_WALLET_CONFIG,
  bookingFeePercent: number = bookingFeePct()
): DriverOfferBreakdown {
  const b = rideFareBreakdown(fareRands, cfg, bookingFeePercent);
  return {
    fare: b.fare_cents / 100,
    commission: b.commission_cents / 100,
    bookingFee: b.booking_fee_cents / 100,
    riderTotal: b.rider_total_cents / 100,
    driverNet: b.driver_net_cents / 100,
  };
}

/** The amount Vura keeps from one fare, in cents (commission + booking fee). */
export function platformShareCents(
  fareRands: number,
  cfg: WalletConfig = DEFAULT_WALLET_CONFIG
): number {
  return rideFareBreakdown(fareRands, cfg).platform_cents;
}
