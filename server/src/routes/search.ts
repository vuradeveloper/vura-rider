import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// Ensure table exists
async function ensureTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS recent_searches (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      name VARCHAR(255) NOT NULL,
      address TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// GET /api/searches — Get recent searches
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTable();
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.json({ searches: [] }); return; }

    const searches = await query(
      "SELECT id, name, address AS addr, lat, lng, created_at FROM recent_searches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
      [user.id]
    );
    res.json({ searches });
  } catch (err: any) {
    console.error("Get searches error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches — Save a search
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTable();
    const firebaseUid = req.userId!;
    const { name, address, lat, lng } = req.body;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    await execute(
      `INSERT INTO recent_searches (user_id, name, address, lat, lng) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, name) DO UPDATE SET address = EXCLUDED.address, lat = EXCLUDED.lat, lng = EXCLUDED.lng, created_at = NOW()`,
      [user.id, name, address, lat, lng]
    );
    res.status(201).json({ success: true });
  } catch (err: any) {
    if (err.code === "42P01") { res.status(201).json({ success: true }); return; }
    console.error("Save search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches — Clear searches
router.delete("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.json({ success: true }); return; }
    await execute("DELETE FROM recent_searches WHERE user_id = $1", [user.id]);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Clear searches error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;