import getPool from "../config/database";
import { query, queryOne, execute } from "../config/database";

export const REFERRAL_REWARD = 5; // R5 per referred rider's first ride, paid by Vura (FNB)
export const REFERRAL_WINDOW_DAYS = 90; // invitee must finish their first ride within 90 days

export async function ensureAffiliateTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      referral_code VARCHAR(32) NOT NULL UNIQUE,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS referrals (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code_used VARCHAR(32),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      first_ride_id UUID,
      rewarded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMPTZ
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS affiliate_transactions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      ride_id UUID,
      reference VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(affiliate_id, type, ride_id)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS affiliate_payouts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      method VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'requested',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    )
  `);
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSuffix(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function slugPart(name: string | null | undefined): string {
  const clean = (name || "FRIEND")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return clean || "FRIEND";
}

export async function getAffiliateByUser(dbUserId: string) {
  return queryOne<any>(
    "SELECT id, user_id, referral_code, balance, status, created_at FROM affiliates WHERE user_id = $1",
    [dbUserId]
  );
}

export async function getOrCreateAffiliate(dbUserId: string, name?: string | null) {
  await ensureAffiliateTables();
  const existing = await getAffiliateByUser(dbUserId);
  if (existing) return existing;

  let code = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    code = `VURA-${slugPart(name)}-${randomSuffix(4)}`;
    const clash = await queryOne<{ id: string }>(
      "SELECT id FROM affiliates WHERE referral_code = $1",
      [code]
    );
    if (!clash) break;
  }

  const aff = await queryOne<any>(
    `INSERT INTO affiliates (user_id, referral_code)
     VALUES ($1, $2) RETURNING id, user_id, referral_code, balance, status, created_at`,
    [dbUserId, code]
  );
  return aff;
}

export async function claimReferral(dbUserId: string, rawCode: string) {
  await ensureAffiliateTables();
  const code = normalizeCode(rawCode);
  if (!code) throw new Error("Referral code is required");

  const affiliate = await queryOne<any>(
    "SELECT id, user_id FROM affiliates WHERE referral_code = $1",
    [code]
  );
  if (!affiliate) throw new Error("That referral code does not exist");
  if (affiliate.user_id === dbUserId) throw new Error("You can't use your own referral code");

  const already = await queryOne<{ id: string }>(
    "SELECT id FROM referrals WHERE referred_user_id = $1",
    [dbUserId]
  );
  if (already) return { success: true, alreadyReferred: true };

  await execute(
    `INSERT INTO referrals (affiliate_id, referred_user_id, code_used)
     VALUES ($1, $2, $3)
     ON CONFLICT (referred_user_id) DO NOTHING`,
    [affiliate.id, dbUserId, code]
  );
  return { success: true };
}

export async function settleFirstRide(rideId: string) {
  try {
    const ride = await queryOne<any>(
      "SELECT id, passenger_id FROM rides WHERE id = $1 AND status = 'completed'",
      [rideId]
    );
    if (!ride || !ride.passenger_id) return;

    const referral = await queryOne<any>(
      `SELECT * FROM referrals WHERE referred_user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [ride.passenger_id]
    );
    if (!referral) return;

    const createdDaysAgo =
      (Date.now() - new Date(referral.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (createdDaysAgo > REFERRAL_WINDOW_DAYS) {
      await execute(
        "UPDATE referrals SET status = 'lapsed' WHERE id = $1",
        [referral.id]
      );
      return;
    }

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO affiliate_transactions (affiliate_id, type, amount, ride_id, reference)
         VALUES ($1, 'signup_bonus', $2, $3, $4)
         ON CONFLICT (affiliate_id, type, ride_id) DO NOTHING
         RETURNING id`,
        [referral.affiliate_id, REFERRAL_REWARD, rideId, referral.id]
      );
      if (ins.rowCount && ins.rowCount > 0) {
        await client.query(
          "UPDATE affiliates SET balance = balance + $1 WHERE id = $2",
          [REFERRAL_REWARD, referral.affiliate_id]
        );
        await client.query(
          `UPDATE referrals
           SET status = 'settled', first_ride_id = $1, rewarded_amount = $2, settled_at = NOW()
           WHERE id = $3`,
          [rideId, REFERRAL_REWARD, referral.id]
        );
        console.log(
          `🎉 Affiliate ${referral.affiliate_id} earned R${REFERRAL_REWARD} from first ride ${rideId}`
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("Affiliate settling error:", err.message);
  }
}

export async function getAffiliateStats(dbUserId: string) {
  const affiliate = await getAffiliateByUser(dbUserId);
  if (!affiliate) return null;

  const [totalEarned, totalReferrals, pendingCount, settledCount] = await Promise.all([
    queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM affiliate_transactions WHERE affiliate_id = $1 AND amount > 0`,
      [affiliate.id]
    ),
    queryOne<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM referrals WHERE affiliate_id = $1",
      [affiliate.id]
    ),
    queryOne<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM referrals WHERE affiliate_id = $1 AND status = 'pending'",
      [affiliate.id]
    ),
    queryOne<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM referrals WHERE affiliate_id = $1 AND status = 'settled'",
      [affiliate.id]
    ),
  ]);

  return {
    ...affiliate,
    balance: parseFloat(affiliate.balance),
    total_earned: parseFloat(totalEarned?.total || "0"),
    total_referrals: parseInt(totalReferrals?.total || "0", 10),
    pending_referrals: parseInt(pendingCount?.total || "0", 10),
    settled_referrals: parseInt(settledCount?.total || "0", 10),
  };
}

export async function listReferrals(dbUserId: string) {
  const affiliate = await getAffiliateByUser(dbUserId);
  if (!affiliate) return [];

  return query(
    `SELECT r.id, r.status, r.code_used, r.rewarded_amount, r.created_at, r.settled_at,
            u.full_name AS referred_name, u.email AS referred_email
     FROM referrals r
     LEFT JOIN users u ON u.id = r.referred_user_id
     WHERE r.affiliate_id = $1
     ORDER BY r.created_at DESC`,
    [affiliate.id]
  );
}

export async function listTransactions(dbUserId: string) {
  const affiliate = await getAffiliateByUser(dbUserId);
  if (!affiliate) return [];

  return query(
    `SELECT id, type, amount, ride_id, reference, status, created_at
     FROM affiliate_transactions
     WHERE affiliate_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [affiliate.id]
  );
}

// Apply affiliate credit to a completed ride. The balance is spent like ride
// credit (no withdrawal) — the full fare must be covered by the balance.
export async function useBalanceForRide(dbUserId: string, rideId: string) {
  await ensureAffiliateTables();
  const affiliate = await getAffiliateByUser(dbUserId);
  if (!affiliate) throw new Error("You are not an affiliate yet. Open the Invite & earn screen first.");

  const ride = await queryOne<any>(
    `SELECT id, passenger_id, status, COALESCE(actual_fare, estimated_fare) AS fare
     FROM rides WHERE id = $1 AND passenger_id = $2`,
    [rideId, dbUserId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.status !== "completed") throw new Error("This ride is not completed yet");
  if (ride.status === "completed") {
    const paid = await queryOne<{ payment_status: string }>(
      "SELECT payment_status FROM rides WHERE id = $1",
      [rideId]
    );
    if (paid?.payment_status === "paid") return { success: true, balance: parseFloat(affiliate.balance) };
  }

  const fare = Number(ride.fare);
  if (!isFinite(fare) || fare <= 0) throw new Error("This ride has no fare to pay");
  if (parseFloat(affiliate.balance) < fare) {
    throw new Error(
      `Affiliate credit must cover the full fare (R${fare.toFixed(2)}). Your balance is R${affiliate.balance}.`
    );
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE affiliates SET balance = balance - $1 WHERE id = $2",
      [fare, affiliate.id]
    );
    await client.query(
      `INSERT INTO affiliate_transactions (affiliate_id, type, amount, ride_id, reference)
       VALUES ($1, 'credit_used', $2, $3, $4)`,
      [affiliate.id, -fare, rideId, `Ride credit applied #${Date.now()}`]
    );
    await client.query(
      `UPDATE rides SET payment_status = 'paid', payment_method = 'affiliate' WHERE id = $1`,
      [rideId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const updated = await getAffiliateByUser(dbUserId);
  return { success: true, balance: parseFloat(updated.balance) };
}

export async function listPayouts(status?: string) {
  return query(
    `SELECT p.id, p.amount, p.method, p.status, p.created_at, p.paid_at,
            a.referral_code, u.full_name AS affiliate_name, u.email AS affiliate_email
     FROM affiliate_payouts p
     LEFT JOIN affiliates a ON a.id = p.affiliate_id
     LEFT JOIN users u ON u.id = a.user_id
     ${status ? "WHERE p.status = $1" : ""}
     ORDER BY p.created_at DESC`,
    status ? [status] : undefined
  );
}

export async function approvePayout(payoutId: string, adminUid: string) {
  await execute(
    `UPDATE affiliate_payouts
     SET status = 'paid', paid_at = NOW()
     WHERE id = $1 AND status = 'requested'`,
    [payoutId]
  );
  console.log(`💸 Payout ${payoutId} approved by ${adminUid}`);
  return { success: true };
}