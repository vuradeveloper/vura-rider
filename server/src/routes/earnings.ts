import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne } from "../config/database";

const router = Router();

// GET /api/earnings — Earnings summary
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const period = (req.query.period as string) || "week";

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    let dateFilter: string;
    switch (period) {
      case "today": dateFilter = "CURRENT_DATE"; break;
      case "week": dateFilter = "DATE_TRUNC('week', CURRENT_DATE)"; break;
      case "month": dateFilter = "DATE_TRUNC('month', CURRENT_DATE)"; break;
      case "year": dateFilter = "DATE_TRUNC('year', CURRENT_DATE)"; break;
      default: dateFilter = "DATE_TRUNC('week', CURRENT_DATE)";
    }

    const totals = await queryOne(
      `SELECT COUNT(*)::int AS rides,
              COALESCE(SUM(actual_fare), 0)::float AS gross,
              COALESCE(SUM(platform_fee), 0)::float AS fee,
              COALESCE(SUM(actual_fare - COALESCE(platform_fee, 0)), 0)::float AS net
       FROM rides WHERE driver_id = $1 AND status = 'completed' AND created_at >= ${dateFilter}`,
      [user.id]
    );

    const breakdown = await query(
      `SELECT DATE(created_at) AS date,
              COUNT(*)::int AS rides,
              COALESCE(SUM(actual_fare), 0)::float AS gross,
              COALESCE(SUM(platform_fee), 0)::float AS fee,
              COALESCE(SUM(actual_fare - COALESCE(platform_fee, 0)), 0)::float AS net
       FROM rides WHERE driver_id = $1 AND status = 'completed' AND created_at >= ${dateFilter}
       GROUP BY DATE(created_at) ORDER BY date DESC`,
      [user.id]
    );

    let lastWeekNet: number | null = null;
    if (period === "week") {
      const lastWeek = await queryOne(
        `SELECT COALESCE(SUM(actual_fare - COALESCE(platform_fee, 0)), 0)::float AS net
         FROM rides WHERE driver_id = $1 AND status = 'completed'
         AND created_at >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
         AND created_at < DATE_TRUNC('week', CURRENT_DATE)`,
        [user.id]
      );
      lastWeekNet = lastWeek?.net ?? null;
    }

    res.json({
      totals: {
        ...(totals || { rides: 0, gross: 0, fee: 0, net: 0 }),
        lastWeekNet,
      },
      breakdown: breakdown || [],
    });
  } catch (err: any) {
    console.error("Earnings error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;