import { Router, Response, NextFunction } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { queryOne } from "../config/database";
import {
  getOrCreateAffiliate,
  claimReferral,
  getAffiliateStats,
  listReferrals,
  listTransactions,
  useBalanceForRide,
  listPayouts,
  approvePayout,
  ensureAffiliateTables,
} from "../services/AffiliateService";

interface AffiliateRequest extends AuthRequest {
  dbUserId?: string;
}

const router = Router();

async function resolveDbUserId(
  req: AffiliateRequest,
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

function isAdmin(req: AuthRequest): boolean {
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase());
  return admins.length > 0 && !!req.user?.email && admins.includes(req.user.email.toLowerCase());
}

// POST /api/affiliates/register — create your affiliate profile (first time)
router.post(
  "/register",
  requireAuth,
  resolveDbUserId,
  async (req: AffiliateRequest, res: Response) => {
    try {
      await ensureAffiliateTables();
      const affiliate = await getOrCreateAffiliate(req.dbUserId!, req.user?.name);
      res.json({ affiliate });
    } catch (err: any) {
      console.error("Affiliate register error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/affiliates/claim — claim a referral code (after joining with a link)
router.post(
  "/claim",
  requireAuth,
  resolveDbUserId,
  async (req: AffiliateRequest, res: Response) => {
    try {
      const { code } = req.body;
      const result = await claimReferral(req.dbUserId!, code || "");
      res.json(result);
    } catch (err: any) {
      console.error("Affiliate claim error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

// GET /api/affiliates/me — dashboard summary
router.get(
  "/me",
  requireAuth,
  resolveDbUserId,
  async (req: AffiliateRequest, res: Response) => {
    try {
      const affiliate = await getAffiliateStats(req.dbUserId!);
      res.json({ affiliate });
    } catch (err: any) {
      console.error("Affiliate me error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/affiliates/me/referrals — list of invited riders
router.get(
  "/me/referrals",
  requireAuth,
  resolveDbUserId,
  async (req: AffiliateRequest, res: Response) => {
    try {
      const referrals = await listReferrals(req.dbUserId!);
      res.json({ referrals });
    } catch (err: any) {
      console.error("Affiliate referrals error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/affiliates/me/transactions — earnings ledger
router.get(
  "/me/transactions",
  requireAuth,
  resolveDbUserId,
  async (req: AffiliateRequest, res: Response) => {
    try {
      const transactions = await listTransactions(req.dbUserId!);
      res.json({ transactions });
    } catch (err: any) {
      console.error("Affiliate transactions error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/affiliates/use — Spend affiliate credit on a completed ride
router.post(
  "/use",
  requireAuth,
  resolveDbUserId,
  async (req: AffiliateRequest, res: Response) => {
    try {
      const { rideId } = req.body;
      if (!rideId) {
        res.status(400).json({ error: "rideId is required" });
        return;
      }
      const result = await useBalanceForRide(req.dbUserId!, String(rideId));
      res.json(result);
    } catch (err: any) {
      console.error("Affiliate credit use error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

// ── Admin ──
router.get("/admin/payouts", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  try {
    const payouts = await listPayouts();
    res.json({ payouts });
  } catch (err: any) {
    console.error("Admin payouts error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/admin/payouts/:id/approve",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
    try {
      const result = await approvePayout(String(req.params.id), req.userId!);
      res.json(result);
    } catch (err: any) {
      console.error("Admin approve payout error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;