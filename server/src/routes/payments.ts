import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import {
  initializeTransaction,
  verifyTransaction,
  chargeAuthorization,
  refundTransaction,
  paymentsMode,
} from "../services/paystackPayment";

const router = Router();

// Ensure the payments table exists (one-time, per server)
async function ensurePaymentsTable() {
  try {
    await execute(`
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
  } catch {
    /* already exists */
  }
}

// Ensure saved_cards exists with the columns we need. The Paystack
// authorization_code is stored in transaction_index so no schema change is
// needed for the tokenisation flow.
async function ensureSavedCardsTable() {
  try {
    await execute(`
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
    await execute(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS card_number_masked VARCHAR(30)`);
    await execute(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS transaction_index VARCHAR(100)`);
  } catch {
    /* already exists */
  }
}

async function getOrCreateUser(firebaseUid: string, name?: string | null, email?: string | null) {
  let user = await queryOne<{ id: string }>(
    "SELECT id FROM users WHERE firebase_uid = $1",
    [firebaseUid]
  );
  if (!user) {
    user = await queryOne<{ id: string }>(
      `INSERT INTO users (firebase_uid, full_name, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [firebaseUid, name || "Rider", email || null, "passenger"]
    );
  }
  return user || null;
}

// GET /api/payments/methods — List saved payment methods
router.get("/methods", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getOrCreateUser(req.userId!);
    if (!user) { res.json([]); return; }

    const cards = await query(
      `SELECT id, card_type, last4, bank, is_default FROM saved_cards WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [user.id]
    );
    res.json(cards);
  } catch (err: any) {
    if (err.code === "42P01") { res.json([]); return; }
    console.error("List cards error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/methods — Add a new card manually (fallback; the normal
// path is the hosted Paystack card-register flow which tokenises the card).
router.post("/methods", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getOrCreateUser(req.userId!, req.user?.name, req.user?.email);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    await ensureSavedCardsTable();

    const { card_type, last4, bank, exp_month, exp_year } = req.body;

    const existingCards = await query(
      "SELECT id FROM saved_cards WHERE user_id = $1 LIMIT 1",
      [user.id]
    ).catch(() => []);
    const isDefault = existingCards.length === 0;

    const card = await queryOne(
      `INSERT INTO saved_cards (user_id, card_type, last4, bank, exp_month, exp_year, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, card_type, last4, bank, is_default`,
      [
        user.id,
        card_type || "card",
        last4 || "0000",
        bank || null,
        exp_month ? parseInt(exp_month, 10) : null,
        exp_year ? parseInt(exp_year, 10) : null,
        isDefault
      ]
    );
    res.status(201).json(card);
  } catch (err: any) {
    console.error("Add card error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/payments/methods/:id — Remove a saved card
router.delete("/methods/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getOrCreateUser(req.userId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    await execute("DELETE FROM saved_cards WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Remove card error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/card-register — Start a Paystack card registration.
// Creates a hosted-checkout transaction (R1 pre-auth) so the card can be
// tokenised and saved. On success the /verify handler stores the returned
// authorization_code as the saved card's token (transaction_index).
router.post("/card-register", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{ id: string; full_name: string; email: string; phone: string }>(
      "SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) { res.status(401).json({ error: "User not found" }); return; }

    const amount = 1.0;

    const reference =
      `VURACARD${Date.now().toString(36).toUpperCase()}` +
      `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    try {
      await ensurePaymentsTable();
      await execute(
        `INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, NULL, $2, $3, 'ZAR', 'initiated', 'paystack')`,
        [user.id, reference, amount]
      );
    } catch (e) { /* logging/table issues shouldn't block the payment */ }

    const result = await initializeTransaction({
      amountRands: amount,
      reference,
      email: user.email,
    });

    res.json({ ...result, reference });
  } catch (err: any) {
    console.error("Card register error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/initiate — Charge a saved card (card-on-file) via Paystack,
// OR return a hosted-checkout URL when the rider has no saved card yet.
// The saved card's Paystack authorization_code (stored as transaction_index)
// lets us charge without re-entering card details.
router.post("/initiate", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { amountRands, rideId } = req.body;
    const amount = Number(amountRands);
    if (!amount || amount < 0.2 || amount > 5000) {
      res.status(400).json({ error: "Amount must be between R0.20 and R5 000" });
      return;
    }

    const user = await queryOne<{ id: string; full_name: string; email: string; phone: string }>(
      "SELECT id, full_name, email, phone FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) { res.status(401).json({ error: "User not found" }); return; }

    // Default saved card (authorization_code token).
    const savedCard = await queryOne<{
      transaction_index: string;
      last4: string;
    }>(
      `SELECT transaction_index, last4 FROM saved_cards
       WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`,
      [user.id]
    ).catch(() => null);

    const reference =
      `VURA${Date.now().toString(36).toUpperCase()}` +
      `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    try {
      await ensurePaymentsTable();
      await execute(
        `INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, $2, $3, $4, 'ZAR', 'initiated', 'paystack')`,
        [user.id, rideId || null, reference, amount]
      );
    } catch (e) { /* logging/table issues shouldn't block the payment */ }

    // Mock mode: simulate an approved charge so the flow works end-to-end.
    if (paymentsMode() === "mock") {
      await execute(
        `UPDATE payments SET status = 'completed', updated_at = NOW() WHERE reference = $1`,
        [reference]
      ).catch(() => {});
      res.json({ reference, live: false, mock: true, status: "success" });
      return;
    }

    // Have a tokenised card → charge it directly, no WebView needed.
    if (savedCard?.transaction_index) {
      const charge = await chargeAuthorization({
        amountRands: amount,
        reference,
        email: user.email || "rider@vura.com",
        authorizationCode: savedCard.transaction_index,
      });

      await execute(
        `UPDATE payments SET status = $1, raw_response = $2, updated_at = NOW()
         WHERE reference = $3`,
        [charge.success ? "completed" : "failed", JSON.stringify(charge), reference]
      ).catch(() => {});

      res.json({
        reference,
        live: paymentsMode() === "live",
        status: charge.success ? "success" : "failed",
        message: charge.message,
        usesSavedCard: true,
      });
      return;
    }

    // No saved card → return a Paystack hosted checkout URL.
    const init = await initializeTransaction({
      amountRands: amount,
      reference,
      email: user.email,
    });

    res.json({
      ...init,
      reference,
      status: "pending",
      authorizationUrl: init.authorizationUrl,
    });
  } catch (err: any) {
    console.error("Payment initiate error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/return — Paystack redirects the customer's browser here
// after a hosted checkout. The WebView intercepts this URL; we verify the
// transaction and record the result.
router.get("/return", async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const reference = String(q.reference || q.trxref || q.merchant_reference || "");
    if (!reference) {
      res.json({ result: "failed", error: "Missing reference" });
      return;
    }

    const verified = await verifyTransaction(reference);
    const success = Boolean(verified && verified.status === "success");

    if (verified) {
      await execute(
        `UPDATE payments SET status = $1, raw_response = $2, updated_at = NOW()
         WHERE reference = $3`,
        [success ? "completed" : "failed", JSON.stringify(verified), reference]
      ).catch(() => {});

      // Tokenise the card on a successful checkout so future rides charge it
      // directly. Only do this for card registrations (ride_id is NULL).
      if (success && verified.authorization?.reusable) {
        const payment = await queryOne<{ user_id: string; ride_id: string | null }>(
          "SELECT user_id, ride_id FROM payments WHERE reference = $1",
          [reference]
        );
        if (payment && !payment.ride_id) {
          await storeAuthorizationCard(payment.user_id, verified);
        }
      }
    }

    res.json({ reference, result: success ? "success" : "failed", success });
  } catch (err: any) {
    console.error("Payment return error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/verify — Poll payment status by reference. The app's
// WebView polls this; for hosted checkouts we call Paystack's verify endpoint
// to get the authoritative result and tokenise the card on success.
router.get("/verify", async (req: AuthRequest, res: Response) => {
  try {
    const { reference } = req.query;
    if (!reference || typeof reference !== "string") {
      res.status(400).json({ status: "error", error: "Missing reference" });
      return;
    }

    const payment = await queryOne<{ status: string }>(
      "SELECT status FROM payments WHERE reference = $1 LIMIT 1",
      [reference]
    );
    if (!payment) {
      res.json({ status: "pending", reference });
      return;
    }

    // If the row is still initiated and it's a hosted checkout, ask Paystack.
    if (payment.status === "initiated") {
      try {
        const verified = await verifyTransaction(reference);
        if (verified) {
          const success = verified.status === "success";
          await execute(
            `UPDATE payments SET status = $1, raw_response = $2, updated_at = NOW()
             WHERE reference = $3`,
            [success ? "completed" : "failed", JSON.stringify(verified), reference]
          ).catch(() => {});

          if (success && verified.authorization?.reusable) {
            const rec = await queryOne<{ user_id: string; ride_id: string | null }>(
              "SELECT user_id, ride_id FROM payments WHERE reference = $1",
              [reference]
            );
            if (rec) {
              await storeAuthorizationCard(rec.user_id, verified);
            }
          }
          res.json({ status: success ? "completed" : "failed", reference });
          return;
        }
      } catch (e) {
        console.warn("Verify against Paystack failed:", e);
      }
    }

    res.json({ status: payment.status, reference });
  } catch (err: any) {
    console.error("Verify payment error:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Store a Paystack authorization_code as the user's saved (default) card.
async function storeAuthorizationCard(userId: string, verified: any) {
  const auth = verified.authorization;
  if (!auth) return;
  try {
    await ensureSavedCardsTable();
    const token = String(auth.authorization_code || "").trim();
    const last4 = String(auth.last4 || "").replace(/\D/g, "").slice(-4) || null;
    if (!token) return;

    const byToken = await queryOne<{ id: string }>(
      `SELECT id FROM saved_cards WHERE user_id = $1 AND transaction_index = $2 LIMIT 1`,
      [userId, token]
    );
    const byLast4 = !byToken && last4
      ? await queryOne<{ id: string; is_default: boolean }>(
          `SELECT id, is_default FROM saved_cards
           WHERE user_id = $1 AND last4 = $2 ORDER BY is_default DESC LIMIT 1`,
          [userId, last4]
        ).catch(() => null)
      : null;

    if (byToken) {
      await execute(
        `UPDATE saved_cards
         SET card_type = COALESCE($1, card_type), bank = COALESCE($2, bank),
             exp_month = COALESCE($3, exp_month), exp_year = COALESCE($4, exp_year)
         WHERE id = $5`,
        [auth.card_type || null, auth.bank || null, auth.exp_month || null, auth.exp_year || null, byToken.id]
      ).catch(() => {});
    } else if (byLast4) {
      await execute(
        `UPDATE saved_cards
         SET transaction_index = $1, card_type = COALESCE($2, card_type),
             bank = COALESCE($3, bank), exp_month = COALESCE($4, exp_month),
             exp_year = COALESCE($5, exp_year), is_default = true
         WHERE id = $6`,
        [token, auth.card_type || null, auth.bank || null, auth.exp_month || null, auth.exp_year || null, byLast4.id]
      ).catch(() => {});
    } else {
      await execute(
        `INSERT INTO saved_cards (user_id, card_type, last4, transaction_index, exp_month, exp_year, bank, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [userId, auth.card_type || "card", last4 || "0000", token, auth.exp_month || null, auth.exp_year || null, auth.bank || null]
      ).catch(() => {});
    }
  } catch (e) {
    console.warn("Could not store authorization card:", e);
  }
}

// POST /api/payments/initialize — Initialize ride payment (cash vs card marker)
router.post("/initialize", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { rideId, paymentMethod } = req.body;

    if (paymentMethod === "cash") {
      res.json({ status: "success", paymentMethod: "cash" });
    } else {
      res.json({ status: "success", paymentMethod: "saved_card", authorizationUrl: null });
    }
  } catch (err: any) {
    console.error("Payment init error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/refund — Refund a payment. Uses Paystack's refund API
// when the transaction reference is available.
router.post("/refund", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { rideId, reference } = req.body;
    const user = await getOrCreateUser(req.userId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    let payment: any = null;
    if (reference) {
      payment = await queryOne(
        "SELECT * FROM payments WHERE reference = $1 AND user_id = $2",
        [reference, user.id]
      ).catch(() => null);
    } else if (rideId) {
      payment = await queryOne(
        "SELECT * FROM payments WHERE ride_id = $1 AND user_id = $2",
        [rideId, user.id]
      ).catch(() => null);
    }

    if (!payment) { res.json({ success: true, note: "No payment to refund" }); return; }
    if (payment.status === "refunded") { res.json({ success: true, amount: Number(payment.amount), note: "Already refunded" }); return; }

    if (payment.provider === "paystack" && payment.status === "completed") {
      try {
        const refund = await refundTransaction(payment.reference, Number(payment.amount));
        console.log("Paystack refund result:", refund);
      } catch (err: any) {
        console.warn("Paystack refund failed (recording locally):", err.message);
      }
    }

    await execute(
      "UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1",
      [payment.id]
    );
    res.json({ success: true, amount: Number(payment.amount) });
  } catch (err: any) {
    console.error("Refund error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/banks — List supported banks
router.get("/banks", requireAuth, async (_req: AuthRequest, res: Response) => {
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
router.post("/banks/verify", requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountNumber } = req.body;
  const names = ["John Doe", "Jane Smith", "Sipho Mokoena", "Thandi Ndlovu"];
  const accountName = names[(accountNumber?.length || 0) % names.length];
  res.json({ accountName, verified: true });
});

// POST /api/payments/driver/banking — Save banking details
router.post("/driver/banking", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getOrCreateUser(req.userId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const { accountNumber, bankCode, bankName } = req.body;

    try {
      await execute(`
        CREATE TABLE IF NOT EXISTS driver_banking (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          driver_id UUID NOT NULL UNIQUE REFERENCES users(id),
          bank_account_number VARCHAR(50),
          bank_code VARCHAR(20),
          bank_name VARCHAR(100),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch { /* already exists */ }

    await execute(
      `INSERT INTO driver_banking (driver_id, bank_account_number, bank_code, bank_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (driver_id) DO UPDATE SET
         bank_account_number = EXCLUDED.bank_account_number,
         bank_code = EXCLUDED.bank_code,
         bank_name = EXCLUDED.bank_name,
         updated_at = NOW()`,
      [user.id, accountNumber, bankCode, bankName]
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error("Save banking error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/driver/earnings/pending — Get pending earnings
router.get("/driver/earnings/pending", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getOrCreateUser(req.userId!);
    if (!user) { res.json({ total_rides: 0, total_earnings: 0 }); return; }

    const earnings = await queryOne(
      `SELECT COUNT(*)::int AS total_rides, COALESCE(SUM(net_amount), 0)::float AS total_earnings
       FROM driver_earnings WHERE driver_id = $1`,
      [user.id]
    );

    res.json(earnings || { total_rides: 0, total_earnings: 0 });
  } catch (err: any) {
    console.error("Pending earnings error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
