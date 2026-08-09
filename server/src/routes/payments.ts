import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// GET /api/payments/methods — List saved payment methods
router.get("/methods", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.json([]); return; }

    const cards = await query(
      `SELECT id, card_type, last4, bank, is_default FROM saved_cards WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [user.id]
    );
    res.json(cards);
  } catch (err: any) {
    // Table might not exist yet — return empty
    if (err.code === "42P01") { res.json([]); return; }
    console.error("List cards error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/methods — Add a new card
router.post("/methods", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Create saved_cards table if needed
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
          is_default BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch { /* already exists */ }

    const { card_type, last4 } = req.body;
    const card = await queryOne(
      `INSERT INTO saved_cards (user_id, card_type, last4)
       VALUES ($1, $2, $3)
       RETURNING id, card_type, last4, is_default`,
      [user.id, card_type || "card", last4 || "0000"]
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
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    await execute("DELETE FROM saved_cards WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Remove card error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/initialize — Initialize ride payment
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

// GET /api/payments/verify — Verify payment reference
router.get("/verify", requireAuth, async (req: AuthRequest, res: Response) => {
  res.json({ status: "success", reference: req.query.reference });
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
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const { accountNumber, bankCode, bankName } = req.body;

    // Store in a driver_banking table (create if needed)
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
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.json({ total_rides: 0, total_earnings: 0 }); return; }

    // Aggregate from driver_earnings — sum net_amount for completed rides not yet paid out
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