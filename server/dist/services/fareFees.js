"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BOOKING_FEE_PCT = void 0;
exports.bookingFeePct = bookingFeePct;
exports.bookingFeeCentsFor = bookingFeeCentsFor;
exports.rideFareBreakdown = rideFareBreakdown;
exports.platformShareCents = platformShareCents;
const walletService_1 = require("./walletService");
/** Default booking fee, percent of the fare. Rider-paid, on top of the fare. */
exports.DEFAULT_BOOKING_FEE_PCT = 4;
/**
 * Configured booking fee percentage. Clamped to a sane range so a typo in the
 * environment can never charge a rider 400%.
 */
function bookingFeePct() {
    const raw = Number(process.env.BOOKING_FEE_PCT);
    if (!Number.isFinite(raw) || raw < 0 || raw > 25)
        return exports.DEFAULT_BOOKING_FEE_PCT;
    return raw;
}
/** Booking fee in cents for a fare in cents. Rounds to the nearest cent. */
function bookingFeeCentsFor(fareCents, pct = bookingFeePct()) {
    const fare = Math.max(0, Math.round(Number(fareCents) || 0));
    const feePct = Number.isFinite(pct) && pct > 0 ? pct : 0;
    return Math.round((fare * feePct) / 100);
}
/**
 * Complete money breakdown for one fare. `commissionSplit` is the same
 * function the driver wallet uses, so the number sent to Paystack and the
 * number shown to the driver can never disagree.
 */
function rideFareBreakdown(fareRands, cfg = walletService_1.DEFAULT_WALLET_CONFIG, bookingFeePercent = bookingFeePct()) {
    const fareCents = Math.max(0, (0, walletService_1.toCents)(fareRands));
    const commissionCents = (0, walletService_1.commissionSplit)(fareCents / 100, cfg).commission_cents;
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
/** The amount Vura keeps from one fare, in cents (commission + booking fee). */
function platformShareCents(fareRands, cfg = walletService_1.DEFAULT_WALLET_CONFIG) {
    return rideFareBreakdown(fareRands, cfg).platform_cents;
}
//# sourceMappingURL=fareFees.js.map