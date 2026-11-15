/**
 * Rider-facing fare quote — the Option A money rule, in one testable place.
 *
 * The server is authoritative (`services/fareFees.ts`): the booking fee is 4%
 * of the fare, added on top and rounded to the nearest cent. Promo discounts
 * and invite credit are applied to the fare BEFORE this function runs, so the
 * rider sees the fee on the fare they will actually be charged.
 */
export const BOOKING_FEE_PCT = 4

/** Rand → whole cents, guarding NaN/negatives. */
function toCents(rands: number): number {
  const n = Number(rands)
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0
}

/** The 4% booking fee for a fare, rounded to the nearest cent. */
export function bookingFeeFor(fare: number, pct: number = BOOKING_FEE_PCT): number {
  const feePct = Number.isFinite(pct) && pct > 0 ? pct : 0
  return Math.round((toCents(fare) * feePct) / 100) / 100
}

/** Fare + booking fee: the exact total the rider is charged on a card ride. */
export function quoteTotals(
  fare: number,
  pct: number = BOOKING_FEE_PCT,
): { fare: number; bookingFee: number; total: number } {
  const fareCents = toCents(fare)
  const feeCents = Math.round((fareCents * (Number.isFinite(pct) && pct > 0 ? pct : 0)) / 100)
  return {
    fare: fareCents / 100,
    bookingFee: feeCents / 100,
    total: (fareCents + feeCents) / 100,
  }
}
