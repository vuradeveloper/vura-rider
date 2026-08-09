import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// POST /api/tips — Submit a tip
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { rideId, amount } = req.body;

    if (!rideId || !amount || amount <= 0) {
      res.status(400).json({ error: "Valid rideId and amount are required" });
      return;
    }

    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Add tip to actual_fare
    await execute(
      "UPDATE rides SET actual_fare = COALESCE(actual_fare, estimated_fare, 0) + $1 WHERE id = $2 AND passenger_id = $3",
      [amount, rideId, user.id]
    );

    console.log(`💰 Tip of ${amount} on ride ${rideId} by ${firebaseUid}`);
    res.json({ success: true, amount });
  } catch (err: any) {
    console.error("Tip error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;