// ─────────────────────────────────────────────────────────────────────────────
// promos — admin-created promotions and their server-authoritative fare maths.
//
// The console (adminV2 routes) owns the CRUD; the apps only ever READ their own
// side (activePromosForSide) and the booking handlers apply the discount with
// applyPromoToFare — the client's numbers are display-only, never trusted.
//
// v2 (migration 016): a promo may be VALID FOR N DAYS + N RIDES after a rider's
// FIRST use (redemption rows in admin_promo_redemptions), and may target
// SPECIFIC riders/drivers (target_user_ids) — the console's "heavy users"
// filter feeds that list. Both optional: NULL keeps the 012 behaviour.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute } from "../config/database";

export type RidePromo = {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  audience: string;
  discount_pct: number;
  discount_fixed: number;
  // v2 (016): per-rider validity after first use + specific targeting.
  valid_days: number | null;
  rides_limit: number | null;
  target_user_ids: string[] | null;
  // Per-user redemption state (populated when the caller passes a userId).
  rides_used?: number | null;
  expires_at?: string | null;
  usable?: boolean;
};

/** Active = the flag is on AND we are inside the optional window. */
const WINDOW_OK =
  "(p.active = TRUE AND (p.starts_at IS NULL OR p.starts_at <= NOW()) AND (p.ends_at IS NULL OR p.ends_at >= NOW()))";

const PROMO_COLUMNS = `p.id, p.code, p.title, p.subtitle, p.audience, p.discount_pct, p.discount_fixed,
                       p.valid_days, p.rides_limit, p.target_user_ids`;

/** With no user context every live promo is "usable" (targeted ones drop out). */
const USABLE_FOR = (uid: string) =>
  `(${uid}::uuid IS NULL OR (
      (p.rides_limit IS NULL OR COALESCE(r.rides_used, 0) < p.rides_limit)
      AND (r.expires_at IS NULL OR r.expires_at > NOW())))`;

const TARGET_OK = (uid: string) =>
  `(p.target_user_ids IS NULL OR ${uid}::uuid = ANY(p.target_user_ids))`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse/validate the console's targeting list; null = everyone. */
export function parseTargetUserIds(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) throw new Error("target_user_ids must be an array of user ids");
  const ids = Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
  for (const id of ids) if (!UUID_RE.test(id)) throw new Error(`Invalid user id: ${id}`);
  return ids.length ? ids : null;
}

/** Lazy v2 columns/table — same pattern as every money table (works pre-016). */
export async function ensurePromoTables(): Promise<void> {
  for (const ddl of [
    `ALTER TABLE admin_promos ADD COLUMN IF NOT EXISTS valid_days INTEGER`,
    `ALTER TABLE admin_promos ADD COLUMN IF NOT EXISTS rides_limit INTEGER`,
    `ALTER TABLE admin_promos ADD COLUMN IF NOT EXISTS target_user_ids UUID[]`,
    `CREATE TABLE IF NOT EXISTS admin_promo_redemptions (
       id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       promo_id      UUID NOT NULL REFERENCES admin_promos(id) ON DELETE CASCADE,
       user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       rides_used    INTEGER NOT NULL DEFAULT 0,
       first_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       expires_at    TIMESTAMPTZ,
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (promo_id, user_id)
     )`,
  ]) {
    await execute(ddl).catch(() => { /* already there */ });
  }
}

/**
 * Everything currently live for ONE side of the marketplace. `both` promos
 * appear for riders and drivers alike; newest first so the apps can show [0].
 * With a userId the per-user redemption state rides along (usable flag), so
 * the app can grey out an exhausted/expired promo instead of offering it.
 */
export async function activePromosForSide(
  side: "rider" | "driver",
  userId?: string | null
): Promise<RidePromo[]> {
  await ensurePromoTables();
  const uid = userId ? String(userId) : null;
  return query<RidePromo>(
    `SELECT ${PROMO_COLUMNS},
            r.rides_used, r.expires_at,
            (${USABLE_FOR("$2")}) AS usable
       FROM admin_promos p
       LEFT JOIN admin_promo_redemptions r
         ON r.promo_id = p.id AND r.user_id = $2::uuid
      WHERE ${WINDOW_OK} AND p.audience IN ($1, 'both')
        AND ${TARGET_OK("$2")}
      ORDER BY p.created_at DESC
      LIMIT 20`,
    [side, uid]
  );
}

/**
 * Resolve the promo a booking refers to (id OR code, case-insensitive),
 * re-checking window + audience for THIS side. Null when it doesn't exist,
 * isn't live, or doesn't apply here — the booking then simply isn't discounted.
 */
export async function ridePromoFor(
  side: "rider" | "driver",
  idOrCode: string | null | undefined,
  userId?: string | null
): Promise<RidePromo | null> {
  const v = String(idOrCode || "").trim();
  if (!v) return null;
  await ensurePromoTables();
  const uid = userId ? String(userId) : null;
  const rows = await query<RidePromo>(
    `SELECT ${PROMO_COLUMNS},
            r.rides_used, r.expires_at,
            (${USABLE_FOR("$2")}) AS usable
       FROM admin_promos p
       LEFT JOIN admin_promo_redemptions r
         ON r.promo_id = p.id AND r.user_id = $2::uuid
      WHERE ${WINDOW_OK} AND p.audience IN ($1, 'both')
        AND ${TARGET_OK("$2")}
        AND (p.id::text = $3 OR UPPER(p.code) = UPPER($3))
      LIMIT 1`,
    [side, uid, v]
  ).catch(() => [] as RidePromo[]);
  return rows[0] ?? null;
}

/**
 * Per-user redemption guard: is THIS user still inside the promo's ride budget
 * and validity window? Promos with neither limit set behave exactly as 012.
 */
export async function promoUsableFor(promo: RidePromo, userId: string): Promise<boolean> {
  // Targeting applies regardless of budget: a promo aimed at someone else is
  // NEVER redeemable here (checked before the no-limits shortcut).
  if (
    Array.isArray(promo.target_user_ids) &&
    promo.target_user_ids.length > 0 &&
    !promo.target_user_ids.includes(String(userId))
  ) {
    return false;
  }
  if (promo.rides_limit == null && promo.valid_days == null) return true;
  await ensurePromoTables();
  const row = await queryOne<{ rides_used: number; expires_at: Date | null }>(
    `SELECT rides_used, expires_at FROM admin_promo_redemptions
      WHERE promo_id = $1 AND user_id = $2`,
    [promo.id, userId]
  ).catch(() => null);
  if (!row) return true; // first use — always allowed
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return false;
  if (promo.rides_limit != null && Number(row.rides_used) >= Number(promo.rides_limit)) {
    return false;
  }
  return true;
}

/**
 * Burn one redemption for this user: the N-DAYS window starts at the FIRST
 * use (expires_at stamped once, then frozen) and rides_used counts up to
 * rides_limit. Fire-and-forget safe — a tracking failure must never break
 * the booking that already happened.
 */
export async function recordPromoUse(promo: RidePromo, userId: string): Promise<void> {
  if (promo.rides_limit == null && promo.valid_days == null) return; // nothing to track
  await ensurePromoTables();
  const days = promo.valid_days != null ? Math.max(1, Math.floor(Number(promo.valid_days))) : null;
  await execute(
    `INSERT INTO admin_promo_redemptions (promo_id, user_id, rides_used, expires_at)
     VALUES ($1, $2, 1,
             CASE WHEN $3::int IS NULL THEN NULL
                  ELSE NOW() + make_interval(days => $3::int) END)
     ON CONFLICT (promo_id, user_id) DO UPDATE
       SET rides_used = admin_promo_redemptions.rides_used + 1,
           expires_at = COALESCE(
             admin_promo_redemptions.expires_at,
             CASE WHEN $3::int IS NULL THEN NULL
                  ELSE NOW() + make_interval(days => $3::int) END),
           updated_at = NOW()`,
    [promo.id, userId, days]
  ).catch(() => { /* never blocks the booking */ });
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