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
exports.ensurePayoutsTable = ensurePayoutsTable;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const paystackPayment_1 = require("../services/paystackPayment");
const router = (0, express_1.Router)();
// Ensure the payouts table exists.
async function ensurePayoutsTable() {
    try {
        await (0, database_1.execute)(`
      CREATE TABLE IF NOT EXISTS payouts (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        driver_id UUID NOT NULL REFERENCES users(id),
        bank_code VARCHAR(20),
        account_number VARCHAR(30),
        bank_name VARCHAR(100),
        recipient_code VARCHAR(100),
        amount NUMERIC(10,2),
        reference VARCHAR(100) UNIQUE,
        transfer_code VARCHAR(100),
        status VARCHAR(20),
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await (0, database_1.execute)(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS transfer_code VARCHAR(100)`);
        // The banking table may not exist yet if no driver ever saved banking via
        // the old wallet flow — create it here so we can cache recipients.
        await (0, database_1.execute)(`
      CREATE TABLE IF NOT EXISTS driver_banking (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        driver_id UUID NOT NULL UNIQUE REFERENCES users(id),
        bank_account_number VARCHAR(50),
        bank_code VARCHAR(20),
        bank_name VARCHAR(100),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        // Extra columns used to cache a transfer recipient per driver+account.
        await (0, database_1.execute)(`ALTER TABLE driver_banking ADD COLUMN IF NOT EXISTS recipient_code VARCHAR(100)`);
        await (0, database_1.execute)(`ALTER TABLE driver_banking ADD COLUMN IF NOT EXISTS account_name VARCHAR(255)`);
        // Track which earnings have already been paid out so the available balance
        // shrinks after each withdrawal.
        await (0, database_1.execute)(`
      CREATE TABLE IF NOT EXISTS driver_earnings_paid (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        earning_id UUID NOT NULL REFERENCES driver_earnings(id),
        payout_id UUID REFERENCES payouts(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(earning_id)
      )
    `);
    }
    catch {
        /* already exists */
    }
}
// GET /api/payouts/banks — banks the driver can withdraw to (code = Paystack bank code)
router.get("/banks", (_req, res) => {
    res.json([
        { name: "First National Bank (FNB)", code: "250655" },
        { name: "Standard Bank", code: "051001" },
        { name: "ABSA", code: "632005" },
        { name: "Nedbank", code: "198765" },
        { name: "Capitec", code: "470010" },
        { name: "Discovery Bank", code: "679000" },
        { name: "TymeBank", code: "678910" },
    ]);
});
// POST /api/payouts/resolve — Validate + create a transfer recipient for the driver
router.post("/resolve", auth_1.requireAuth, async (req, res) => {
    try {
        const { bankCode, accountNumber } = req.body;
        if (!bankCode || !accountNumber) {
            res.status(400).json({ error: "bankCode and accountNumber are required" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        const recipient = await (0, paystackPayment_1.createTransferRecipient)({
            bankCode,
            accountNumber,
            name: user.full_name || "Vura Driver",
        });
        // Cache the recipient so we never create duplicates for the same account.
        try {
            await (0, database_1.execute)(`INSERT INTO driver_banking (driver_id, bank_account_number, bank_code, recipient_code, account_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (driver_id) DO UPDATE SET
           bank_account_number = EXCLUDED.bank_account_number,
           bank_code = EXCLUDED.bank_code,
           recipient_code = EXCLUDED.recipient_code,
           account_name = EXCLUDED.account_name,
           updated_at = NOW()`, [user.id, accountNumber, bankCode, recipient.recipient_code, recipient.account_name]);
        }
        catch {
            /* banking table optional */
        }
        res.json({ success: true, ...recipient });
    }
    catch (err) {
        console.error("Payout resolve error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payouts/request — Withdraw available earnings to the driver's bank account
router.post("/request", auth_1.requireAuth, async (req, res) => {
    try {
        const { bankCode, accountNumber, amount, bankName, recipientCode } = req.body;
        const amountRands = Number(amount);
        if (!bankCode || !accountNumber || !amountRands || amountRands < 20) {
            res.status(400).json({ error: "Amount must be at least R20 and bank details are required" });
            return;
        }
        const user = await (0, database_1.queryOne)("SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1", [req.userId]);
        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        // ── LEDGER IS THE SOURCE OF TRUTH (commission spec): available cash-out
        // = the wallet's posted balance (card credits after webhook capture,
        // − cash commissions, − previous payouts). Clamped at 0: you can never
        // withdraw money you owe. The legacy rides-derived expression remains
        // only as a fallback if the ledger tables are unreachable mid-deploy.
        let available = -1;
        try {
            const { getBalanceCents, walletLedgerReady } = await Promise.resolve().then(() => __importStar(require("../services/walletService")));
            if (await walletLedgerReady()) {
                available = Math.max(0, Math.round(await getBalanceCents(user.id)) / 100);
            }
        }
        catch {
            available = -1;
        }
        if (available < 0) {
            const earnings = await (0, database_1.queryOne)(`SELECT
           (SELECT COALESCE(SUM(COALESCE(actual_fare, estimated_fare, 0)), 0)::float FROM rides
             WHERE driver_id = $1 AND status = 'completed'
               AND LOWER(COALESCE(payment_method, '')) IN ('card', 'pay_later')) AS card_earnings,
           (SELECT COALESCE(SUM(amount), 0)::float FROM payouts
             WHERE driver_id = $1 AND status = 'success') AS paid_out`, [user.id]);
            available = Math.max(0, Number(earnings?.card_earnings || 0) - Number(earnings?.paid_out || 0));
        }
        if (amountRands > available) {
            res.status(400).json({ error: `Insufficient balance. You have R${available.toFixed(2)} available to cash out.` });
            return;
        }
        await ensurePayoutsTable();
        // Get or reuse the recipient (resolve if not passed in).
        let rc = recipientCode || null;
        if (!rc) {
            const saved = await (0, database_1.queryOne)("SELECT recipient_code FROM driver_banking WHERE driver_id = $1 AND bank_account_number = $2", [user.id, accountNumber]).catch(() => null);
            if (saved?.recipient_code) {
                rc = saved.recipient_code;
            }
            else {
                const rec = await (0, paystackPayment_1.createTransferRecipient)({ bankCode, accountNumber, name: user.full_name || "Vura Driver" });
                rc = rec.recipient_code;
            }
        }
        const reference = `VURAPAY${Date.now().toString(36).toUpperCase()}` +
            `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const transfer = await (0, paystackPayment_1.transferFunds)({
            recipientCode: rc,
            amountRands,
            reference,
            reason: "Vura driver cash-out",
        });
        const status = transfer.success ? "success" : "failed";
        const payoutRow = await (0, database_1.execute)(`INSERT INTO payouts (driver_id, bank_code, account_number, bank_name, recipient_code, amount, reference, transfer_code, status, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`, [user.id, bankCode, accountNumber, bankName || null, rc, amountRands, reference, transfer.transferCode || null, status, transfer.message || null]).catch(() => null);
        // On success, mark the oldest unpaid earnings as paid so the next
        // available-balance calculation reflects the withdrawal.
        if (transfer.success && payoutRow?.rows?.[0]?.id) {
            const payoutId = payoutRow.rows[0].id;
            try {
                const toPay = await (0, database_1.query)(`SELECT de.id, COALESCE(de.net_amount, 0)::float AS net FROM driver_earnings de
           LEFT JOIN driver_earnings_paid dep ON dep.earning_id = de.id
           WHERE de.driver_id = $1 AND dep.earning_id IS NULL
           ORDER BY de.created_at ASC`, [user.id]);
                let remaining = amountRands;
                for (const e of toPay || []) {
                    if (remaining <= 0)
                        break;
                    await (0, database_1.execute)(`INSERT INTO driver_earnings_paid (earning_id, payout_id) VALUES ($1, $2)
             ON CONFLICT (earning_id) DO NOTHING`, [e.id, payoutId]).catch(() => undefined);
                    remaining -= Math.min(Number(e.net) || 0, remaining);
                }
            }
            catch (err) {
                console.warn("Mark-paid earnings error:", err);
            }
            // ── Ledger debit: the successful cash-out reduces the wallet balance
            // (idempotent per payout id — a retried success can't double-debit).
            try {
                const { recordPayoutDebit } = await Promise.resolve().then(() => __importStar(require("../services/walletService")));
                await recordPayoutDebit(user.id, payoutId, amountRands);
            }
            catch (err) {
                console.warn(`[wallet] payout debit failed payout=${payoutId}:`, err?.message || err);
            }
        }
        res.json({
            success: transfer.success,
            reference: transfer.reference || reference,
            transferCode: transfer.transferCode,
            message: transfer.message || (transfer.success ? "Withdrawal submitted." : "Withdrawal failed."),
        });
    }
    catch (err) {
        console.error("Payout request error:", err);
        res.status(500).json({ error: err.message });
    }
});
// Create the payouts table at server startup (not just on first withdrawal) so
// ANY query that joins/subqueries payouts (e.g. the wallet pending-earnings
// endpoint) never 500s on a missing table.
ensurePayoutsTable();
exports.default = router;
//# sourceMappingURL=payouts.js.map