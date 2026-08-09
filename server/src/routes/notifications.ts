import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { execute } from "../config/database";

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

export default router;