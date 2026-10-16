// ─────────────────────────────────────────────────────────────────────────────
// promos — admin-created promotions and their server-authoritative fare maths.
//
// The console (adminV2 routes) owns the CRUD; the apps only ever READ their own
// side (activePromosForSide) and the booking handler applies the discount with
// applyPromoToFare — the client's numbers are display-only, never trusted.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../config/database";

export type RidePromo = {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  audience: string;
  discount_pct: number;
  discount_fixed: number;
};

/** Active = the flag is on AND we are inside the optional window. */
const WINDOW_OK =
  "(active = TRUE AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()))";

const PROMO_COLUMNS = `id, code, title, subtitle, audience, discount_pct, discount_fixed`;

/**
 * Everything currently live for ONE side of the marketplace. `both` promos
 * appear for riders and drivers alike; newest first so the apps can show [0].
 */
export async function activePromosForSide(side: "rider" | "driver"): Promise<RidePromo[]> {
  return query<RidePromo>(
    `SELECT ${PROMO_COLUMNS}
       FROM admin_promos
      WHERE ${WINDOW_OK} AND audience IN ($1, 'both')
      ORDER BY created_at DESC
      LIMIT 20`,
    [side]
  );
}

/**
 * Resolve the promo a booking refers to (id OR code, case-insensitive),
 * re-checking window + audience for THIS side. Null when it doesn't exist,
 * isn't live, or doesn't apply here — the booking then simply isn't discounted.
 */
export async function ridePromoFor(
  side: "rider" | "driver",
  idOrCode: string | null | undefined
): Promise<RidePromo | null> {
  const v = String(idOrCode || "").trim();
  if (!v) return null;
  const rows = await query<RidePromo>(
    `SELECT ${PROMO_COLUMNS}
       FROM admin_promos
      WHERE ${WINDOW_OK} AND audience IN ($1, 'both')
        AND (id::text = $2 OR UPPER(code) = UPPER($2))`,
    [side, v]
  ).catch(() => [] as RidePromo[]);
  return rows[0] ?? null;
}

/**
 * Apply a promo to a base fare. Percentage promos scale the fare; fixed promos
 * subtract Rands and can never drive the fare below zero. Everything rounds to
 * whole cents — the same precision the payments and ledger code uses.
 */
export function applyPromoToFare(
  fare: number,
  promo: RidePromo
): { fare: number; discount: number } {
  const base = Number.isFinite(fare) ? fare : 0;
  const pct = Number(promo.discount_pct) || 0;
  const fixed = Number(promo.discount_fixed) || 0;
  let discount = pct > 0 ? (base * pct) / 100 : fixed;
  if (discount > base) discount = base;
  discount = Math.round(discount * 100) / 100;
  return { fare: Math.round((base - discount) * 100) / 100, discount };
}