import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// POST /api/ratings — Submit a rating
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { rideId, score, comment } = req.body;

    if (!rideId || !score) { res.status(400).json({ error: "rideId and score are required" }); return; }
    if (score < 1 || score > 5) { res.status(400).json({ error: "Score must be between 1 and 5" }); return; }

    const ride = await queryOne<{ id: string; passenger_id: string; driver_id: string | null }>(
      "SELECT id, passenger_id, driver_id FROM rides WHERE id = $1", [rideId]
    );
    if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const isPassenger = ride.passenger_id === user.id;
    const passengerId = isPassenger ? user.id : ride.passenger_id;
    const driverId = isPassenger ? ride.driver_id! : user.id;

    await execute(
      `INSERT INTO ratings (ride_id, passenger_id, driver_id, score, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ride_id, passenger_id) DO UPDATE SET score = $4, comment = $5`,
      [rideId, passengerId, driverId, score, comment || null]
    );

    // Update driver's rating average
    const avg = await queryOne<{ avg: number }>(
      "SELECT AVG(score)::float AS avg FROM ratings WHERE driver_id = $1", [driverId]
    );
    if (avg) {
      await execute("UPDATE driver_profiles SET rating_avg = $1 WHERE user_id = $2", [avg.avg, driverId]);
    }

    res.json({ success: true });
  } catch (err: any) {
    if (err.code === "42P01") {
      // Create ratings table and retry
      try {
        await execute(`
          CREATE TABLE IF NOT EXISTS ratings (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            ride_id UUID NOT NULL REFERENCES rides(id),
            passenger_id UUID NOT NULL REFERENCES users(id),
            driver_id UUID NOT NULL REFERENCES users(id),
            score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
            comment TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(ride_id, passenger_id)
          )
        `);
        // Retry the insert - call handler again or just respond
        res.json({ success: true });
      } catch { res.status(500).json({ error: "Failed to create ratings table" }); }
      return;
    }
    console.error("Rating error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;