import { Router, Request, Response } from "express";
import crypto from "crypto";
import { authMiddleware } from "../middleware/auth";
import { query, queryOne } from "../config/database";
import {
  initializePayment,
  verifyPayment,
  chargeCard,
  createDriverSubaccount,
  getSupportedBanks,
  verifyBankAccount,
  createTransferRecipient,
} from "../services/paystackService";
import {
  asTrimmedString,
  isAccountNumber,
  isBankCode,
  isUuid,
} from "../utils/validation";

const router = Router();

function signaturesMatch(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

// ── RIDER: Initialize payment ──────────────────────────────────────────────
router.post(
  "/initialize",
  authMiddleware,
  async (req: Request, res: Response) => {
    const rideId = asTrimmedString(req.body?.rideId);
    const requestedPaymentMethod = asTrimmedString(req.body?.paymentMethod);
    const paymentMethod = requestedPaymentMethod ?? "card";
    const userId = req.user!.dbUser.id;
    const email = req.user!.dbUser.email;

    if (!isUuid(rideId)) {
      res.status(400).json({ error: "rideId must be a valid UUID" });
      return;
    }

    if (!["card", "cash"].includes(paymentMethod)) {
      res.status(400).json({ error: "paymentMethod must be 'card' or 'cash'" });
      return;
    }

    if (paymentMethod === "card" && !email) {
      res.status(400).json({ error: "An email address is required for card payments" });
      return;
    }

    try {
      const rideResult = await query(
        "SELECT * FROM rides WHERE id = $1 AND passenger_id = $2",
        [rideId, userId]
      );
      if (!rideResult.length) {
        res.status(404).json({ error: "Ride not found" });
        return;
      }

      const ride = rideResult[0];
      const fare = parseFloat(ride.fare);
      const rideRequestFee = Math.round(fare * 0.04 * 100) / 100;
      const riderTotal = Math.round((fare + rideRequestFee) * 100) / 100;

      if (paymentMethod === "cash") {
        await query(
          `UPDATE rides SET payment_status = 'pending_cash', payment_method = 'cash', ride_request_fee = $1 WHERE id = $2`,
          [rideRequestFee, rideId]
        );
        res.json({ paymentMethod: "cash", message: "Pay driver in cash" });
        return;
      }

      const savedCard = await queryOne(
        "SELECT * FROM payment_methods WHERE user_id = $1 AND is_default = true LIMIT 1",
        [userId]
      );

      if (savedCard) {
        const charge = await chargeCard({
          authorizationCode: savedCard.authorization_code,
          email: email!,
          amountRands: riderTotal,
          rideId,
        });

        if (charge.status === "success") {
          await query(
            `UPDATE rides SET payment_method = 'card', payment_status = 'paid',
             payment_reference = $1, ride_request_fee = $2 WHERE id = $3`,
            [charge.reference, rideRequestFee, rideId]
          );
          res.json({ status: "success", message: "Payment successful" });
          return;
        }
      }

      const payment = await initializePayment({
        email: email!,
        amountRands: riderTotal,
        rideId,
        userId,
      });

      await query(
        `INSERT INTO payments (ride_id, user_id, amount, reference, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [rideId, userId, riderTotal, payment.reference]
      );

      res.json({
        authorizationUrl: payment.authorization_url,
        reference: payment.reference,
        accessCode: payment.access_code,
      });
    } catch (err: any) {
      console.error("POST /api/payments/initialize error:", err.message);
      res.status(500).json({ error: "Failed to initialize payment" });
    }
  }
);

// ── RIDER: Verify payment ──────────────────────────────────────────────────
router.get("/verify", async (req: Request, res: Response) => {
  const reference = asTrimmedString(req.query.reference, { maxLength: 100 });
  if (!reference) {
    res.status(400).json({ error: "reference is required" });
    return;
  }
  try {
    const payment = await verifyPayment(reference as string);
    if (payment.status !== "success") {
      res.status(400).json({ error: "Payment not successful" });
      return;
    }

    const { rideId, userId } = payment.metadata;

    await query(
      `UPDATE rides SET payment_status = 'paid', payment_reference = $1, payment_method = 'card'
       WHERE id = $2`,
      [reference, rideId]
    );

    await query(
      `UPDATE payments SET status = 'success', paid_at = NOW() WHERE reference = $1`,
      [reference]
    );

    if (payment.authorization?.reusable) {
      await query(
        `INSERT INTO payment_methods (user_id, authorization_code, card_type, last4, bank, is_default)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (user_id, last4) DO UPDATE SET authorization_code = EXCLUDED.authorization_code`,
        [
          userId,
          payment.authorization.authorization_code,
          payment.authorization.card_type,
          payment.authorization.last4,
          payment.authorization.bank,
        ]
      );
    }

    res.json({ status: "success", message: "Payment verified" });
  } catch (err: any) {
    console.error("GET /api/payments/verify error:", err.message);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

// ── RIDER: Get saved cards ─────────────────────────────────────────────────
router.get(
  "/methods",
  authMiddleware,
  async (req: Request, res: Response) => {
    const result = await query(
      "SELECT id, card_type, last4, bank, is_default FROM payment_methods WHERE user_id = $1",
      [req.user!.dbUser.id]
    );
    res.json(result);
  }
);

// ── RIDER: Remove saved card ───────────────────────────────────────────────
router.delete(
  "/methods/:id",
  authMiddleware,
  async (req: Request, res: Response) => {
    if (!isUuid(req.params.id)) {
      res.status(400).json({ error: "id must be a valid UUID" });
      return;
    }

    await query("DELETE FROM payment_methods WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.user!.dbUser.id,
    ]);
    res.json({ message: "Card removed" });
  }
);

// ── DRIVER: Get supported banks ────────────────────────────────────────────
router.get("/banks", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const banks = await getSupportedBanks();
    res.json(banks);
  } catch (err: any) {
    console.error("GET /api/payments/banks error:", err.message);
    res.status(500).json({ error: "Failed to get banks" });
  }
});

// ── DRIVER: Verify bank account ────────────────────────────────────────────
router.post(
  "/banks/verify",
  authMiddleware,
  async (req: Request, res: Response) => {
    if (req.user!.dbUser.role !== "driver") {
      res.status(403).json({ error: "Driver-only endpoint" });
      return;
    }

    const accountNumber = asTrimmedString(req.body?.accountNumber, { maxLength: 20 });
    const bankCode = asTrimmedString(req.body?.bankCode, { maxLength: 20 });

    if (
      !accountNumber ||
      !bankCode ||
      !isAccountNumber(accountNumber) ||
      !isBankCode(bankCode)
    ) {
      res.status(400).json({ error: "Valid accountNumber and bankCode are required" });
      return;
    }

    try {
      const result = await verifyBankAccount(accountNumber, bankCode);
      res.json({
        accountName: result.account_name,
        accountNumber: result.account_number,
      });
    } catch (err: any) {
      res
        .status(400)
        .json({ error: "Could not verify account. Check details and try again." });
    }
  }
);

// ── DRIVER: Save banking details ───────────────────────────────────────────
router.post(
  "/driver/banking",
  authMiddleware,
  async (req: Request, res: Response) => {
    if (req.user!.dbUser.role !== "driver") {
      res.status(403).json({ error: "Driver-only endpoint" });
      return;
    }

    const accountNumber = asTrimmedString(req.body?.accountNumber, { maxLength: 20 });
    const bankCode = asTrimmedString(req.body?.bankCode, { maxLength: 20 });
    const bankName = asTrimmedString(req.body?.bankName, { maxLength: 100 });

    if (
      !accountNumber ||
      !bankCode ||
      !bankName ||
      !isAccountNumber(accountNumber) ||
      !isBankCode(bankCode)
    ) {
      res.status(400).json({ error: "Valid accountNumber, bankCode, and bankName are required" });
      return;
    }

    const driver = req.user!.dbUser;

    try {
      const recipient = await createTransferRecipient({
        driverName: driver.full_name ?? "Driver",
        accountNumber,
        bankCode,
      });

      const subaccount = await createDriverSubaccount({
        driverName: driver.full_name ?? "Driver",
        bankCode,
        accountNumber,
        email: driver.email!,
      });

      await query(
        `UPDATE driver_profiles SET
           bank_account_number = $1, bank_code = $2, bank_name = $3,
           paystack_recipient = $4, paystack_subaccount = $5, banking_verified = true
         WHERE user_id = $6`,
        [
          accountNumber,
          bankCode,
          bankName,
          recipient.recipient_code,
          subaccount.subaccount_code,
          driver.id,
        ]
      );

      res.json({ message: "Banking details saved successfully" });
    } catch (err: any) {
      console.error("POST /api/payments/driver/banking error:", err.message);
      res.status(500).json({ error: "Failed to save banking details" });
    }
  }
);

// ── DRIVER: Get pending earnings ───────────────────────────────────────────
router.get(
  "/driver/earnings/pending",
  authMiddleware,
  async (req: Request, res: Response) => {
    if (req.user!.dbUser.role !== "driver") {
      res.status(403).json({ error: "Driver-only endpoint" });
      return;
    }

    const result = await query(
      `SELECT COUNT(*) AS total_rides, COALESCE(SUM(net_earnings), 0) AS total_earnings
       FROM driver_earnings
       WHERE driver_id = $1 AND payout_status = 'pending'`,
      [req.user!.dbUser.id]
    );
    res.json(result[0]);
  }
);

// ── WEBHOOK: Paystack events ───────────────────────────────────────────────
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      console.error("Paystack webhook received without PAYSTACK_SECRET_KEY configured");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    if (!Buffer.isBuffer(req.body)) {
      res.status(400).send("Expected raw request body");
      return;
    }

    const signature = asTrimmedString(req.headers["x-paystack-signature"]);
    if (!signature) {
      res.status(401).send("Invalid signature");
      return;
    }

    const hash = crypto
      .createHmac("sha512", secret)
      .update(req.body)
      .digest("hex");

    if (!signaturesMatch(hash, signature)) {
      res.status(401).send("Invalid signature");
      return;
    }

    const event = JSON.parse(req.body.toString("utf8"));

    if (event.event === "charge.success") {
      const reference = asTrimmedString(event.data?.reference, { maxLength: 100 });
      const rideId = asTrimmedString(event.data?.metadata?.rideId);

      if (reference && isUuid(rideId)) {
        await query(
          `UPDATE rides
           SET payment_status = 'paid', payment_reference = $1, payment_method = 'card'
           WHERE id = $2`,
          [reference, rideId]
        );

        await query(
          `UPDATE payments SET status = 'success', paid_at = NOW() WHERE reference = $1`,
          [reference]
        );
      }
    }

    if (event.event === "transfer.success") {
      const reference = asTrimmedString(event.data?.reference, { maxLength: 100 });
      if (reference) {
        await query(
          `UPDATE driver_payouts SET status = 'paid', paid_at = NOW() WHERE reference = $1`,
          [reference]
        );
      }
    }

    if (event.event === "transfer.failed") {
      const reference = asTrimmedString(event.data?.reference, { maxLength: 100 });
      const reason =
        asTrimmedString(event.data?.failures?.[0]?.reason, { maxLength: 500 }) ??
        "Transfer failed";

      if (reference) {
        await query(
          `UPDATE driver_payouts SET status = 'failed', failure_reason = $1 WHERE reference = $2`,
          [reason, reference]
        );
      }
    }

    res.sendStatus(200);
  } catch (err: any) {
    console.error("POST /api/payments/webhook error:", err.message);
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

export default router;
