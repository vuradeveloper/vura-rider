"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activePromosForSide = activePromosForSide;
exports.ridePromoFor = ridePromoFor;
exports.applyPromoToFare = applyPromoToFare;
// ─────────────────────────────────────────────────────────────────────────────
// promos — admin-created promotions and their server-authoritative fare maths.
//
// The console (adminV2 routes) owns the CRUD; the apps only ever READ their own
// side (activePromosForSide) and the booking handler applies the discount with
// applyPromoToFare — the client's numbers are display-only, never trusted.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
/** Active = the flag is on AND we are inside the optional window. */
const WINDOW_OK = "(active = TRUE AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()))";
const PROMO_COLUMNS = `id, code, title, subtitle, audience, discount_pct, discount_fixed`;
/**
 * Everything currently live for ONE side of the marketplace. `both` promos
 * appear for riders and drivers alike; newest first so the apps can show [0].
 */
async function activePromosForSide(side) {
    return (0, database_1.query)(`SELECT ${PROMO_COLUMNS}
       FROM admin_promos
      WHERE ${WINDOW_OK} AND audience IN ($1, 'both')
      ORDER BY created_at DESC
      LIMIT 20`, [side]);
}
/**
 * Resolve the promo a booking refers to (id OR code, case-insensitive),
 * re-checking window + audience for THIS side. Null when it doesn't exist,
 * isn't live, or doesn't apply here — the booking then simply isn't discounted.
 */
async function ridePromoFor(side, idOrCode) {
    const v = String(idOrCode || "").trim();
    if (!v)
        return null;
    const rows = await (0, database_1.query)(`SELECT ${PROMO_COLUMNS}
       FROM admin_promos
      WHERE ${WINDOW_OK} AND audience IN ($1, 'both')
        AND (id::text = $2 OR UPPER(code) = UPPER($2))`, [side, v]).catch(() => []);
    return rows[0] ?? null;
}
/**
 * Apply a promo to a base fare. Percentage promos scale the fare; fixed promos
 * subtract Rands and can never drive the fare below zero. Everything rounds to
 * whole cents — the same precision the payments and ledger code uses.
 */
function applyPromoToFare(fare, promo) {
    const base = Number.isFinite(fare) ? fare : 0;
    const pct = Number(promo.discount_pct) || 0;
    const fixed = Number(promo.discount_fixed) || 0;
    let discount = pct > 0 ? (base * pct) / 100 : fixed;
    if (discount > base)
        discount = base;
    discount = Math.round(discount * 100) / 100;
    return { fare: Math.round((base - discount) * 100) / 100, discount };
}
//# sourceMappingURL=promos.js.map