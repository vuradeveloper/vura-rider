import { Router, Response, NextFunction } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { queryOne } from "../config/database";
import { paymentsMode } from "../services/paystackPayment";
import {
  enrollPayLater,
  getPayLaterStatus,
  getPayLaterEligibility,
  acceptPayLaterTerms,
  takePayLaterRide,
  repayWithCard,
  setPayLaterAutoDebit,
  refreshPayLaterLimit,
  payRideWithPayLater,
  runMonthlyCollection,
  simulatePayLaterRide,
} from "../services/PayLaterService";

const router = Router();

interface PayLaterRequest extends AuthRequest {
  dbUserId?: string;
}

async function resolveDbUserId(
  req: PayLaterRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) {
      res.status(404).json({ error: "User not synced yet" });
      return;
    }
    req.dbUserId = user.id;
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/payments/pay-later/status — enrollment + account + open rides
router.get(
  "/status",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      const status = await getPayLaterStatus(req.dbUserId!);
      res.json(status);
    } catch (err: any) {
      console.error("Pay Later status error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/enroll — mandate + card validation + account
router.post(
  "/enroll",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      // Card-first enrollment (v1 upgrade): ONE saved card is the repayment
      // rail — bank fields are now OPTIONAL (kept for the old screen's shape).
      // The service derives the card from the rider's saved_cards when absent.
      const { accountHolder, bankCode, accountNumber, cardToken, identityFingerprint, deviceId } = req.body;
      const result = await enrollPayLater(req.dbUserId!, {
        accountHolder,
        bankCode,
        accountNumber,
        cardToken,
        identityFingerprint,
        deviceId,
      });
      res.status(201).json(result);
    } catch (err: any) {
      console.error("Pay Later enroll error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/refresh — recompute limit from loyalty
router.post(
  "/refresh",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      const result = await refreshPayLaterLimit(req.dbUserId!);
      res.json(result);
    } catch (err: any) {
      console.error("Pay Later refresh error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/:rideId/pay — manual/early repayment
router.post(
  "/:rideId/pay",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      const result = await payRideWithPayLater(req.dbUserId!, String(req.params.rideId));
      res.json(result);
    } catch (err: any) {
      console.error("Pay Later manual pay error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Dev/test helpers (never reachable in live payment mode) ──

// POST /api/payments/pay-later/collect — manually trigger the month-end job
router.post(
  "/collect",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    if (paymentsMode() === "live") {
      res.status(403).json({ error: "Disabled in live mode" });
      return;
    }
    try {
      const summary = await runMonthlyCollection();
      res.json({ success: true, summary });
    } catch (err: any) {
      console.error("Pay Later collect error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/dev/simulate — mark a completed ride as a
// pay-later ride (mock only) so the full loop can be exercised end-to-end.
router.post(
  "/dev/simulate",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    if (paymentsMode() === "live") {
      res.status(403).json({ error: "Disabled in live mode" });
      return;
    }
    try {
      const { rideId } = req.body;
      if (!rideId) {
        res.status(400).json({ error: "rideId is required" });
        return;
      }
      const result = await simulatePayLaterRide(req.dbUserId!, String(rideId));
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("Pay Later simulate error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Ride Now, Pay Later (v1 upgrade endpoints) ────────────────────────────────

// GET /api/payments/pay-later/eligibility — works for locked AND enrolled
// riders: unlock progress ("3 of 5"), balance/limit/available, due date,
// auto-debit state, ride-to-repay progress. Powers both progress bars.
router.get(
  "/eligibility",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      res.json(await getPayLaterEligibility(req.dbUserId!));
    } catch (err: any) {
      console.error("Pay Later eligibility error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/accept-terms — records the rider's explicit
// acceptance (the booking guard refuses pay-later rides without it).
router.post(
  "/accept-terms",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      res.json(await acceptPayLaterTerms(req.dbUserId!));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/take — preflight before booking a pay-later
// ride: active → terms → not past due → fare fits available credit. The
// socket booking guard re-checks all of it server-side.
router.post(
  "/take",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      const fare = Number(req.body?.estimatedFare ?? req.body?.fare ?? 0);
      res.json(await takePayLaterRide(req.dbUserId!, fare));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/repay — "Pay what I owe": charges the saved
// card (Paystack); the LEDGER only moves when the charge.success webhook
// confirms → response is either confirmed (mock) or pending (sandbox/live).
router.post(
  "/repay",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      const result = await repayWithCard(req.dbUserId!, {
        amountRands: req.body?.amountRands,
        rideId: req.body?.rideId || null,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/payments/pay-later/auto-debit — opt-in consent + on/off switch
// (requires a saved card and accepted terms to enable).
router.post(
  "/auto-debit",
  requireAuth,
  resolveDbUserId,
  async (req: PayLaterRequest, res: Response) => {
    try {
      const enabled = !!req.body?.enabled;
      res.json(await setPayLaterAutoDebit(req.dbUserId!, enabled));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

export default router;
