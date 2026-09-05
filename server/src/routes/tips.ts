import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import {
  chargeAuthorization,
  getDefaultCardToken,
} from "../services/paystackPayment";

const router = Router();

// POST /api/tips — Give a real tip to the driver.
//
// Actually charges the rider's saved card via Paystack (default card, or the
// card the rider selected with `paymentMethodId`), adds the tip to the ride's
// fare, and credits the driver's earnings so the money reaches the driver side.
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { rideId, amount, paymentMethodId } = req.body;
    const tip = Number(amount);

    if (!rideId || !tip || tip <= 0) {
      res.status(400).json({ error: "Valid rideId and amount are required" });
      return;
    }

    const user = await queryOne<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Load the ride + its driver so the tip credits the correct driver.
    const ride = await queryOne<{ id: string; driver_id: string | null; passenger_id: string }>(
      "SELECT id, driver_id, passenger_id FROM rides WHERE id = $1",
      [rideId]
    );
    if (!ride || ride.passenger_id !== user.id) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    // Pick the card: an explicitly selected payment method, else the default.
    let authCode: string | undefined;
    let cardLabel = "";
    if (paymentMethodId) {
      const card = await queryOne<{ transaction_index: string; last4: string; card_type?: string }>(
        "SELECT transaction_index, last4, card_type FROM saved_cards WHERE id = $1 AND user_id = $2",
        [paymentMethodId, user.id]
      ).catch(() => null);
      if (card?.transaction_index) {
        authCode = card.transaction_index;
        cardLabel = card.card_type || "card";
      }
    }
    if (!authCode) {
      const def = await getDefaultCardToken(user.id);
      if (def) authCode = def.transaction_index;
    }
    if (!authCode) {
      res.status(400).json({
        error:
          "No saved card available to tip with. If you paid cash, add a card first (Account → Wallet).",
      });
      return;
    }

    // Real Paystack charge.
    const reference =
      `VURATIP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    let charge;
    try {
      charge = await chargeAuthorization({
        amountRands: tip,
        reference,
        email: user.email || "rider@vura.com",
        authorizationCode: authCode,
      });
    } catch (err: any) {
      charge = { success: false, message: err?.message || "Could not process the tip payment." };
    }
    if (!charge?.success) {
      const msg = String(charge?.message || "").toLowerCase();
      res.status(400).json({
        error: msg.includes("insufficient")
          ? "Your card does not have enough funds for this tip."
          : `Tip payment was declined. ${charge?.message || ""}`.trim(),
      });
      return;
    }

    // Add the tip to the fare.
    await execute(
      "UPDATE rides SET actual_fare = GREATEST(COALESCE(actual_fare, estimated_fare, 0), 0) + $1 WHERE id = $2",
      [tip, rideId]
    );

    // Credit the driver's earnings so the money lands on the driver side.
    if (ride.driver_id) {
      try {
        await execute(
          `INSERT INTO driver_earnings (driver_id, ride_id, gross_amount, fee, net_amount)
           VALUES ($1, $2, $3, 0, $3)`,
          [ride.driver_id, rideId, tip]
        );
      } catch { /* table already has the row or optional */ }
    }

    // Record the payment so the rider has a transaction trail.
    try {
      await execute(
        `CREATE TABLE IF NOT EXISTS payments (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id UUID, ride_id UUID,
          reference VARCHAR(100), amount NUMERIC(10,2),
          currency VARCHAR(3) DEFAULT 'ZAR', status VARCHAR(20),
          provider VARCHAR(20), raw_response JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      await execute(
        `INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
         VALUES ($1, $2, $3, $4, 'ZAR', 'completed', 'paystack')`,
        [user.id, rideId, reference, tip]
      ).catch(() => {});
    } catch { /* optional */ }

    console.log(`💳 Tip of R${tip} on ride ${rideId} (${reference}) — charged to card ${cardLabel || "default"}`);
    res.json({ success: true, amount: tip, reference });
  } catch (err: any) {
    console.error("Tip error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;