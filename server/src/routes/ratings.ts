import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { query, queryOne } from "../config/database";
import pool from "../config/database";
import { Rating } from "../types";

const router = Router();

// ── Submit a rating ──
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const u = req.user!.dbUser;
    const { rideId, score, comment } = req.body;

    if (!rideId || typeof score !== "number" || score < 1 || score > 5) {
      res.status(400).json({ error: "rideId and score (1-5) are required" });
      return;
    }

    // Verify ride belongs to this passenger and is completed
    const ride = await queryOne(
      `SELECT id, driver_id FROM rides
       WHERE id = $1 AND passenger_id = $2 AND status = 'completed'`,
      [rideId, u.id]
    );

    if (!ride) {
      res.status(404).json({ error: "Ride not found or not completed" });
      return;
    }

    // One rating per ride
    const existing = await queryOne(
      `SELECT id FROM ratings WHERE ride_id = $1`,
      [rideId]
    );

    if (existing) {
      res.status(409).json({ error: "You have already rated this ride" });
      return;
    }

    // Insert rating
    const rating = await queryOne<Rating>(
      `INSERT INTO ratings (ride_id, passenger_id, driver_id, score, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [rideId, u.id, ride.driver_id, score, comment ?? null]
    );

    // Recalculate driver average
    const aggRows = await query(
      `SELECT COALESCE(AVG(score), 0) AS avg_score, COUNT(*)::int AS total_ratings
       FROM ratings WHERE driver_id = $1`,
      [ride.driver_id]
    );

    await query(
      `UPDATE driver_profiles
       SET average_rating = $1, total_rides = $2, updated_at = NOW()
       WHERE user_id = $3`,
      [parseFloat(aggRows[0].avg_score), aggRows[0].total_ratings, ride.driver_id]
    );

    await client.query("COMMIT");
    res.status(201).json({ rating });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("POST /api/ratings error:", err.message);
    res.status(500).json({ error: "Failed to submit rating" });
  } finally {
    client.release();
  }
});

export default router;
