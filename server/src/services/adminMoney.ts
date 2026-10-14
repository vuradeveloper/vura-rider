// ─────────────────────────────────────────────────────────────────────────────
// adminMoney — ADMIN V2 Phase 6: STRICTLY READ-ONLY money views.
//
// The brief's hard rule: no money ACTIONS anywhere in the console. This
// module only SELECTs from the existing commerce tables (payments, payouts,
// driver_earnings, rides fares). No UPDATE/INSERT/POST, no refunds, no
// payout triggers — if ops needs to move money they use the runbook.
//
// Tables are created lazily by the app itself (payments.ts/payouts.ts/
// index.ts), so a fresh deployment may not have them yet: every read
// degrades to an empty shape instead of a 500.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, isMissingRelation } from "../config/database";

async function safeQuery<T>(sql: string, params: any[] = []): Promise<T[] | null> {
  try {
    return await query<T>(sql, params);
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

const EMPTY_STATS = {
  rides_completed: 0,
  gross_fare_zar: 0,
  avg_fare_zar: 0,
  payments_success: 0,
  payments_failed: 0,
  payments_amount_zar: 0,
  payouts_paid: 0,
  payouts_pending: 0,
  payouts_amount_zar: 0,
  earnings_net_zar: 0,
};

/** Day/week/month revenue + payment + payout + earnings aggregates. */
export async function getMoneyOverview(): Promise<Record<string, unknown>> {
  const rides = await safeQuery<any>(
    `SELECT
       COUNT(*)::int AS rides_completed,
       COALESCE(SUM(actual_fare), 0)::numeric(12,2) AS gross_fare,
       COALESCE(AVG(actual_fare), 0)::numeric(12,2) AS avg_fare
     FROM rides
     WHERE status = 'completed' AND actual_fare IS NOT NULL`
  );
  const payments = await safeQuery<any>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('success','completed','paid'))::int AS ok_count,
       COUNT(*) FILTER (WHERE status IN ('failed','abandoned','expired'))::int AS fail_count,
       COALESCE(SUM(amount) FILTER (WHERE status IN ('success','completed','paid')), 0)::numeric(12,2) AS ok_amount
     FROM payments`
  );
  const payouts = await safeQuery<any>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('success','completed','paid'))::int AS paid_count,
       COUNT(*) FILTER (WHERE status NOT IN ('success','completed','paid'))::int AS pending_count,
       COALESCE(SUM(amount), 0)::numeric(12,2) AS total_amount
     FROM payouts`
  );
  const earnings = await safeQuery<any>(
    `SELECT COALESCE(SUM(net_amount), 0)::numeric(12,2) AS net FROM driver_earnings`
  );

  return {
    ...EMPTY_STATS,
    rides_completed: rides?.[0]?.rides_completed ?? 0,
    gross_fare_zar: Number(rides?.[0]?.gross_fare ?? 0),
    avg_fare_zar: Number(rides?.[0]?.avg_fare ?? 0),
    payments_success: payments?.[0]?.ok_count ?? 0,
    payments_failed: payments?.[0]?.fail_count ?? 0,
    payments_amount_zar: Number(payments?.[0]?.ok_amount ?? 0),
    payouts_paid: payouts?.[0]?.paid_count ?? 0,
    payouts_pending: payouts?.[0]?.pending_count ?? 0,
    payouts_amount_zar: Number(payouts?.[0]?.total_amount ?? 0),
    earnings_net_zar: Number(earnings?.[0]?.net ?? 0),
    currency: "ZAR",
    note: "Read-only view — the console performs no money actions.",
  };
}

/** Recent payments, rider-masked, newest first. */
export async function listPayments(limit = 50): Promise<any[]> {
  const rows = await safeQuery<any>(
    `SELECT p.id, p.ride_id, p.reference, p.amount, p.currency, p.status, p.provider,
            p.created_at,
            u.full_name AS rider_name,
            regexp_replace(coalesce(u.phone, ''), '(\\d{3})(\\d{3})(\\d+)', '***\\2\\3') AS rider_phone_masked
       FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows ?? [];
}

/** Recent payouts to drivers, newest first. */
export async function listPayouts(limit = 50): Promise<any[]> {
  const rows = await safeQuery<any>(
    `SELECT p.id, p.driver_id, p.reference, p.amount, p.status, p.bank_name,
            regexp_replace(coalesce(p.account_number, ''), '^(.*)(.{4})$', '****\\2') AS account_masked,
            p.created_at,
            u.full_name AS driver_name
       FROM payouts p
       LEFT JOIN users u ON u.id = p.driver_id
      ORDER BY p.created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows ?? [];
}

/** Per-driver earnings ledger totals (gross/fees/net + paid), read-only. */
export async function listDriverEarnings(): Promise<any[]> {
  const rows = await safeQuery<any>(
    `SELECT e.driver_id,
            u.full_name AS driver_name,
            COALESCE(SUM(e.gross_amount), 0)::numeric(12,2) AS gross,
            COALESCE(SUM(e.fee + e.request_fee), 0)::numeric(12,2) AS fees,
            COALESCE(SUM(e.net_amount), 0)::numeric(12,2) AS net,
            COALESCE((SELECT SUM(de.net_amount) FROM driver_earnings_paid dp
                        JOIN driver_earnings de ON de.id = dp.earning_id
                       WHERE dp.earning_id IN (SELECT id FROM driver_earnings ee WHERE ee.driver_id = e.driver_id)), 0)::numeric(12,2) AS paid
       FROM driver_earnings e
       LEFT JOIN users u ON u.id = e.driver_id
      GROUP BY e.driver_id, u.full_name
      ORDER BY net DESC
      LIMIT 100`
  );
  return rows ?? [];
}
