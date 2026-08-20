"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const iveriPayment_1 = require("../services/iveriPayment");
const router = (0, express_1.Router)();
// Ensure the payments table exists (one-time, per server)
async function ensurePaymentsTable() {
    try {
        await (0, database_1.execute)(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID REFERENCES users(id),
        ride_id UUID REFERENCES rides(id),
        reference VARCHAR(100),
        amount NUMERIC(10,2),
        currency VARCHAR(3) DEFAULT 'ZAR',
        status VARCHAR(20),
        provider VARCHAR(20),
        raw_response JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    }
    catch {
        /* already exists */
    }
}
// GET /api/payments/methods — List saved payment methods
router.get("/methods", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json([]);
            return;
        }
        const cards = await (0, database_1.query)(`SELECT id, card_type, last4, bank, is_default FROM saved_cards WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`, [user.id]);
        res.json(cards);
    }
    catch (err) {
        // Table might not exist yet — return empty
        if (err.code === "42P01") {
            res.json([]);
            return;
        }
        console.error("List cards error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/methods — Add a new card
router.post("/methods", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        let user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            user = await (0, database_1.queryOne)(`INSERT INTO users (firebase_uid, full_name, email, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
         RETURNING id`, [firebaseUid, req.user?.name || "Rider", req.user?.email || null, "passenger"]);
        }
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Create saved_cards table if needed
        try {
            await (0, database_1.execute)(`
        CREATE TABLE IF NOT EXISTS saved_cards (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id),
          card_type VARCHAR(20),
          last4 VARCHAR(4),
          bank VARCHAR(100),
          exp_month INTEGER,
          exp_year INTEGER,
          card_number_masked VARCHAR(30),
          transaction_index VARCHAR(100),
          is_default BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
            // Add tokenisation columns for databases created before this change.
            await (0, database_1.execute)(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS card_number_masked VARCHAR(30)`);
            await (0, database_1.execute)(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS transaction_index VARCHAR(100)`);
        }
        catch { /* already exists */ }
        const { card_type, last4, bank, exp_month, exp_year } = req.body;
        // Check if the user has any saved cards to determine if this should be the default
        const existingCards = await (0, database_1.query)("SELECT id FROM saved_cards WHERE user_id = $1 LIMIT 1", [user.id]).catch(() => []); // Fallback if table query fails
        const isDefault = existingCards.length === 0;
        const card = await (0, database_1.queryOne)(`INSERT INTO saved_cards (user_id, card_type, last4, bank, exp_month, exp_year, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, card_type, last4, bank, is_default`, [
            user.id,
            card_type || "card",
            last4 || "0000",
            bank || null,
            exp_month ? parseInt(exp_month, 10) : null,
            exp_year ? parseInt(exp_year, 10) : null,
            isDefault
        ]);
        res.status(201).json(card);
    }
    catch (err) {
        console.error("Add card error:", err);
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/payments/methods/:id — Remove a saved card
router.delete("/methods/:id", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        await (0, database_1.execute)("DELETE FROM saved_cards WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Remove card error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/initiate — Start an iVeri (Nedbank) hosted payment.
// Server-side only: builds the signed form fields; the secret never leaves the
// server. Adapted from the partner's snippet to Express + Firebase + Postgres.
router.post("/initiate", auth_1.requireAuth, async (req, res) => {
    try {
        const { amountRands, rideId } = req.body;
        const amount = Number(amountRands);
        // TEMPORARY: minimum is R0.20 for testing. Raise before production.
        if (!amount || amount < 0.2 || amount > 5000) {
            res.status(400).json({ error: "Amount must be between R0.20 and R5 000" });
            return;
        }
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        // Saved card (iVeri transaction index) — lets the rider pay without
        // re-entering card details if they've paid before.
        const savedCard = await (0, database_1.queryOne)(`SELECT transaction_index, last4, card_number_masked, exp_month, exp_year
       FROM saved_cards
       WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`, [user.id]).catch(() => null);
        const reference = `VURA${Date.now().toString(36).toUpperCase()}` +
            `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        try {
            await ensurePaymentsTable();
            await (0, database_1.execute)(`INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, $2, $3, $4, 'ZAR', 'initiated', 'iveri')`, [user.id, rideId || null, reference, amount]);
        }
        catch (e) { /* logging/table issues shouldn't block the payment */ }
        const result = (0, iveriPayment_1.buildIveriFormFields)({
            amountRands: amount,
            merchantReference: reference,
            userEmail: user.email,
            userFirstName: user.full_name,
            userPhone: user.phone,
            // Card-on-file token from a previous successful payment, so the rider
            // doesn't re-enter card details on the hosted page.
            transactionIndex: savedCard?.transaction_index || null,
            cardNumberMasked: savedCard?.card_number_masked || null,
            cardExpMonth: savedCard?.exp_month || null,
            cardExpYear: savedCard?.exp_year || null,
        });
        if (result === null) {
            res.json({ reference, live: false, fields: {}, gatewayUrl: "" });
            return;
        }
        // In mock mode there is no real gateway redirect, so simulate an approved
        // charge straight away — this is what lets the ride booking pre-auth check
        // pass and the refund flow work end-to-end during testing.
        if (!result.live) {
            await (0, database_1.execute)(`UPDATE payments SET status = 'completed', updated_at = NOW() WHERE reference = $1`, [reference]).catch(() => { });
        }
        res.json({ reference, ...result });
    }
    catch (err) {
        console.error("Payment initiate error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/card-register — Start an iVeri (Nedbank) card
// registration. Always shows the fresh hosted card-entry page (no stored token),
// so a card can be added/tokenised even if the rider has never paid before.
// On the gateway return, the /return handler captures the TransactionIndex and
// stores it on the user's default saved card.
router.post("/card-register", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        // A tiny AUTH-only registration amount. iVeri Lite requires an amount;
        // R1.00 minimum to avoid gateway rejection. This is a pre-auth to tokenise
        // the card, not a fare. The rider sees this as a pending auth that drops off.
        const amount = 1.0;
        const reference = `VURACARD${Date.now().toString(36).toUpperCase()}` +
            `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        try {
            await ensurePaymentsTable();
            await (0, database_1.execute)(`INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, NULL, $2, $3, 'ZAR', 'initiated', 'iveri')`, [user.id, reference, amount]);
        }
        catch (e) { /* logging/table issues shouldn't block the payment */ }
        const result = (0, iveriPayment_1.buildIveriFormFields)({
            amountRands: amount,
            merchantReference: reference,
            userEmail: user.email,
            userFirstName: user.full_name,
            userPhone: user.phone,
            // Deliberately NO saved-card token: always show the card entry page.
        });
        if (result === null) {
            res.json({ reference, live: false, fields: {}, gatewayUrl: "" });
            return;
        }
        // Mock mode: simulate an approved charge so the registration completes.
        if (!result.live) {
            await (0, database_1.execute)(`UPDATE payments SET status = 'completed', updated_at = NOW() WHERE reference = $1`, [reference]).catch(() => { });
        }
        res.json({ reference, ...result });
    }
    catch (err) {
        console.error("Card register error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET/POST /api/payments/return — iVeri Lite redirects the customer here after
// paying. The gateway POSTs the result (LITE_PAYMENT_CARD_STATUS etc.); we
// record it, then bounce to a GET with ?result=... so the app's WebView can
// detect the outcome from the URL.
router.all("/return", async (req, res) => {
    try {
        const q = req.method === "POST"
            ? req.body
            : req.query;
        const reference = String(q.ECOM_CONSUMERORDERID || q.merchant_reference || q.reference || "");
        const statusCode = String(q.LITE_PAYMENT_CARD_STATUS ?? "").trim();
        const resultCode = String(q.result || q.status || "").toLowerCase().trim();
        // Success = iVeri result code "0", or our own "success" bounce.
        const success = statusCode === "0" || resultCode === "0" || resultCode === "success";
        if (reference) {
            await (0, database_1.execute)(`UPDATE payments SET status = $1, raw_response = $2, updated_at = NOW()
         WHERE reference = $3`, [success ? "completed" : "failed", JSON.stringify(q), reference]).catch(() => { });
            // Card-on-file: on a successful payment the gateway returns the
            // TransactionIndex token + masked PAN + expiry. Store these on the user's
            // saved card so the NEXT ride uses them and never asks for card details.
            if (success) {
                const token = String(q.Lite_TransactionIndex || q.transaction_index || "").trim();
                const masked = String(q.Ecom_Payment_Card_Number || q.pan_masked || "").trim();
                const last4 = String(masked).replace(/\D/g, "").slice(-4) || null;
                if (token) {
                    try {
                        const payment = await (0, database_1.queryOne)("SELECT user_id FROM payments WHERE reference = $1", [reference]);
                        if (payment) {
                            const expMonth = q.Ecom_Payment_Card_ExpDate_Month
                                ? parseInt(String(q.Ecom_Payment_Card_ExpDate_Month), 10)
                                : null;
                            const expYear = q.Ecom_Payment_Card_ExpDate_Year
                                ? parseInt(String(q.Ecom_Payment_Card_ExpDate_Year), 10)
                                : null;
                            // 1) Already-tokenised row → refresh its token/expiry.
                            const byToken = await (0, database_1.queryOne)(`SELECT id FROM saved_cards
                 WHERE user_id = $1 AND transaction_index = $2 LIMIT 1`, [payment.user_id, token]);
                            // 2) Existing row for this same card (matched by last4) → attach token.
                            const byLast4 = !byToken && last4
                                ? await (0, database_1.queryOne)(`SELECT id, is_default FROM saved_cards
                     WHERE user_id = $1 AND last4 = $2 ORDER BY is_default DESC LIMIT 1`, [payment.user_id, last4]).catch(() => null)
                                : null;
                            if (byToken) {
                                await (0, database_1.execute)(`UPDATE saved_cards
                   SET card_number_masked = $1, exp_month = COALESCE($2, exp_month),
                       exp_year = COALESCE($3, exp_year)
                   WHERE id = $4`, [masked || null, expMonth, expYear, byToken.id]).catch(() => { });
                            }
                            else if (byLast4) {
                                await (0, database_1.execute)(`UPDATE saved_cards
                   SET transaction_index = $1, card_number_masked = $2,
                       exp_month = COALESCE($3, exp_month), exp_year = COALESCE($4, exp_year),
                       is_default = true
                   WHERE id = $5`, [token, masked || null, expMonth, expYear, byLast4.id]).catch(() => { });
                            }
                            else {
                                // 3) Brand-new card → insert as the default saved card.
                                await (0, database_1.execute)(`INSERT INTO saved_cards (user_id, card_type, last4, card_number_masked, transaction_index, exp_month, exp_year, is_default)
                   VALUES ($1, 'card', $2, $3, $4, $5, $6, true)`, [payment.user_id, last4 || "0000", masked || null, token, expMonth, expYear]).catch(() => { });
                            }
                        }
                    }
                    catch (e) { /* token storage must never break the return flow */ }
                }
            }
        }
        // iVeri POSTs the result — bounce to a readable GET for the app.
        if (req.method === "POST") {
            const qs = `?result=${success ? "success" : "failed"}${reference ? `&reference=${encodeURIComponent(reference)}` : ""}`;
            res.redirect(302, `/api/payments/return${qs}`);
            return;
        }
        res.json({ reference, result: success ? "success" : "failed", success });
    }
    catch (err) {
        console.error("Payment return error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/payments/initialize — Initialize ride payment
router.post("/initialize", auth_1.requireAuth, async (req, res) => {
    try {
        const { rideId, paymentMethod } = req.body;
        if (paymentMethod === "cash") {
            res.json({ status: "success", paymentMethod: "cash" });
        }
        else {
            res.json({ status: "success", paymentMethod: "saved_card", authorizationUrl: null });
        }
    }
    catch (err) {
        console.error("Payment init error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/payments/verify — Poll payment status by reference.
// The gateway's S2S callback (Lite_Server_Server_Url) updates the DB
// asynchronously; the mobile app polls this endpoint to learn the result.
router.get("/verify", async (req, res) => {
    try {
        const { reference } = req.query;
        if (!reference || typeof reference !== "string") {
            res.status(400).json({ status: "error", error: "Missing reference" });
            return;
        }
        const payment = await (0, database_1.queryOne)("SELECT status FROM payments WHERE reference = $1 LIMIT 1", [reference]);
        if (!payment) {
            res.json({ status: "pending", reference });
            return;
        }
        res.json({ status: payment.status, reference });
    }
    catch (err) {
        console.error("Verify payment error:", err);
        res.status(500).json({ status: "error", error: err.message });
    }
});
// POST /api/payments/refund — Mark a payment refunded (rider cancelled before pickup).
// iVeri Lite has no server-side reversal call, so this records the refund so it can
// be completed in the Nedbank portal. In mock mode it returns instantly.
router.post("/refund", auth_1.requireAuth, async (req, res) => {
    try {
        const { rideId, reference } = req.body;
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        let payment = null;
        if (reference) {
            payment = await (0, database_1.queryOne)("SELECT * FROM payments WHERE reference = $1 AND user_id = $2", [reference, user.id]).catch(() => null);
        }
        else if (rideId) {
            payment = await (0, database_1.queryOne)("SELECT * FROM payments WHERE ride_id = $1 AND user_id = $2", [rideId, user.id]).catch(() => null);
        }
        if (!payment) {
            res.json({ success: true, note: "No payment to refund" });
            return;
        }
        if (payment.status === "refunded") {
            res.json({ success: true, amount: Number(payment.amount), note: "Already refunded" });
            return;
        }
        await (0, database_1.execute)("UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1", [payment.id]);
        res.json({ success: true, amount: Number(payment.amount) });
    }
    catch (err) {
        console.error("Refund error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/payments/banks — List supported banks
router.get("/banks", auth_1.requireAuth, async (_req, res) => {
    res.json([
        { name: "ABSA Bank", code: "632005" },
        { name: "African Bank", code: "430000" },
        { name: "Bidvest Bank", code: "462005" },
        { name: "Capitec Bank", code: "470010" },
        { name: "Discovery Bank", code: "679000" },
        { name: "FNB (First National Bank)", code: "250655" },
        { name: "Investec Bank", code: "580105" },
        { name: "Nedbank", code: "198765" },
        { name: "Standard Bank", code: "051001" },
        { name: "TymeBank", code: "678910" },
    ]);
});
// POST /api/payments/banks/verify — Verify bank account
router.post("/banks/verify", auth_1.requireAuth, async (req, res) => {
    const { accountNumber } = req.body;
    const names = ["John Doe", "Jane Smith", "Sipho Mokoena", "Thandi Ndlovu"];
    const accountName = names[(accountNumber?.length || 0) % names.length];
    res.json({ accountName, verified: true });
});
// POST /api/payments/driver/banking — Save banking details
router.post("/driver/banking", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const { accountNumber, bankCode, bankName } = req.body;
        // Store in a driver_banking table (create if needed)
        try {
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
        }
        catch { /* already exists */ }
        await (0, database_1.execute)(`INSERT INTO driver_banking (driver_id, bank_account_number, bank_code, bank_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (driver_id) DO UPDATE SET
         bank_account_number = EXCLUDED.bank_account_number,
         bank_code = EXCLUDED.bank_code,
         bank_name = EXCLUDED.bank_name,
         updated_at = NOW()`, [user.id, accountNumber, bankCode, bankName]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("Save banking error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/payments/driver/earnings/pending — Get pending earnings
router.get("/driver/earnings/pending", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (!user) {
            res.json({ total_rides: 0, total_earnings: 0 });
            return;
        }
        // Aggregate from driver_earnings — sum net_amount for completed rides not yet paid out
        const earnings = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS total_rides, COALESCE(SUM(net_amount), 0)::float AS total_earnings
       FROM driver_earnings WHERE driver_id = $1`, [user.id]);
        res.json(earnings || { total_rides: 0, total_earnings: 0 });
    }
    catch (err) {
        console.error("Pending earnings error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=payments.js.map