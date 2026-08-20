"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERRAL_WINDOW_DAYS = exports.REFERRAL_REWARD = void 0;
exports.ensureAffiliateTables = ensureAffiliateTables;
exports.normalizeCode = normalizeCode;
exports.getAffiliateByUser = getAffiliateByUser;
exports.getOrCreateAffiliate = getOrCreateAffiliate;
exports.claimReferral = claimReferral;
exports.settleFirstRide = settleFirstRide;
exports.getAffiliateStats = getAffiliateStats;
exports.listReferrals = listReferrals;
exports.listTransactions = listTransactions;
exports.useBalanceForRide = useBalanceForRide;
exports.listPayouts = listPayouts;
exports.approvePayout = approvePayout;
const database_1 = __importDefault(require("../config/database"));
const database_2 = require("../config/database");
exports.REFERRAL_REWARD = 5; // R5 per referred rider's first ride, paid by Vura (FNB)
exports.REFERRAL_WINDOW_DAYS = 90; // invitee must finish their first ride within 90 days
async function ensureAffiliateTables() {
    await (0, database_2.execute)(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      referral_code VARCHAR(32) NOT NULL UNIQUE,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, database_2.execute)(`
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
    await (0, database_2.execute)(`
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
    await (0, database_2.execute)(`
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
function randomSuffix(len) {
    let out = "";
    for (let i = 0; i < len; i++) {
        out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return out;
}
function normalizeCode(code) {
    return code.trim().toUpperCase();
}
function slugPart(name) {
    const clean = (name || "FRIEND")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
    return clean || "FRIEND";
}
async function getAffiliateByUser(dbUserId) {
    return (0, database_2.queryOne)("SELECT id, user_id, referral_code, balance, status, created_at FROM affiliates WHERE user_id = $1", [dbUserId]);
}
async function getOrCreateAffiliate(dbUserId, name) {
    await ensureAffiliateTables();
    const existing = await getAffiliateByUser(dbUserId);
    if (existing)
        return existing;
    let code = "";
    for (let attempt = 0; attempt < 10; attempt++) {
        code = `VURA-${slugPart(name)}-${randomSuffix(4)}`;
        const clash = await (0, database_2.queryOne)("SELECT id FROM affiliates WHERE referral_code = $1", [code]);
        if (!clash)
            break;
    }
    const aff = await (0, database_2.queryOne)(`INSERT INTO affiliates (user_id, referral_code)
     VALUES ($1, $2) RETURNING id, user_id, referral_code, balance, status, created_at`, [dbUserId, code]);
    return aff;
}
async function claimReferral(dbUserId, rawCode) {
    await ensureAffiliateTables();
    const code = normalizeCode(rawCode);
    if (!code)
        throw new Error("Referral code is required");
    const affiliate = await (0, database_2.queryOne)("SELECT id, user_id FROM affiliates WHERE referral_code = $1", [code]);
    if (!affiliate)
        throw new Error("That referral code does not exist");
    if (affiliate.user_id === dbUserId)
        throw new Error("You can't use your own referral code");
    const already = await (0, database_2.queryOne)("SELECT id FROM referrals WHERE referred_user_id = $1", [dbUserId]);
    if (already)
        return { success: true, alreadyReferred: true };
    await (0, database_2.execute)(`INSERT INTO referrals (affiliate_id, referred_user_id, code_used)
     VALUES ($1, $2, $3)
     ON CONFLICT (referred_user_id) DO NOTHING`, [affiliate.id, dbUserId, code]);
    return { success: true };
}
async function settleFirstRide(rideId) {
    try {
        const ride = await (0, database_2.queryOne)("SELECT id, passenger_id FROM rides WHERE id = $1 AND status = 'completed'", [rideId]);
        if (!ride || !ride.passenger_id)
            return;
        const referral = await (0, database_2.queryOne)(`SELECT * FROM referrals WHERE referred_user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`, [ride.passenger_id]);
        if (!referral)
            return;
        const createdDaysAgo = (Date.now() - new Date(referral.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (createdDaysAgo > exports.REFERRAL_WINDOW_DAYS) {
            await (0, database_2.execute)("UPDATE referrals SET status = 'lapsed' WHERE id = $1", [referral.id]);
            return;
        }
        const client = await (0, database_1.default)().connect();
        try {
            await client.query("BEGIN");
            const ins = await client.query(`INSERT INTO affiliate_transactions (affiliate_id, type, amount, ride_id, reference)
         VALUES ($1, 'signup_bonus', $2, $3, $4)
         ON CONFLICT (affiliate_id, type, ride_id) DO NOTHING
         RETURNING id`, [referral.affiliate_id, exports.REFERRAL_REWARD, rideId, referral.id]);
            if (ins.rowCount && ins.rowCount > 0) {
                await client.query("UPDATE affiliates SET balance = balance + $1 WHERE id = $2", [exports.REFERRAL_REWARD, referral.affiliate_id]);
                await client.query(`UPDATE referrals
           SET status = 'settled', first_ride_id = $1, rewarded_amount = $2, settled_at = NOW()
           WHERE id = $3`, [rideId, exports.REFERRAL_REWARD, referral.id]);
                console.log(`🎉 Affiliate ${referral.affiliate_id} earned R${exports.REFERRAL_REWARD} from first ride ${rideId}`);
            }
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        console.error("Affiliate settling error:", err.message);
    }
}
async function getAffiliateStats(dbUserId) {
    const affiliate = await getAffiliateByUser(dbUserId);
    if (!affiliate)
        return null;
    const [totalEarned, totalReferrals, pendingCount, settledCount] = await Promise.all([
        (0, database_2.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM affiliate_transactions WHERE affiliate_id = $1 AND amount > 0`, [affiliate.id]),
        (0, database_2.queryOne)("SELECT COUNT(*)::text AS total FROM referrals WHERE affiliate_id = $1", [affiliate.id]),
        (0, database_2.queryOne)("SELECT COUNT(*)::text AS total FROM referrals WHERE affiliate_id = $1 AND status = 'pending'", [affiliate.id]),
        (0, database_2.queryOne)("SELECT COUNT(*)::text AS total FROM referrals WHERE affiliate_id = $1 AND status = 'settled'", [affiliate.id]),
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
async function listReferrals(dbUserId) {
    const affiliate = await getAffiliateByUser(dbUserId);
    if (!affiliate)
        return [];
    return (0, database_2.query)(`SELECT r.id, r.status, r.code_used, r.rewarded_amount, r.created_at, r.settled_at,
            u.full_name AS referred_name, u.email AS referred_email
     FROM referrals r
     LEFT JOIN users u ON u.id = r.referred_user_id
     WHERE r.affiliate_id = $1
     ORDER BY r.created_at DESC`, [affiliate.id]);
}
async function listTransactions(dbUserId) {
    const affiliate = await getAffiliateByUser(dbUserId);
    if (!affiliate)
        return [];
    return (0, database_2.query)(`SELECT id, type, amount, ride_id, reference, status, created_at
     FROM affiliate_transactions
     WHERE affiliate_id = $1
     ORDER BY created_at DESC
     LIMIT 100`, [affiliate.id]);
}
// Apply affiliate credit to a completed ride. The balance is spent like ride
// credit (no withdrawal) — the full fare must be covered by the balance.
async function useBalanceForRide(dbUserId, rideId) {
    await ensureAffiliateTables();
    const affiliate = await getAffiliateByUser(dbUserId);
    if (!affiliate)
        throw new Error("You are not an affiliate yet. Open the Invite & earn screen first.");
    const ride = await (0, database_2.queryOne)(`SELECT id, passenger_id, status, COALESCE(actual_fare, estimated_fare) AS fare
     FROM rides WHERE id = $1 AND passenger_id = $2`, [rideId, dbUserId]);
    if (!ride)
        throw new Error("Ride not found");
    if (ride.status !== "completed")
        throw new Error("This ride is not completed yet");
    if (ride.status === "completed") {
        const paid = await (0, database_2.queryOne)("SELECT payment_status FROM rides WHERE id = $1", [rideId]);
        if (paid?.payment_status === "paid")
            return { success: true, balance: parseFloat(affiliate.balance) };
    }
    const fare = Number(ride.fare);
    if (!isFinite(fare) || fare <= 0)
        throw new Error("This ride has no fare to pay");
    if (parseFloat(affiliate.balance) < fare) {
        throw new Error(`Affiliate credit must cover the full fare (R${fare.toFixed(2)}). Your balance is R${affiliate.balance}.`);
    }
    const client = await (0, database_1.default)().connect();
    try {
        await client.query("BEGIN");
        await client.query("UPDATE affiliates SET balance = balance - $1 WHERE id = $2", [fare, affiliate.id]);
        await client.query(`INSERT INTO affiliate_transactions (affiliate_id, type, amount, ride_id, reference)
       VALUES ($1, 'credit_used', $2, $3, $4)`, [affiliate.id, -fare, rideId, `Ride credit applied #${Date.now()}`]);
        await client.query(`UPDATE rides SET payment_status = 'paid', payment_method = 'affiliate' WHERE id = $1`, [rideId]);
        await client.query("COMMIT");
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
    const updated = await getAffiliateByUser(dbUserId);
    return { success: true, balance: parseFloat(updated.balance) };
}
async function listPayouts(status) {
    return (0, database_2.query)(`SELECT p.id, p.amount, p.method, p.status, p.created_at, p.paid_at,
            a.referral_code, u.full_name AS affiliate_name, u.email AS affiliate_email
     FROM affiliate_payouts p
     LEFT JOIN affiliates a ON a.id = p.affiliate_id
     LEFT JOIN users u ON u.id = a.user_id
     ${status ? "WHERE p.status = $1" : ""}
     ORDER BY p.created_at DESC`, status ? [status] : undefined);
}
async function approvePayout(payoutId, adminUid) {
    await (0, database_2.execute)(`UPDATE affiliate_payouts
     SET status = 'paid', paid_at = NOW()
     WHERE id = $1 AND status = 'requested'`, [payoutId]);
    console.log(`💸 Payout ${payoutId} approved by ${adminUid}`);
    return { success: true };
}
//# sourceMappingURL=AffiliateService.js.map