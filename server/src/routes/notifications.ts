import { Response, Router } from "express";
import { execute, query, queryOne } from "../config/database";
import { AuthRequest, requireAuth } from "../middleware/auth";

const router = Router();

// POST /api/notifications/register — Register push token
router.post("/register", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { token, platform } = req.body;
    if (!token) { res.status(400).json({ error: "Push token is required" }); return; }

    await execute(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, updated_at = NOW()`,
      [req.userId, token, platform || "unknown"]
    );
    res.json({ success: true });
  } catch (err: any) {
    // Create table if needed
    if (err.code === "42P01") {
      try {
        await execute(`
          CREATE TABLE IF NOT EXISTS push_tokens (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            token VARCHAR(500) NOT NULL,
            platform VARCHAR(20),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, token)
          )
        `);
        const { token, platform } = req.body;
        await execute(
          `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform`,
          [req.userId, token, platform || "unknown"]
        );
        res.json({ success: true });
      } catch (err2: any) {
        console.error("Push token error:", err2);
        res.status(500).json({ error: err2.message });
      }
    } else {
      console.error("Push token error:", err);
      res.status(500).json({ error: err.message });
    }
  }
});

// GET /api/notifications/history — Ride-activity notifications for the user's
// in-app notification center (both riders and drivers). Sources are the user's rides.
router.get("/history", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) { res.json({ notifications: [] }); return; }
    const rows = await query<any>(
      `SELECT r.id, r.status, r.pickup_address, r.destination_address, r.estimated_fare, r.actual_fare, r.created_at,
              u.full_name AS driver_name
       FROM rides r
       LEFT JOIN users u ON u.id = r.driver_id
       WHERE r.passenger_id = $1 OR r.driver_id = $1
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [user.id]
    ).catch(() => []);
    const labels: Record<string, string> = {
      searching: "Searching for your driver",
      accepted: "Driver found",
      driver_arrived: "Driver arrived",
      in_progress: "Ride in progress",
      completed: "Ride completed",
      cancelled: "Ride cancelled",
      expired: "Ride expired",
    };
    const notifications = (rows || []).map((r: any) => ({
      id: r.id,
      type: r.status,
      title: labels[r.status] || r.status.replace(/_/g, " "),
      body: `${r.pickup_address || "Pickup"} to ${r.destination_address || "Destination"}` + (r.driver_name ? ` · ${r.driver_name}` : ""),
      rideId: r.id,
      createdAt: r.created_at,
    }));
    res.json({ notifications });
  } catch (err: any) {
    console.error("Notifications history error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/device — register/refresh a NATIVE push token (FCM).
// Called on login, on every app start and on token refresh by the Capacitor apps.
// Kept separate from /register (Expo tokens for the legacy RN app) so both builds
// can coexist: a user may have an Expo phone and an FCM phone at the same time.
router.post("/device", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) {
      res.status(404).json({ error: "User not synced yet" });
      return;
    }
    await execute(
      `INSERT INTO device_tokens (user_id, platform, push_token, is_active, last_seen_at, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW(), NOW())
       ON CONFLICT (push_token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         is_active = TRUE,
         invalidated_at = NULL,
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [user.id, platform || "android", String(token)]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error("Device token error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/device/remove — called on sign-out so the next user of
// this phone does not receive the previous user's ride notifications.
router.post("/device/remove", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    await execute(
      `UPDATE device_tokens SET is_active = FALSE, invalidated_at = NOW(), updated_at = NOW()
        WHERE push_token = $1`,
      [String(token)]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;