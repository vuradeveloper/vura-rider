// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PAY LATER — manual credit grants with a live funds check.
//
// The rule from the owner:
//   • eligibility is detected automatically (the server lists riders who have
//     done the required paid card rides);
//   • Vura does NOT grant credit automatically — an admin presses Grant;
//   • before the grant, the console shows the company's own revenue, the
//     money already lent, and the headroom that would remain;
//   • a grant that would exceed the headroom needs an explicit override, so
//     nobody can lend money the company does not have by accident.
//
// This module never touches the rider's card. It only moves the credit limit
// and writes an append-only grant record (who, how much, why, the funds
// position at the time, whether the operator overrode the guard).
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import getPool, { query, queryOne, execute, isMissingRelation } from "../config/database";
import { writeAudit, type AdminActor } from "./adminAuth";
import { ensurePayLaterTables, payLaterConfig, registerPayLaterDebit } from "./PayLaterService";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

async function safeQuery<T>(sql: string, params: any[] = []): Promise<T[] | null> {
  try {
    return await query<T>(sql, params);
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

async function safeQueryOne<T>(sql: string, params: any[] = []): Promise<T | null> {
  try {
    return await queryOne<T>(sql, params);
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

/** Tables this screen needs, created in place (no migration dependency). */
export async function ensureAdminPayLaterSchema(): Promise<void> {
  await ensurePayLaterTables();
  await execute(`
    CREATE TABLE IF NOT EXISTS pay_later_grants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      granted_by VARCHAR(255) NOT NULL,
      reason VARCHAR(255),
      funds_before NUMERIC(12,2) NOT NULL DEFAULT 0,
      outstanding_before NUMERIC(12,2) NOT NULL DEFAULT 0,
      override BOOLEAN NOT NULL DEFAULT FALSE,
      idempotency_key VARCHAR(100) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(
    `CREATE INDEX IF NOT EXISTS pay_later_grants_rider_idx
       ON pay_later_grants (rider_id, created_at)`
  ).catch(() => {});
  await execute(`
    CREATE TABLE IF NOT EXISTS pay_later_demo_users (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // The revenue/graph queries read these columns; a database that has not run
  // preauthorization yet still gets the page instead of a 500.
  await execute(
    `ALTER TABLE rides ADD COLUMN IF NOT EXISTS booking_fee_cents INTEGER`
  ).catch(() => {});
  await execute(
    `ALTER TABLE rides ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10,2)`
  ).catch(() => {});
}

// ── Funds position ───────────────────────────────────────────────────────────

export interface PayLaterFunds {
  /** Vura's own revenue: commission + booking fee on completed rides. */
  platform_revenue_zar: number;
  /** Referral balances still owed as future ride discounts (a liability). */
  referral_liability_zar: number;
  /** What riders currently owe on Pay Later (money already lent). */
  paylater_outstanding_zar: number;
  /** Revenue not already promised away: the amount available to lend. */
  available_to_lend_zar: number;
  /** Card/cashless money actually collected through Paystack. */
  cash_collected_zar: number;
  /** Driver money already paid out. */
  driver_payouts_paid_zar: number;
  /** Driver net earnings not yet paid out (owed to drivers). */
  driver_earnings_owed_zar: number;
  /** Sum of every credit limit the console has activated. */
  paylater_granted_zar: number;
  /** Confirmed Pay Later repayments received. */
  paylater_repaid_zar: number;
  active_accounts: number;
  pending_accounts: number;
  eligible_waiting: number;
  /** Revenue cover for the outstanding book (1.0 = fully covered). */
  cover_ratio: number;
  as_of: string;
}

export async function getPayLaterFunds(): Promise<PayLaterFunds> {
  await ensureAdminPayLaterSchema();

  const revenue = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(
        COALESCE(platform_fee, 0) + COALESCE(booking_fee_cents, 0)::numeric / 100
      ), 0)::text AS v
       FROM rides WHERE status = 'completed'`
  );
  const referral = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(balance), 0)::text AS v FROM affiliates`
  );
  const outstanding = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(
        CASE entry_type
          WHEN 'debit' THEN amount
          WHEN 'credit' THEN -CASE WHEN status = 'confirmed' THEN amount ELSE 0 END
          ELSE 0 END), 0)::text AS v
       FROM pay_later_ledger`
  );
  const collected = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM payments
      WHERE status IN ('success','completed','paid')`
  );
  const payoutsPaid = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM payouts
      WHERE status IN ('success','completed','paid')`
  );
  const earningsOwed = await safeQueryOne<{ v: string }>(
    `SELECT (
        COALESCE((SELECT SUM(net_amount) FROM driver_earnings), 0)
        - COALESCE((SELECT SUM(de.net_amount)
                      FROM driver_earnings_paid dp
                      JOIN driver_earnings de ON de.id = dp.earning_id), 0)
      )::text AS v`
  );
  const granted = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(credit_limit), 0)::text AS v FROM pay_later_accounts`
  );
  const repaid = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM pay_later_ledger
      WHERE entry_type = 'credit' AND status = 'confirmed'`
  );
  const counts = await safeQueryOne<{ active: number; pending: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
       FROM pay_later_accounts`
  );

  const platformRevenue = round2(Number(revenue?.v || 0));
  const referralLiability = round2(Number(referral?.v || 0));
  const paylaterOutstanding = round2(Number(outstanding?.v || 0));
  const available = Math.max(0, round2(platformRevenue - referralLiability - paylaterOutstanding));

  return {
    platform_revenue_zar: platformRevenue,
    referral_liability_zar: referralLiability,
    paylater_outstanding_zar: paylaterOutstanding,
    available_to_lend_zar: available,
    cash_collected_zar: round2(Number(collected?.v || 0)),
    driver_payouts_paid_zar: round2(Number(payoutsPaid?.v || 0)),
    driver_earnings_owed_zar: Math.max(0, round2(Number(earningsOwed?.v || 0))),
    paylater_granted_zar: round2(Number(granted?.v || 0)),
    paylater_repaid_zar: round2(Number(repaid?.v || 0)),
    active_accounts: Number(counts?.active || 0),
    pending_accounts: Number(counts?.pending || 0),
    eligible_waiting: 0, // filled by the overview from the live list
    cover_ratio:
      paylaterOutstanding > 0
        ? Math.round((platformRevenue / paylaterOutstanding) * 100) / 100
        : 0,
    as_of: new Date().toISOString(),
  };
}

// ── Eligibility / accounts ───────────────────────────────────────────────────

export interface EligibleRider {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  rides_counted: number;
  rides_required: number;
  account_id: string | null;
  account_status: string | null;
  credit_limit: number;
  outstanding: number;
  available: number;
  terms_accepted_at: string | null;
  card_last4: string | null;
  last_ride_at: string | null;
  past_due: boolean;
  is_demo: boolean;
  state: "eligible" | "pending" | "active" | "frozen";
}

const ELIGIBLE_SQL = `
  WITH per_driver AS (
    SELECT r.passenger_id, r.driver_id, COUNT(*)::int AS c
      FROM rides r
     WHERE r.status = 'completed'
       AND r.driver_id IS NOT NULL
       AND (LOWER(COALESCE(r.payment_method, '')) = 'card' OR r.card_auth_code IS NOT NULL)
     GROUP BY r.passenger_id, r.driver_id
  ), counted AS (
    SELECT passenger_id, SUM(LEAST(c, 4))::int AS rides
      FROM per_driver
     GROUP BY passenger_id
  )
  SELECT u.id, u.full_name, u.email, u.phone,
         c.rides AS rides_counted,
         a.id AS account_id, a.status AS account_status,
         COALESCE(a.credit_limit, 0)::float AS credit_limit,
         COALESCE(a.outstanding, 0)::float AS outstanding,
         a.terms_accepted_at,
         (SELECT s.last4 FROM saved_cards s
           WHERE s.user_id = u.id
           ORDER BY s.is_default DESC, s.created_at DESC LIMIT 1) AS card_last4,
         (SELECT MAX(r.completed_at) FROM rides r
           WHERE r.passenger_id = u.id AND r.status = 'completed') AS last_ride_at,
         EXISTS (
           SELECT 1 FROM pay_later_ledger l
            WHERE l.rider_id = u.id AND l.entry_type = 'debit'
              AND l.status = 'open' AND l.due_at IS NOT NULL AND l.due_at < NOW()
         ) AS past_due,
         (d.user_id IS NOT NULL) AS is_demo
    FROM counted c
    JOIN users u ON u.id = c.passenger_id
    LEFT JOIN pay_later_accounts a ON a.user_id = u.id
    LEFT JOIN pay_later_demo_users d ON d.user_id = u.id
   WHERE c.rides >= $1
   ORDER BY (a.id IS NULL) DESC, c.rides DESC, u.full_name ASC
   LIMIT $2
`;

function mapEligible(row: any, ridesRequired: number): EligibleRider {
  const state: EligibleRider["state"] =
    row.account_status === "active"
      ? "active"
      : row.account_status === "pending"
        ? "pending"
        : row.account_status === "frozen"
          ? "frozen"
          : "eligible";
  return {
    id: row.id,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    rides_counted: Number(row.rides_counted || 0),
    rides_required: ridesRequired,
    account_id: row.account_id ?? null,
    account_status: row.account_status ?? null,
    credit_limit: round2(Number(row.credit_limit || 0)),
    outstanding: round2(Number(row.outstanding || 0)),
    available: Math.max(0, round2(Number(row.credit_limit || 0) - Number(row.outstanding || 0))),
    terms_accepted_at: row.terms_accepted_at ? new Date(row.terms_accepted_at).toISOString() : null,
    card_last4: row.card_last4 ?? null,
    last_ride_at: row.last_ride_at ? new Date(row.last_ride_at).toISOString() : null,
    past_due: !!row.past_due,
    is_demo: !!row.is_demo,
    state,
  };
}

/** Automated eligibility detection — the list the admin reviews. */
export async function getPayLaterEligibleRiders(limit = 500): Promise<EligibleRider[]> {
  await ensureAdminPayLaterSchema();
  const cfg = payLaterConfig();
  const rows = await safeQuery<any>(ELIGIBLE_SQL, [
    cfg.ridesToUnlock,
    Math.min(500, Math.max(1, Math.floor(limit))),
  ]);
  return (rows || []).map((r) => mapEligible(r, cfg.ridesToUnlock));
}

export interface PayLaterAccountRow extends EligibleRider {
  grants_count: number;
  last_grant_at: string | null;
  created_at: string | null;
}

export async function getPayLaterAccounts(limit = 500): Promise<PayLaterAccountRow[]> {
  await ensureAdminPayLaterSchema();
  const cfg = payLaterConfig();
  const rows = await safeQuery<any>(
    `SELECT u.id, u.full_name, u.email, u.phone,
            COALESCE((
              WITH per_driver AS (
                SELECT r.driver_id, COUNT(*)::int AS c
                  FROM rides r
                 WHERE r.passenger_id = u.id AND r.status = 'completed'
                   AND r.driver_id IS NOT NULL
                   AND (LOWER(COALESCE(r.payment_method, '')) = 'card' OR r.card_auth_code IS NOT NULL)
                 GROUP BY r.driver_id
              )
              SELECT SUM(LEAST(c, 4))::int FROM per_driver
            ), 0) AS rides_counted,
            a.id AS account_id, a.status AS account_status,
            COALESCE(a.credit_limit, 0)::float AS credit_limit,
            COALESCE(a.outstanding, 0)::float AS outstanding,
            a.terms_accepted_at, a.created_at,
            (SELECT s.last4 FROM saved_cards s
              WHERE s.user_id = u.id
              ORDER BY s.is_default DESC, s.created_at DESC LIMIT 1) AS card_last4,
            (SELECT MAX(r.completed_at) FROM rides r
              WHERE r.passenger_id = u.id AND r.status = 'completed') AS last_ride_at,
            EXISTS (
              SELECT 1 FROM pay_later_ledger l
               WHERE l.rider_id = u.id AND l.entry_type = 'debit'
                 AND l.status = 'open' AND l.due_at IS NOT NULL AND l.due_at < NOW()
            ) AS past_due,
            (d.user_id IS NOT NULL) AS is_demo,
            (SELECT COUNT(*)::int FROM pay_later_grants g WHERE g.rider_id = u.id) AS grants_count,
            (SELECT MAX(g.created_at) FROM pay_later_grants g WHERE g.rider_id = u.id) AS last_grant_at
       FROM pay_later_accounts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN pay_later_demo_users d ON d.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [Math.min(500, Math.max(1, Math.floor(limit)))]
  );
  return (rows || []).map((r) => ({
    ...mapEligible(r, cfg.ridesToUnlock),
    grants_count: Number(r.grants_count || 0),
    last_grant_at: r.last_grant_at ? new Date(r.last_grant_at).toISOString() : null,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));
}

// ── Daily series for the graph ───────────────────────────────────────────────

export interface PayLaterDay {
  day: string;
  revenue_zar: number;
  collected_zar: number;
  advanced_zar: number;
  repaid_zar: number;
  granted_zar: number;
  outstanding_zar: number;
}

export async function getPayLaterSeries(days = 30): Promise<PayLaterDay[]> {
  await ensureAdminPayLaterSchema();
  const span = Math.min(90, Math.max(7, Math.floor(days)));
  const rows = await safeQuery<any>(
    `WITH d AS (
       SELECT generate_series(
         CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day',
         CURRENT_DATE,
         INTERVAL '1 day'
       )::date AS day
     )
     SELECT d.day::text AS day,
       COALESCE((SELECT SUM(COALESCE(r.platform_fee, 0) + COALESCE(r.booking_fee_cents, 0)::numeric / 100)
                   FROM rides r
                  WHERE r.status = 'completed' AND r.completed_at::date = d.day), 0)::text AS revenue,
       COALESCE((SELECT SUM(p.amount) FROM payments p
                  WHERE p.status IN ('success','completed','paid')
                    AND p.created_at::date = d.day), 0)::text AS collected,
       COALESCE((SELECT SUM(l.amount) FROM pay_later_ledger l
                  WHERE l.entry_type = 'debit' AND l.created_at::date = d.day), 0)::text AS advanced,
       COALESCE((SELECT SUM(l.amount) FROM pay_later_ledger l
                  WHERE l.entry_type = 'credit' AND l.status = 'confirmed'
                    AND l.created_at::date = d.day), 0)::text AS repaid,
       COALESCE((SELECT SUM(g.amount) FROM pay_later_grants g
                  WHERE g.created_at::date = d.day), 0)::text AS granted
     FROM d ORDER BY d.day`,
    [span]
  );
  const opening = await safeQueryOne<{ v: string }>(
    `SELECT COALESCE(SUM(
        CASE entry_type
          WHEN 'debit' THEN amount
          WHEN 'credit' THEN -CASE WHEN status = 'confirmed' THEN amount ELSE 0 END
          ELSE 0 END), 0)::text AS v
       FROM pay_later_ledger
      WHERE created_at < CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'`,
    [span]
  );

  let outstanding = Number(opening?.v || 0);
  return (rows || []).map((r) => {
    const advanced = Number(r.advanced || 0);
    const repaid = Number(r.repaid || 0);
    outstanding = Math.max(0, round2(outstanding + advanced - repaid));
    return {
      day: String(r.day),
      revenue_zar: round2(Number(r.revenue || 0)),
      collected_zar: round2(Number(r.collected || 0)),
      advanced_zar: round2(advanced),
      repaid_zar: round2(repaid),
      granted_zar: round2(Number(r.granted || 0)),
      outstanding_zar: outstanding,
    };
  });
}

// ── The admin overview ───────────────────────────────────────────────────────

export async function getPayLaterAdminOverview() {
  await ensureAdminPayLaterSchema();
  const [funds, eligible, accounts, series] = await Promise.all([
    getPayLaterFunds(),
    getPayLaterEligibleRiders(500),
    getPayLaterAccounts(500),
    getPayLaterSeries(30),
  ]);
  funds.eligible_waiting = eligible.filter((r) => r.state === "eligible").length;
  const cfg = payLaterConfig();
  return {
    funds,
    eligible,
    accounts,
    series,
    config: {
      rides_to_unlock: cfg.ridesToUnlock,
      default_grant_r: Math.max(1, Math.min(100, cfg.creditLimitR)),
      max_grant_r: 5000,
      admin_approval: process.env.PAY_LATER_ADMIN_APPROVAL !== "0",
    },
    generated_at: new Date().toISOString(),
  };
}

// ── Manual grant ─────────────────────────────────────────────────────────────

export class PayLaterGrantError extends Error {
  code: "not_eligible" | "insufficient_funds" | "bad_amount" | "not_found";
  funds?: PayLaterFunds;
  constructor(
    code: PayLaterGrantError["code"],
    message: string,
    funds?: PayLaterFunds
  ) {
    super(message);
    this.code = code;
    this.funds = funds;
  }
}

export interface GrantPayLaterInput {
  riderId: string;
  amountRands?: number;
  reason?: string;
  idempotencyKey?: string;
  override?: boolean;
  actor: AdminActor;
}

export interface GrantPayLaterResult {
  success: true;
  already_granted: boolean;
  grant_id: string;
  amount: number;
  rider_id: string;
  account: {
    id: string;
    status: string;
    credit_limit: number;
    outstanding: number;
    available: number;
  };
  funds_before: PayLaterFunds;
  funds_after: PayLaterFunds;
}

async function countEligibleRides(riderId: string): Promise<number> {
  const row = await safeQueryOne<{ total: string }>(
    `SELECT COALESCE(SUM(LEAST(per_driver.c, 4)), 0)::text AS total
       FROM (
         SELECT r.driver_id, COUNT(*)::int AS c
           FROM rides r
          WHERE r.passenger_id = $1
            AND r.status = 'completed'
            AND r.driver_id IS NOT NULL
            AND (LOWER(COALESCE(r.payment_method, '')) = 'card' OR r.card_auth_code IS NOT NULL)
          GROUP BY r.driver_id
       ) per_driver`,
    [riderId]
  );
  return parseInt(row?.total || "0", 10);
}

/**
 * Grants (or tops up) one rider's Pay Later limit. The grant record is written
 * FIRST with a unique idempotency key, so a double-click (or a retry after a
 * dropped response) can never add the same R100 twice.
 */
export async function grantPayLater(input: GrantPayLaterInput): Promise<GrantPayLaterResult> {
  await ensureAdminPayLaterSchema();
  const cfg = payLaterConfig();
  const amount = round2(input.amountRands == null ? cfg.creditLimitR : Number(input.amountRands));
  if (!Number.isFinite(amount) || amount < 1 || amount > 5000) {
    throw new PayLaterGrantError(
      "bad_amount",
      "Enter an amount between R1 and R5,000."
    );
  }
  const rider = await safeQueryOne<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
    `SELECT id, full_name, email, phone FROM users WHERE id = $1`,
    [input.riderId]
  );
  if (!rider) throw new PayLaterGrantError("not_found", "Rider not found.");

  const existingAccount = await safeQueryOne<{ id: string }>(
    `SELECT id FROM pay_later_accounts WHERE user_id = $1`,
    [input.riderId]
  );
  if (!existingAccount) {
    const rides = await countEligibleRides(input.riderId);
    if (rides < cfg.ridesToUnlock && !input.override) {
      throw new PayLaterGrantError(
        "not_eligible",
        `This rider has ${rides} of ${cfg.ridesToUnlock} paid card rides. They are not eligible yet.`
      );
    }
  }

  const fundsBefore = await getPayLaterFunds();
  if (amount > fundsBefore.available_to_lend_zar && !input.override) {
    throw new PayLaterGrantError(
      "insufficient_funds",
      `This R${amount.toFixed(2)} grant exceeds the available lending headroom of R${fundsBefore.available_to_lend_zar.toFixed(2)}. Tick the override to proceed.`,
      fundsBefore
    );
  }

  const idempotencyKey = String(input.idempotencyKey || `plg-${randomUUID()}`).slice(0, 100);
  const actor = input.actor;
  const reason = String(input.reason || "").trim().slice(0, 255) || null;

  const client = await getPool().connect();
  let grantId = "";
  let already = false;
  let account: any;
  try {
    await client.query("BEGIN");
    const ins = await client.query<{ id: string }>(
      `INSERT INTO pay_later_grants
         (rider_id, amount, granted_by, reason, funds_before, outstanding_before,
          override, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.riderId,
        amount,
        actor.email,
        reason,
        fundsBefore.available_to_lend_zar,
        fundsBefore.paylater_outstanding_zar,
        !!input.override,
        idempotencyKey,
      ]
    );
    if (!ins.rowCount) {
      const seen = await client.query<{ id: string; amount: string }>(
        `SELECT id, amount FROM pay_later_grants WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      await client.query("COMMIT");
      already = true;
      grantId = seen.rows[0]?.id || "";
      account = await safeQueryOne<any>(
        `SELECT id, status, credit_limit, outstanding FROM pay_later_accounts WHERE user_id = $1`,
        [input.riderId]
      );
    } else {
      grantId = ins.rows[0].id;
      const fingerprint = [
        String(rider.phone || "").trim().toLowerCase(),
        String(rider.email || "").trim().toLowerCase(),
        String(rider.id),
      ].join("|");
      const acc = await client.query<any>(
        `INSERT INTO pay_later_accounts
           (user_id, credit_limit, status, identity_fingerprint)
         VALUES ($1, $2, 'active', $3)
         ON CONFLICT (user_id) DO UPDATE
           SET credit_limit = pay_later_accounts.credit_limit + EXCLUDED.credit_limit,
               status = 'active',
               updated_at = NOW()
         RETURNING id, status, credit_limit, outstanding`,
        [input.riderId, amount, fingerprint]
      );
      account = acc.rows[0];
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const fundsAfter = await getPayLaterFunds();
  const limit = round2(Number(account?.credit_limit || 0));
  const outstanding = round2(Number(account?.outstanding || 0));

  if (!already) {
    await writeAudit(actor, {
      action: "paylater.grant",
      entityType: "pay_later_account",
      entityId: input.riderId,
      oldValue: { credit_limit: round2(limit - amount), outstanding },
      newValue: {
        credit_limit: limit,
        granted: amount,
        reason,
        headroom_before: fundsBefore.available_to_lend_zar,
        headroom_after: fundsAfter.available_to_lend_zar,
        override: !!input.override,
        idempotency_key: idempotencyKey,
      },
      reason: reason || "Admin credit grant",
    });
  }

  return {
    success: true,
    already_granted: already,
    grant_id: grantId,
    amount,
    rider_id: input.riderId,
    account: {
      id: String(account?.id || ""),
      status: String(account?.status || "active"),
      credit_limit: limit,
      outstanding,
      available: Math.max(0, round2(limit - outstanding)),
    },
    funds_before: fundsBefore,
    funds_after: fundsAfter,
  };
}

/** Freeze / reactivate an account without deleting its ledger. */
export async function setPayLaterAccountStatus(
  riderId: string,
  status: "active" | "frozen",
  actor: AdminActor,
  reason?: string
): Promise<{ success: true; status: string }> {
  await ensureAdminPayLaterSchema();
  const before = await safeQueryOne<{ status: string }>(
    `SELECT status FROM pay_later_accounts WHERE user_id = $1`,
    [riderId]
  );
  if (!before) throw new PayLaterGrantError("not_found", "This rider has no Pay Later account.");
  await execute(
    `UPDATE pay_later_accounts SET status = $2, updated_at = NOW() WHERE user_id = $1`,
    [riderId, status]
  );
  await writeAudit(actor, {
    action: status === "frozen" ? "paylater.freeze" : "paylater.reactivate",
    entityType: "pay_later_account",
    entityId: riderId,
    oldValue: { status: before.status },
    newValue: { status },
    reason: reason || (status === "frozen" ? "Frozen by admin" : "Reactivated by admin"),
  });
  return { success: true, status };
}

// ── Demo riders (admin-only test data) ───────────────────────────────────────

const DEMO_PREFIX = "demo-paylater";

async function upsertDemoUser(
  key: string,
  fullName: string,
  email: string,
  phone: string,
  role: "passenger" | "driver"
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (firebase_uid, full_name, email, phone, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (firebase_uid) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           updated_at = NOW()
     RETURNING id`,
    [`${DEMO_PREFIX}-${key}`, fullName, email, phone, role]
  );
  if (!row?.id) throw new Error("Could not create the demo rider");
  return row.id;
}

/**
 * Seeds three clearly-labelled demo riders (plus two demo drivers) so the
 * console can be exercised end-to-end without touching a real rider:
 *   1. eligible, waiting for a grant;
 *   2. eligible with a pending account;
 *   3. active with R100 limit and R35 already owed.
 * Idempotent: running it again does not duplicate rides, cards or grants.
 */
export async function seedPayLaterDemos(actor: AdminActor) {
  await ensureAdminPayLaterSchema();
  const drivers = await Promise.all([
    upsertDemoUser("driver-1", "DEMO Driver · Sipho", "driver1@demo.ridevura.com", "+27000000901", "driver"),
    upsertDemoUser("driver-2", "DEMO Driver · Lerato", "driver2@demo.ridevura.com", "+27000000902", "driver"),
  ]);
  const riderSpecs = [
    { key: "rider-1", name: "DEMO Rider · Thabo", email: "rider1@demo.ridevura.com", phone: "+27000000911" },
    { key: "rider-2", name: "DEMO Rider · Naledi", email: "rider2@demo.ridevura.com", phone: "+27000000912" },
    { key: "rider-3", name: "DEMO Rider · Kagiso", email: "rider3@demo.ridevura.com", phone: "+27000000913" },
  ];
  const riders: string[] = [];
  for (const spec of riderSpecs) {
    riders.push(await upsertDemoUser(spec.key, spec.name, spec.email, spec.phone, "passenger"));
  }

  for (let i = 0; i < riders.length; i++) {
    const riderId = riders[i];
    await execute(
      `INSERT INTO pay_later_demo_users (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [riderId]
    );
    // One demo card so the page can show the repayment rail.
    const card = await queryOne<{ id: string }>(
      `SELECT id FROM saved_cards WHERE user_id = $1 LIMIT 1`,
      [riderId]
    );
    if (!card) {
      await execute(
        `INSERT INTO saved_cards
           (user_id, card_type, last4, bank, exp_month, exp_year,
            card_number_masked, transaction_index, is_default)
         VALUES ($1, 'visa', '4242', 'Demo Bank', 12, 2030,
                 '•••• 4242', $2, TRUE)`,
        [riderId, `DEMO-CARD-${i + 1}`]
      );
    }
    // 12 completed card rides (6 per driver). The anti-farm cap counts 4 per
    // driver = 8, comfortably over the 5-ride unlock threshold.
    const existing = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM rides
        WHERE passenger_id = $1 AND device_id = 'paylater-demo'`,
      [riderId]
    );
    for (let n = Number(existing?.n || 0); n < 12; n++) {
      await execute(
        `INSERT INTO rides
           (passenger_id, driver_id, pickup_address, destination_address,
            status, estimated_fare, actual_fare, platform_fee, booking_fee_cents,
            payment_method, payment_status, card_auth_code, completed_at,
            created_at, device_id)
         VALUES ($1, $2, 'Demo pickup', 'Demo destination',
                 'completed', 120, 120, 5, 480,
                 'card', 'paid', $3, NOW() - ($4 || ' days')::interval,
                 NOW() - ($4 || ' days')::interval, 'paylater-demo')`,
        [riderId, drivers[n % 2], `DEMO-${n}`, String(1 + (n % 20))]
      );
    }
  }

  // Rider 2: pending approval (the admin must press Grant).
  await execute(
    `INSERT INTO pay_later_accounts (user_id, credit_limit, status, identity_fingerprint)
     VALUES ($1, 0, 'pending', $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [riders[1], `demo|${riders[1]}`]
  );

  // Rider 3: active with R100 limit and a R35 pay-later debt.
  const active = await queryOne<{ id: string; credit_limit: string }>(
    `SELECT id, credit_limit FROM pay_later_accounts WHERE user_id = $1`,
    [riders[2]]
  );
  if (!active) {
    await execute(
      `INSERT INTO pay_later_accounts
         (user_id, credit_limit, status, identity_fingerprint, terms_accepted_at)
       VALUES ($1, 100, 'active', $2, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [riders[2], `demo|${riders[2]}`]
    );
  }
  const debtRide = await queryOne<{ id: string }>(
    `SELECT id FROM rides
      WHERE passenger_id = $1 AND payment_method = 'pay_later'
        AND device_id = 'paylater-demo-debt' LIMIT 1`,
    [riders[2]]
  );
  if (!debtRide) {
    const ride = await queryOne<{ id: string }>(
      `INSERT INTO rides
         (passenger_id, driver_id, pickup_address, destination_address,
          status, estimated_fare, actual_fare, payment_method, payment_status,
          completed_at, created_at, device_id)
       VALUES ($1, $2, 'Demo pickup', 'Demo destination',
               'completed', 35, 35, 'pay_later', 'pending',
               NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days',
               'paylater-demo-debt')
       RETURNING id`,
      [riders[2], drivers[0]]
    );
    if (ride?.id) await registerPayLaterDebit(ride.id).catch(() => false);
  }

  await writeAudit(actor, {
    action: "paylater.demo_seed",
    entityType: "pay_later_demo",
    entityId: "demo-set",
    newValue: { riders: riders.length, drivers: drivers.length },
    reason: "Demo riders seeded for admin testing",
  });

  return {
    success: true,
    riders: riders.length,
    drivers: drivers.length,
    rider_ids: riders,
    demo_emails: riderSpecs.map((r) => r.email),
  };
}

/** Removes ONLY the demo users and their demo rides/accounts. */
export async function clearPayLaterDemos(actor: AdminActor) {
  await ensureAdminPayLaterSchema();
  const demo = await safeQuery<any>(
    `SELECT user_id FROM pay_later_demo_users
      UNION
     SELECT id AS user_id FROM users WHERE firebase_uid LIKE '${DEMO_PREFIX}-%'`
  );
  const ids = (demo || []).map((r) => r.user_id).filter(Boolean);
  if (ids.length === 0) {
    return { success: true, removed: 0 };
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const rideRows = await client.query<{ id: string }>(
      `SELECT id FROM rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])`,
      [ids]
    );
    const rideIds = rideRows.rows.map((r) => r.id);
    if (rideIds.length) {
      await client.query(`DELETE FROM ride_offers WHERE ride_id = ANY($1::uuid[])`, [rideIds]);
      await client.query(`DELETE FROM ride_events WHERE ride_id = ANY($1::uuid[])`, [rideIds]).catch(() => {});
    }
    await client.query(`DELETE FROM pay_later_ledger WHERE rider_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM pay_later_grants WHERE rider_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM pay_later_accounts WHERE user_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM pay_later_demo_users WHERE user_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM payments WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => {});
    await client.query(`DELETE FROM saved_cards WHERE user_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await writeAudit(actor, {
    action: "paylater.demo_clear",
    entityType: "pay_later_demo",
    entityId: "demo-set",
    oldValue: { removed: ids.length },
    reason: "Demo riders removed",
  });
  return { success: true, removed: ids.length };
}
