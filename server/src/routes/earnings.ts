import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { query } from "../config/database";
import { EarningsSummary } from "../types";

const router = Router();

router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = req.user!.dbUser;
    if (u.role !== "driver") {
      res.status(403).json({ error: "Driver-only endpoint" });
      return;
    }

    const period = (req.query.period as string) ?? "week";

    let groupBy: string;
    let dateCondition: string;

    switch (period) {
      case "today":
        groupBy = "created_at::date";
        dateCondition = "created_at::date = CURRENT_DATE";
        break;
      case "week":
        groupBy = "created_at::date";
        dateCondition = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
        break;
      case "month":
        groupBy = "date_trunc('month', created_at)::date";
        dateCondition = "created_at >= CURRENT_DATE - INTERVAL '30 days'";
        break;
      case "year":
        groupBy = "date_trunc('month', created_at)::date";
        dateCondition = "created_at >= CURRENT_DATE - INTERVAL '365 days'";
        break;
      default:
        groupBy = "created_at::date";
        dateCondition = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
    }

    const totalsRows = await query(
      `SELECT COALESCE(COUNT(*),0)::int AS rides,
              COALESCE(SUM(gross_fare),0) AS gross,
              COALESCE(SUM(service_fee),0) AS fee,
              COALESCE(SUM(ride_request_fee),0) AS request_fee,
              COALESCE(SUM(net_earnings),0) AS net
       FROM driver_earnings
       WHERE driver_id = $1 AND ${dateCondition}`,
      [u.id]
    );

    const breakdownRows = await query(
      `SELECT ${groupBy} AS date,
              COALESCE(COUNT(*),0)::int AS rides,
              COALESCE(SUM(gross_fare),0) AS gross,
              COALESCE(SUM(service_fee),0) AS fee,
              COALESCE(SUM(ride_request_fee),0) AS request_fee,
              COALESCE(SUM(net_earnings),0) AS net
       FROM driver_earnings
       WHERE driver_id = $1 AND ${dateCondition}
       GROUP BY ${groupBy}
       ORDER BY ${groupBy} DESC`,
      [u.id]
    );

    const summary: EarningsSummary = {
      totals: {
        rides: totalsRows[0]?.rides ?? 0,
        gross: parseFloat((totalsRows[0]?.gross ?? 0).toString()),
        fee: parseFloat((totalsRows[0]?.fee ?? 0).toString()),
        request_fee: parseFloat((totalsRows[0]?.request_fee ?? 0).toString()),
        net: parseFloat((totalsRows[0]?.net ?? 0).toString()),
      },
      breakdown: breakdownRows.map((r: any) => ({
        date: r.date,
        rides: r.rides,
        gross: parseFloat((r.gross ?? 0).toString()),
        fee: parseFloat((r.fee ?? 0).toString()),
        request_fee: parseFloat((r.request_fee ?? 0).toString()),
        net: parseFloat((r.net ?? 0).toString()),
      })),
    };

    res.json(summary);
  } catch (err: any) {
    console.error("GET /api/earnings error:", err.message);
    res.status(500).json({ error: "Failed to get earnings" });
  }
});

export default router;
