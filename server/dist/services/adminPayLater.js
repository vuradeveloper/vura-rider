"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayLaterGrantError = void 0;
exports.ensureAdminPayLaterSchema = ensureAdminPayLaterSchema;
exports.getPayLaterFunds = getPayLaterFunds;
exports.getPayLaterEligibleRiders = getPayLaterEligibleRiders;
exports.getPayLaterAccounts = getPayLaterAccounts;
exports.getPayLaterSeries = getPayLaterSeries;
exports.getPayLaterAdminOverview = getPayLaterAdminOverview;
exports.grantPayLater = grantPayLater;
exports.setPayLaterAccountStatus = setPayLaterAccountStatus;
exports.seedPayLaterDemos = seedPayLaterDemos;
exports.clearPayLaterDemos = clearPayLaterDemos;
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
const crypto_1 = require("crypto");
const database_1 = __importStar(require("../config/database"));
const adminAuth_1 = require("./adminAuth");
const PayLaterService_1 = require("./PayLaterService");
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
async function safeQuery(sql, params = []) {
    try {
        return await (0, database_1.query)(sql, params);
    }
    catch (err) {
        if ((0, database_1.isMissingRelation)(err))
            return null;
        throw err;
    }
}
async function safeQueryOne(sql, params = []) {
    try {
        return await (0, database_1.queryOne)(sql, params);
    }
    catch (err) {
        if ((0, database_1.isMissingRelation)(err))
            return null;
        throw err;
    }
}
/** Tables this screen needs, created in place (no migration dependency). */
async function ensureAdminPayLaterSchema() {
    await (0, PayLaterService_1.ensurePayLaterTables)();
    await (0, database_1.execute)(`
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
    await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS pay_later_grants_rider_idx
       ON pay_later_grants (rider_id, created_at)`).catch(() => { });
    await (0, database_1.execute)(`
    CREATE TABLE IF NOT EXISTS pay_later_demo_users (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // The revenue/graph queries read these columns; a database that has not run
    // preauthorization yet still gets the page instead of a 500.
    await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS booking_fee_cents INTEGER`).catch(() => { });
    await (0, database_1.execute)(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10,2)`).catch(() => { });
}
async function getPayLaterFunds() {
    await ensureAdminPayLaterSchema();
    const revenue = await safeQueryOne(`SELECT COALESCE(SUM(
        COALESCE(platform_fee, 0) + COALESCE(booking_fee_cents, 0)::numeric / 100
      ), 0)::text AS v
       FROM rides WHERE status = 'completed'`);
    const referral = await safeQueryOne(`SELECT COALESCE(SUM(balance), 0)::text AS v FROM affiliates`);
    const outstanding = await safeQueryOne(`SELECT COALESCE(SUM(
        CASE entry_type
          WHEN 'debit' THEN amount
          WHEN 'credit' THEN -CASE WHEN status = 'confirmed' THEN amount ELSE 0 END
          ELSE 0 END), 0)::text AS v
       FROM pay_later_ledger`);
    const collected = await safeQueryOne(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM payments
      WHERE status IN ('success','completed','paid')`);
    const payoutsPaid = await safeQueryOne(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM payouts
      WHERE status IN ('success','completed','paid')`);
    const earningsOwed = await safeQueryOne(`SELECT (
        COALESCE((SELECT SUM(net_amount) FROM driver_earnings), 0)
        - COALESCE((SELECT SUM(de.net_amount)
                      FROM driver_earnings_paid dp
                      JOIN driver_earnings de ON de.id = dp.earning_id), 0)
      )::text AS v`);
    const granted = await safeQueryOne(`SELECT COALESCE(SUM(credit_limit), 0)::text AS v FROM pay_later_accounts`);
    const repaid = await safeQueryOne(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM pay_later_ledger
      WHERE entry_type = 'credit' AND status = 'confirmed'`);
    const counts = await safeQueryOne(`SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
       FROM pay_later_accounts`);
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
        cover_ratio: paylaterOutstanding > 0
            ? Math.round((platformRevenue / paylaterOutstanding) * 100) / 100
            : 0,
        as_of: new Date().toISOString(),
    };
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
function mapEligible(row, ridesRequired) {
    const state = row.account_status === "active"
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
async function getPayLaterEligibleRiders(limit = 500) {
    await ensureAdminPayLaterSchema();
    const cfg = (0, PayLaterService_1.payLaterConfig)();
    const rows = await safeQuery(ELIGIBLE_SQL, [
        cfg.ridesToUnlock,
        Math.min(500, Math.max(1, Math.floor(limit))),
    ]);
    return (rows || []).map((r) => mapEligible(r, cfg.ridesToUnlock));
}
async function getPayLaterAccounts(limit = 500) {
    await ensureAdminPayLaterSchema();
    const cfg = (0, PayLaterService_1.payLaterConfig)();
    const rows = await safeQuery(`SELECT u.id, u.full_name, u.email, u.phone,
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
      LIMIT $1`, [Math.min(500, Math.max(1, Math.floor(limit)))]);
    return (rows || []).map((r) => ({
        ...mapEligible(r, cfg.ridesToUnlock),
        grants_count: Number(r.grants_count || 0),
        last_grant_at: r.last_grant_at ? new Date(r.last_grant_at).toISOString() : null,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
}
async function getPayLaterSeries(days = 30) {
    await ensureAdminPayLaterSchema();
    const span = Math.min(90, Math.max(7, Math.floor(days)));
    const rows = await safeQuery(`WITH d AS (
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
     FROM d ORDER BY d.day`, [span]);
    const opening = await safeQueryOne(`SELECT COALESCE(SUM(
        CASE entry_type
          WHEN 'debit' THEN amount
          WHEN 'credit' THEN -CASE WHEN status = 'confirmed' THEN amount ELSE 0 END
          ELSE 0 END), 0)::text AS v
       FROM pay_later_ledger
      WHERE created_at < CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'`, [span]);
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
async function getPayLaterAdminOverview() {
    await ensureAdminPayLaterSchema();
    const [funds, eligible, accounts, series] = await Promise.all([
        getPayLaterFunds(),
        getPayLaterEligibleRiders(500),
        getPayLaterAccounts(500),
        getPayLaterSeries(30),
    ]);
    funds.eligible_waiting = eligible.filter((r) => r.state === "eligible").length;
    const cfg = (0, PayLaterService_1.payLaterConfig)();
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
class PayLaterGrantError extends Error {
    code;
    funds;
    constructor(code, message, funds) {
        super(message);
        this.code = code;
        this.funds = funds;
    }
}
exports.PayLaterGrantError = PayLaterGrantError;
async function countEligibleRides(riderId) {
    const row = await safeQueryOne(`SELECT COALESCE(SUM(LEAST(per_driver.c, 4)), 0)::text AS total
       FROM (
         SELECT r.driver_id, COUNT(*)::int AS c
           FROM rides r
          WHERE r.passenger_id = $1
            AND r.status = 'completed'
            AND r.driver_id IS NOT NULL
            AND (LOWER(COALESCE(r.payment_method, '')) = 'card' OR r.card_auth_code IS NOT NULL)
          GROUP BY r.driver_id
       ) per_driver`, [riderId]);
    return parseInt(row?.total || "0", 10);
}
/**
 * Grants (or tops up) one rider's Pay Later limit. The grant record is written
 * FIRST with a unique idempotency key, so a double-click (or a retry after a
 * dropped response) can never add the same R100 twice.
 */
async function grantPayLater(input) {
    await ensureAdminPayLaterSchema();
    const cfg = (0, PayLaterService_1.payLaterConfig)();
    const amount = round2(input.amountRands == null ? cfg.creditLimitR : Number(input.amountRands));
    if (!Number.isFinite(amount) || amount < 1 || amount > 5000) {
        throw new PayLaterGrantError("bad_amount", "Enter an amount between R1 and R5,000.");
    }
    const rider = await safeQueryOne(`SELECT id, full_name, email, phone FROM users WHERE id = $1`, [input.riderId]);
    if (!rider)
        throw new PayLaterGrantError("not_found", "Rider not found.");
    const existingAccount = await safeQueryOne(`SELECT id FROM pay_later_accounts WHERE user_id = $1`, [input.riderId]);
    if (!existingAccount) {
        const rides = await countEligibleRides(input.riderId);
        if (rides < cfg.ridesToUnlock && !input.override) {
            throw new PayLaterGrantError("not_eligible", `This rider has ${rides} of ${cfg.ridesToUnlock} paid card rides. They are not eligible yet.`);
        }
    }
    const fundsBefore = await getPayLaterFunds();
    if (amount > fundsBefore.available_to_lend_zar && !input.override) {
        throw new PayLaterGrantError("insufficient_funds", `This R${amount.toFixed(2)} grant exceeds the available lending headroom of R${fundsBefore.available_to_lend_zar.toFixed(2)}. Tick the override to proceed.`, fundsBefore);
    }
    const idempotencyKey = String(input.idempotencyKey || `plg-${(0, crypto_1.randomUUID)()}`).slice(0, 100);
    const actor = input.actor;
    const reason = String(input.reason || "").trim().slice(0, 255) || null;
    const client = await (0, database_1.default)().connect();
    let grantId = "";
    let already = false;
    let account;
    try {
        await client.query("BEGIN");
        const ins = await client.query(`INSERT INTO pay_later_grants
         (rider_id, amount, granted_by, reason, funds_before, outstanding_before,
          override, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`, [
            input.riderId,
            amount,
            actor.email,
            reason,
            fundsBefore.available_to_lend_zar,
            fundsBefore.paylater_outstanding_zar,
            !!input.override,
            idempotencyKey,
        ]);
        if (!ins.rowCount) {
            const seen = await client.query(`SELECT id, amount FROM pay_later_grants WHERE idempotency_key = $1`, [idempotencyKey]);
            await client.query("COMMIT");
            already = true;
            grantId = seen.rows[0]?.id || "";
            account = await safeQueryOne(`SELECT id, status, credit_limit, outstanding FROM pay_later_accounts WHERE user_id = $1`, [input.riderId]);
        }
        else {
            grantId = ins.rows[0].id;
            const fingerprint = [
                String(rider.phone || "").trim().toLowerCase(),
                String(rider.email || "").trim().toLowerCase(),
                String(rider.id),
            ].join("|");
            const acc = await client.query(`INSERT INTO pay_later_accounts
           (user_id, credit_limit, status, identity_fingerprint)
         VALUES ($1, $2, 'active', $3)
         ON CONFLICT (user_id) DO UPDATE
           SET credit_limit = pay_later_accounts.credit_limit + EXCLUDED.credit_limit,
               status = 'active',
               updated_at = NOW()
         RETURNING id, status, credit_limit, outstanding`, [input.riderId, amount, fingerprint]);
            account = acc.rows[0];
            await client.query("COMMIT");
        }
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
    const fundsAfter = await getPayLaterFunds();
    const limit = round2(Number(account?.credit_limit || 0));
    const outstanding = round2(Number(account?.outstanding || 0));
    if (!already) {
        await (0, adminAuth_1.writeAudit)(actor, {
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
async function setPayLaterAccountStatus(riderId, status, actor, reason) {
    await ensureAdminPayLaterSchema();
    const before = await safeQueryOne(`SELECT status FROM pay_later_accounts WHERE user_id = $1`, [riderId]);
    if (!before)
        throw new PayLaterGrantError("not_found", "This rider has no Pay Later account.");
    await (0, database_1.execute)(`UPDATE pay_later_accounts SET status = $2, updated_at = NOW() WHERE user_id = $1`, [riderId, status]);
    await (0, adminAuth_1.writeAudit)(actor, {
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
async function upsertDemoUser(key, fullName, email, phone, role) {
    const row = await (0, database_1.queryOne)(`INSERT INTO users (firebase_uid, full_name, email, phone, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (firebase_uid) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           updated_at = NOW()
     RETURNING id`, [`${DEMO_PREFIX}-${key}`, fullName, email, phone, role]);
    if (!row?.id)
        throw new Error("Could not create the demo rider");
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
async function seedPayLaterDemos(actor) {
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
    const riders = [];
    for (const spec of riderSpecs) {
        riders.push(await upsertDemoUser(spec.key, spec.name, spec.email, spec.phone, "passenger"));
    }
    for (let i = 0; i < riders.length; i++) {
        const riderId = riders[i];
        await (0, database_1.execute)(`INSERT INTO pay_later_demo_users (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`, [riderId]);
        // One demo card so the page can show the repayment rail.
        const card = await (0, database_1.queryOne)(`SELECT id FROM saved_cards WHERE user_id = $1 LIMIT 1`, [riderId]);
        if (!card) {
            await (0, database_1.execute)(`INSERT INTO saved_cards
           (user_id, card_type, last4, bank, exp_month, exp_year,
            card_number_masked, transaction_index, is_default)
         VALUES ($1, 'visa', '4242', 'Demo Bank', 12, 2030,
                 '•••• 4242', $2, TRUE)`, [riderId, `DEMO-CARD-${i + 1}`]);
        }
        // 12 completed card rides (6 per driver). The anti-farm cap counts 4 per
        // driver = 8, comfortably over the 5-ride unlock threshold.
        const existing = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS n FROM rides
        WHERE passenger_id = $1 AND device_id = 'paylater-demo'`, [riderId]);
        for (let n = Number(existing?.n || 0); n < 12; n++) {
            await (0, database_1.execute)(`INSERT INTO rides
           (passenger_id, driver_id, pickup_address, destination_address,
            status, estimated_fare, actual_fare, platform_fee, booking_fee_cents,
            payment_method, payment_status, card_auth_code, completed_at,
            created_at, device_id)
         VALUES ($1, $2, 'Demo pickup', 'Demo destination',
                 'completed', 120, 120, 5, 480,
                 'card', 'paid', $3, NOW() - ($4 || ' days')::interval,
                 NOW() - ($4 || ' days')::interval, 'paylater-demo')`, [riderId, drivers[n % 2], `DEMO-${n}`, String(1 + (n % 20))]);
        }
    }
    // Rider 2: pending approval (the admin must press Grant).
    await (0, database_1.execute)(`INSERT INTO pay_later_accounts (user_id, credit_limit, status, identity_fingerprint)
     VALUES ($1, 0, 'pending', $2)
     ON CONFLICT (user_id) DO NOTHING`, [riders[1], `demo|${riders[1]}`]);
    // Rider 3: active with R100 limit and a R35 pay-later debt.
    const active = await (0, database_1.queryOne)(`SELECT id, credit_limit FROM pay_later_accounts WHERE user_id = $1`, [riders[2]]);
    if (!active) {
        await (0, database_1.execute)(`INSERT INTO pay_later_accounts
         (user_id, credit_limit, status, identity_fingerprint, terms_accepted_at)
       VALUES ($1, 100, 'active', $2, NOW())
       ON CONFLICT (user_id) DO NOTHING`, [riders[2], `demo|${riders[2]}`]);
    }
    const debtRide = await (0, database_1.queryOne)(`SELECT id FROM rides
      WHERE passenger_id = $1 AND payment_method = 'pay_later'
        AND device_id = 'paylater-demo-debt' LIMIT 1`, [riders[2]]);
    if (!debtRide) {
        const ride = await (0, database_1.queryOne)(`INSERT INTO rides
         (passenger_id, driver_id, pickup_address, destination_address,
          status, estimated_fare, actual_fare, payment_method, payment_status,
          completed_at, created_at, device_id)
       VALUES ($1, $2, 'Demo pickup', 'Demo destination',
               'completed', 35, 35, 'pay_later', 'pending',
               NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days',
               'paylater-demo-debt')
       RETURNING id`, [riders[2], drivers[0]]);
        if (ride?.id)
            await (0, PayLaterService_1.registerPayLaterDebit)(ride.id).catch(() => false);
    }
    await (0, adminAuth_1.writeAudit)(actor, {
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
async function clearPayLaterDemos(actor) {
    await ensureAdminPayLaterSchema();
    const demo = await safeQuery(`SELECT user_id FROM pay_later_demo_users
      UNION
     SELECT id AS user_id FROM users WHERE firebase_uid LIKE '${DEMO_PREFIX}-%'`);
    const ids = (demo || []).map((r) => r.user_id).filter(Boolean);
    if (ids.length === 0) {
        return { success: true, removed: 0 };
    }
    const client = await (0, database_1.default)().connect();
    try {
        await client.query("BEGIN");
        const rideRows = await client.query(`SELECT id FROM rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])`, [ids]);
        const rideIds = rideRows.rows.map((r) => r.id);
        if (rideIds.length) {
            await client.query(`DELETE FROM ride_offers WHERE ride_id = ANY($1::uuid[])`, [rideIds]);
            await client.query(`DELETE FROM ride_events WHERE ride_id = ANY($1::uuid[])`, [rideIds]).catch(() => { });
        }
        await client.query(`DELETE FROM pay_later_ledger WHERE rider_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM pay_later_grants WHERE rider_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM pay_later_accounts WHERE user_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM pay_later_demo_users WHERE user_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM payments WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => { });
        await client.query(`DELETE FROM saved_cards WHERE user_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
        await client.query("COMMIT");
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "paylater.demo_clear",
        entityType: "pay_later_demo",
        entityId: "demo-set",
        oldValue: { removed: ids.length },
        reason: "Demo riders removed",
    });
    return { success: true, removed: ids.length };
}
//# sourceMappingURL=adminPayLater.js.map