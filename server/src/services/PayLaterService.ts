import getPool from "../config/database";
import { query, queryOne, execute } from "../config/database";
import * as iVerve from "./iVerveService";

// Ladder numbers — configurable here, pending final product decisions.
export const PAY_LATER = {
  MIN_COMPLETED_RIDES: 10,
  BASE_LIMIT: 100,
  LIMIT_STEP: 50, // added every RIDES_PER_STEP completed rides
  RIDES_PER_STEP: 10,
  CAP: 1000,
  COLLECTION_ATTEMPTS_BEFORE_OVERDUE: 3, // day 1 / day 3 / day 7
} as const;

function lastDayOfMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
}

export function computeCreditLimit(completedRides: number): number {
  if (completedRides < PAY_LATER.MIN_COMPLETED_RIDES) return 0;
  const steps = Math.floor(
    (completedRides - PAY_LATER.MIN_COMPLETED_RIDES) / PAY_LATER.RIDES_PER_STEP
  );
  return Math.min(PAY_LATER.CAP, PAY_LATER.BASE_LIMIT + steps * PAY_LATER.LIMIT_STEP);
}

export async function ensurePayLaterTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS pay_later_accounts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      credit_limit NUMERIC(12,2) NOT NULL DEFAULT 100,
      outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      mandate_token VARCHAR(255),
      card_token VARCHAR(255),
      account_holder VARCHAR(120),
      bank_code VARCHAR(20),
      account_number_masked VARCHAR(20),
      identity_fingerprint VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS payment_collections (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      result VARCHAR(20) NOT NULL,
      provider VARCHAR(50),
      reason VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS pay_later_blacklist (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      identity_fingerprint VARCHAR(255) NOT NULL UNIQUE,
      reason VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Additive only: no-op when the columns already exist. payment_status and
  // payment_method are already used by the affiliate flow on some installs.
  await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20)`);
  await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20)`);
  await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ`);
}

// Loyalty counter. Simplified v1 guard: a (rider, driver) pairing used 5+ times
// is treated as "ride farming" and excluded from the count. Cancel-and-instant-
// rebook and very-short-ride heuristics are future work.
export async function countCompletedRides(dbUserId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM rides r
     WHERE r.passenger_id = $1
       AND r.status = 'completed'
       AND r.driver_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM rides r2
         WHERE r2.passenger_id = $1
           AND r2.driver_id = r.driver_id
           AND r2.status = 'completed'
         HAVING COUNT(*) >= 5
       )`,
    [dbUserId]
  );
  return parseInt(row?.total || "0", 10);
}

async function getAccount(dbUserId: string) {
  return queryOne<any>(
    `SELECT a.*, u.phone, u.email
     FROM pay_later_accounts a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.user_id = $1`,
    [dbUserId]
  );
}

function maskAccountNumber(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `•••• ${last4}`;
}

export interface EnrollInput {
  accountHolder: string;
  bankCode: string;
  accountNumber: string;
  cardToken?: string;
  identityFingerprint?: string;
}

export async function enrollPayLater(dbUserId: string, input: EnrollInput) {
  await ensurePayLaterTables();

  const user = await queryOne<{ id: string; phone: string | null; email: string | null }>(
    "SELECT id, phone, email FROM users WHERE id = $1",
    [dbUserId]
  );
  if (!user) throw new Error("User not found");

  const fingerprint = (
    input.identityFingerprint ||
    `${input.accountNumber}|${user.phone || user.email || ""}`
  ).toLowerCase();

  const blacklisted = await queryOne<{ id: string }>(
    "SELECT id FROM pay_later_blacklist WHERE identity_fingerprint = $1",
    [fingerprint]
  );
  if (blacklisted) {
    throw new Error("This identity is not eligible for Pay Later.");
  }

  const priorFrozen = await queryOne<{ id: string }>(
    "SELECT id FROM pay_later_accounts WHERE identity_fingerprint = $1 AND status = 'frozen'",
    [fingerprint]
  );
  if (priorFrozen) {
    throw new Error("This identity is not eligible for Pay Later.");
  }

  // In mock mode the 10-ride loyalty gate is bypassed (and a base limit is
  // granted) so the flow can be tested end-to-end without farming rides.
  // Live mode always enforces the gate.
  const mockBypass = iVerve.paymentsMode() === "mock";
  const completedRides = await countCompletedRides(dbUserId);
  if (!mockBypass && completedRides < PAY_LATER.MIN_COMPLETED_RIDES) {
    throw new Error(
      `Pay Later unlocks after ${PAY_LATER.MIN_COMPLETED_RIDES} completed rides (you have ${completedRides}).`
    );
  }

  // Debit-order mandate for month-end collection + R1 card auth-hold validation.
  const mandate = await iVerve.createMandate({
    accountHolder: input.accountHolder,
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
  });
  const cardHold = input.cardToken
    ? await iVerve.validateCardHold(input.cardToken)
    : { verified: true, holdReference: "no-card-on-file" };

  if (!cardHold.verified) throw new Error("Card validation failed.");

  const creditLimit = computeCreditLimit(
    mockBypass ? Math.max(completedRides, PAY_LATER.MIN_COMPLETED_RIDES) : completedRides
  );
  const account = await queryOne<any>(
    `INSERT INTO pay_later_accounts
       (user_id, credit_limit, status, mandate_token, card_token,
        account_holder, bank_code, account_number_masked, identity_fingerprint)
     VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       credit_limit = EXCLUDED.credit_limit,
       status = 'active',
       mandate_token = EXCLUDED.mandate_token,
       card_token = EXCLUDED.card_token,
       account_holder = EXCLUDED.account_holder,
       bank_code = EXCLUDED.bank_code,
       account_number_masked = EXCLUDED.account_number_masked,
       updated_at = NOW()
     RETURNING *`,
    [
      dbUserId,
      creditLimit,
      mandate.mandateToken,
      input.cardToken || null,
      input.accountHolder,
      input.bankCode,
      maskAccountNumber(input.accountNumber),
      fingerprint,
    ]
  );

  return {
    account: { ...account, available: Number(account.credit_limit) - Number(account.outstanding) },
    mandate: { token: mandate.mandateToken, bankVerified: mandate.bankVerified },
    card: { verified: cardHold.verified, holdReference: cardHold.holdReference },
    completed_rides: completedRides,
    mode: iVerve.paymentsMode(),
  };
}

export async function getPayLaterStatus(dbUserId: string) {
  await ensurePayLaterTables();

  const account = await getAccount(dbUserId);
  if (!account) return { enrolled: false, mode: iVerve.paymentsMode() };

  const openRides = await query<any>(
    `SELECT id, COALESCE(actual_fare, estimated_fare) AS fare,
            created_at, due_at, payment_status
     FROM rides
     WHERE passenger_id = $1 AND payment_method = 'pay_later'
     ORDER BY created_at DESC LIMIT 50`,
    [dbUserId]
  );

  const completedRides = await countCompletedRides(dbUserId);

  return {
    enrolled: true,
    mode: iVerve.paymentsMode(),
    account: {
      id: account.id,
      status: account.status,
      credit_limit: Number(account.credit_limit),
      outstanding: Number(account.outstanding),
      available: Number(account.credit_limit) - Number(account.outstanding),
      account_number_masked: account.account_number_masked,
      bank_code: account.bank_code,
      mandate_token: account.mandate_token,
      card_token: account.card_token,
    },
    completed_rides: completedRides,
    rides: openRides,
  };
}

export async function refreshPayLaterLimit(dbUserId: string) {
  await ensurePayLaterTables();

  const account = await getAccount(dbUserId);
  if (!account) throw new Error("You are not enrolled in Pay Later yet.");

  const completedRides = await countCompletedRides(dbUserId);
  const newLimit = computeCreditLimit(completedRides);

  const updated = await queryOne<any>(
    `UPDATE pay_later_accounts
     SET credit_limit = GREATEST(credit_limit, $2), updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [dbUserId, newLimit]
  );

  return {
    account: { ...updated, available: Number(updated.credit_limit) - Number(updated.outstanding) },
    completed_rides: completedRides,
  };
}

export async function payRideWithPayLater(dbUserId: string, rideId: string) {
  await ensurePayLaterTables();

  const account = await getAccount(dbUserId);
  if (!account || account.status !== "active") {
    throw new Error("Pay Later is not active on your account.");
  }

  const ride = await queryOne<any>(
    `SELECT id, passenger_id, status, COALESCE(actual_fare, estimated_fare) AS fare, payment_status
     FROM rides WHERE id = $1 AND passenger_id = $2`,
    [rideId, dbUserId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.status !== "completed") throw new Error("This ride is not completed yet");
  if (ride.payment_status === "paid") return { success: true, alreadyPaid: true };

  const fare = Number(ride.fare);
  if (!isFinite(fare) || fare <= 0) throw new Error("This ride has no amount due");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE pay_later_accounts
       SET outstanding = GREATEST(outstanding - $1, 0), updated_at = NOW()
       WHERE user_id = $2`,
      [fare, dbUserId]
    );
    await client.query(
      `UPDATE rides SET payment_status = 'paid', due_at = NULL WHERE id = $1`,
      [rideId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const updated = await getAccount(dbUserId);
  return {
    success: true,
    amount_paid: fare,
    account: {
      credit_limit: Number(updated.credit_limit),
      outstanding: Number(updated.outstanding),
      available: Number(updated.credit_limit) - Number(updated.outstanding),
    },
  };
}

export interface CollectionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  overdue: number;
  details: { rideId: string; attempt: number; result: string; overdue: boolean }[];
}

// Month-end job: collect all pending pay-later rides whose due date has passed.
// Retries on a short schedule (attempt 1/2/3 ≈ day 1/3/7) before declaring a
// ride overdue, freezing the account and blacklisting the identity.
export async function runMonthlyCollection(): Promise<CollectionSummary> {
  await ensurePayLaterTables();

  const dueRides = await query<any>(
    `SELECT id, passenger_id, COALESCE(actual_fare, estimated_fare) AS fare
     FROM rides
     WHERE payment_method = 'pay_later'
       AND payment_status = 'pending'
       AND (due_at IS NULL OR due_at <= NOW())`
  );

  const summary: CollectionSummary = { attempted: 0, succeeded: 0, failed: 0, overdue: 0, details: [] };

  for (const ride of dueRides) {
    const account = await getAccount(ride.passenger_id);
    if (!account || account.status !== "active") continue;

    const countRow = await queryOne<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM payment_collections WHERE ride_id = $1",
      [ride.id]
    );
    const attemptNumber = (countRow?.n || 0) + 1;
    const fare = Number(ride.fare);

    const result = await iVerve.collectMandate(
      account.mandate_token,
      fare,
      `PL-${ride.id}`
    );

    summary.attempted++;

    if (result.success) {
      await execute(
        "UPDATE rides SET payment_status = 'paid', due_at = NULL WHERE id = $1",
        [ride.id]
      );
      await execute(
        `UPDATE pay_later_accounts
         SET outstanding = GREATEST(outstanding - $1, 0), updated_at = NOW()
         WHERE user_id = $2`,
        [fare, ride.passenger_id]
      );
      await execute(
        `INSERT INTO payment_collections (rider_id, ride_id, amount, attempt_number, result, provider)
         VALUES ($1, $2, $3, $4, 'success', 'iverve')`,
        [ride.passenger_id, ride.id, fare, attemptNumber]
      );
      summary.succeeded++;
      summary.details.push({ rideId: ride.id, attempt: attemptNumber, result: "success", overdue: false });
    } else {
      await execute(
        `INSERT INTO payment_collections (rider_id, ride_id, amount, attempt_number, result, provider, reason)
         VALUES ($1, $2, $3, $4, 'failed', 'iverve', $5)`,
        [ride.passenger_id, ride.id, fare, attemptNumber, result.error || "Collection failed"]
      );

      const isFinalAttempt =
        attemptNumber >= PAY_LATER.COLLECTION_ATTEMPTS_BEFORE_OVERDUE;
      summary.failed++;
      summary.details.push({ rideId: ride.id, attempt: attemptNumber, result: "failed", overdue: isFinalAttempt });

      if (isFinalAttempt) {
        await execute(
          "UPDATE rides SET payment_status = 'overdue' WHERE id = $1",
          [ride.id]
        );
        await execute(
          "UPDATE pay_later_accounts SET status = 'frozen', updated_at = NOW() WHERE user_id = $1",
          [ride.passenger_id]
        );
        if (account.identity_fingerprint) {
          await execute(
            `INSERT INTO pay_later_blacklist (identity_fingerprint, reason)
             VALUES ($1, $2) ON CONFLICT (identity_fingerprint) DO NOTHING`,
            [account.identity_fingerprint, "Pay Later collection failed after multiple attempts"]
          );
        }
        summary.overdue++;
      }
    }
  }

  return summary;
}

// Dev helper: mark a completed ride as a pay-later ride due at month-end and
// add its fare to the rider's outstanding balance. This simulates what the
// (future) booking guard + completion flow will do, without touching the
// existing booking path.
export async function simulatePayLaterRide(dbUserId: string, rideId: string) {
  await ensurePayLaterTables();

  const account = await getAccount(dbUserId);
  if (!account || account.status !== "active") {
    throw new Error("Pay Later is not active on your account.");
  }

  const ride = await queryOne<any>(
    `SELECT id, passenger_id, status, COALESCE(actual_fare, estimated_fare) AS fare
     FROM rides WHERE id = $1 AND passenger_id = $2`,
    [rideId, dbUserId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.status !== "completed") throw new Error("Only completed rides can be pay-later");

  const fare = Number(ride.fare);
  if (!isFinite(fare) || fare <= 0) throw new Error("This ride has no fare");

  const available = Number(account.credit_limit) - Number(account.outstanding);
  if (fare > available) {
    throw new Error(
      `This ride (R${fare.toFixed(2)}) exceeds your available Pay Later credit (R${available.toFixed(2)}).`
    );
  }

  await execute(
    `UPDATE rides
     SET payment_method = 'pay_later', payment_status = 'pending', due_at = $1
     WHERE id = $2`,
    [lastDayOfMonth(), ride.id]
  );
  await execute(
    `UPDATE pay_later_accounts SET outstanding = outstanding + $1, updated_at = NOW() WHERE user_id = $2`,
    [fare, dbUserId]
  );

  const updated = await getAccount(dbUserId);
  return {
    rideId: ride.id,
    due_at: lastDayOfMonth().toISOString(),
    account: {
      credit_limit: Number(updated.credit_limit),
      outstanding: Number(updated.outstanding),
      available: Number(updated.credit_limit) - Number(updated.outstanding),
    },
  };
}
