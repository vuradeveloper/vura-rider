import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

function isAdmin(req: AuthRequest): boolean {
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return (
    admins.length > 0 &&
    !!req.user?.email &&
    admins.includes(req.user.email.toLowerCase())
  );
}

// Ensure the fare config table exists (config singleton keyed by "current").
async function ensureFareConfigTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS fare_config (
      id SERIAL PRIMARY KEY,
      key VARCHAR(40) NOT NULL UNIQUE DEFAULT 'current',
      base_fare NUMERIC(10,2) NOT NULL DEFAULT 15.00,
      per_km NUMERIC(10,2) NOT NULL DEFAULT 9.00,
      per_minute NUMERIC(10,2) NOT NULL DEFAULT 1.50,
      booking_fee NUMERIC(10,2) NOT NULL DEFAULT 5.00,
      platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
      min_fare NUMERIC(10,2) NOT NULL DEFAULT 20.00,
      currency VARCHAR(8) NOT NULL DEFAULT 'ZAR',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// GET /api/admin/fare — current fare config (admin only)
router.get("/fare", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  try {
    await ensureFareConfigTable();
    const row = await queryOne<any>(
      "SELECT base_fare, per_km, per_minute, booking_fee, platform_fee_percent, min_fare, currency, updated_at FROM fare_config WHERE key = 'current' ORDER BY id DESC LIMIT 1"
    );
    if (!row) {
      res.json({
        base_fare: 15.00, per_km: 9.00, per_minute: 1.50,
        booking_fee: 5.00, platform_fee_percent: 10.00,
        min_fare: 20.00, currency: "ZAR",
      });
      return;
    }
    res.json({
      base_fare: parseFloat(row.base_fare),
      per_km: parseFloat(row.per_km),
      per_minute: parseFloat(row.per_minute),
      booking_fee: parseFloat(row.booking_fee),
      platform_fee_percent: parseFloat(row.platform_fee_percent),
      min_fare: parseFloat(row.min_fare),
      currency: row.currency,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/fare — update fare config (admin only)
router.put("/fare", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  try {
    await ensureFareConfigTable();
    const {
      base_fare, per_km, per_minute, booking_fee, platform_fee_percent, min_fare, currency,
    } = req.body || {};
    const row = await queryOne<any>(
      `INSERT INTO fare_config (key, base_fare, per_km, per_minute, booking_fee, platform_fee_percent, min_fare, currency)
       VALUES ('current', $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET
         base_fare = EXCLUDED.base_fare,
         per_km = EXCLUDED.per_km,
         per_minute = EXCLUDED.per_minute,
         booking_fee = EXCLUDED.booking_fee,
         platform_fee_percent = EXCLUDED.platform_fee_percent,
         min_fare = EXCLUDED.min_fare,
         currency = EXCLUDED.currency,
         updated_at = NOW()
       RETURNING base_fare, per_km, per_minute, booking_fee, platform_fee_percent, min_fare, currency, updated_at`,
      [
        base_fare ?? 15.00, per_km ?? 9.00, per_minute ?? 1.50,
        booking_fee ?? 5.00, platform_fee_percent ?? 10.00,
        min_fare ?? 20.00, currency ?? "ZAR",
      ]
    );
    if (!row) { res.status(500).json({ error: "Could not save config" }); return; }
    res.json({
      base_fare: parseFloat(row.base_fare),
      per_km: parseFloat(row.per_km),
      per_minute: parseFloat(row.per_minute),
      booking_fee: parseFloat(row.booking_fee),
      platform_fee_percent: parseFloat(row.platform_fee_percent),
      min_fare: parseFloat(row.min_fare),
      currency: row.currency,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/analytics — daily ride/revenue/driver stats (admin only)
router.get("/analytics", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  try {
    const ridesPerDay = await query(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS rides,
              COALESCE(SUM(actual_fare), 0) AS revenue
       FROM rides
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day`
    );
    const totals = await queryOne<any>(
      `SELECT COUNT(*)::int AS total_rides,
              COALESCE(SUM(actual_fare),0) AS total_revenue,
              COUNT(DISTINCT passenger_id) AS riders,
              COUNT(DISTINCT driver_id) AS drivers
       FROM rides`
    );
    res.json({
      ridesPerDay,
      totals: {
        totalRides: totals?.total_rides || 0,
        totalRevenue: parseFloat(totals?.total_revenue || 0),
        riders: totals?.riders || 0,
        drivers: totals?.drivers || 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;