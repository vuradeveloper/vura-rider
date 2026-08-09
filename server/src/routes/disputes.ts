import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// Ensure tables exist
async function ensureTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS disputes (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      user_id UUID NOT NULL REFERENCES users(id),
      type VARCHAR(50) NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'open',
      resolution TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS lost_item_reports (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ride_id UUID REFERENCES rides(id),
      user_id UUID NOT NULL REFERENCES users(id),
      item_name VARCHAR(255) NOT NULL,
      item_description TEXT,
      driver_contacted BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'reported',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// POST /api/disputes — Submit dispute
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTables();
    const firebaseUid = req.userId!;
    const { rideId, type, reason, description } = req.body;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const dispute = await queryOne(
      `INSERT INTO disputes (ride_id, user_id, type, reason, description) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, ride_id, type, reason, description, status, created_at, updated_at`,
      [rideId, user.id, type, reason, description]
    );
    res.status(201).json({ dispute });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/disputes — List disputes
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.json({ disputes: [] }); return; }

    const disputes = await query("SELECT * FROM disputes WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
    res.json({ disputes });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/disputes/lost-item — Report lost item
router.post("/lost-item", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTables();
    const firebaseUid = req.userId!;
    const { rideId, itemName, itemDescription } = req.body;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const report = await queryOne(
      `INSERT INTO lost_item_reports (ride_id, user_id, item_name, item_description) VALUES ($1, $2, $3, $4)
       RETURNING id, ride_id, item_name, item_description, driver_contacted, status, created_at`,
      [rideId, user.id, itemName, itemDescription]
    );
    res.status(201).json({ report });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/disputes/lost-items — List lost item reports
router.get("/lost-items", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.json({ reports: [] }); return; }

    const reports = await query("SELECT * FROM lost_item_reports WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
    res.json({ reports });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;