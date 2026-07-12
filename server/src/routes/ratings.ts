import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import pool from "../config/database";
import { Rating } from "../types";
import { asTrimmedString, isUuid } from "../utils/validation";

const router = Router();

// ── Submit a rating ──
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const u = req.user!.dbUser;
  const rideId = asTrimmedString(req.body?.rideId);
  const score = req.body?.score;
  const comment =
    req.body?.comment === undefined || req.body?.comment === null
      ? null
      : asTrimmedString(req.body.comment, { maxLength: 1000 });

  if (!isUuid(rideId) || !Number.isInteger(score) || score < 1 || score > 5) {
    res.status(400).json({ error: "rideId and score (1-5) are required" });
    return;
  }

  if (req.body?.comment !== undefined && req.body?.comment !== null && comment === null) {
    res.status(400).json({ error: "Comment must be under 1000 characters" });
    return;
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const rideResult = await client.query(
      `SELECT id, driver_id FROM rides
       WHERE id = $1 AND passenger_id = $2 AND status = 'completed'`,
      [rideId, u.id]
    );
    const ride = rideResult.rows[0];

    if (!ride) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      res.status(404).json({ error: "Ride not found or not completed" });
      return;
    }

    const existing = await client.query(
      `SELECT id FROM ratings WHERE ride_id = $1`,
      [rideId]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      res.status(409).json({ error: "You have already rated this ride" });
      return;
    }

    const ratingResult = await client.query<Rating>(
      `INSERT INTO ratings (ride_id, passenger_id, driver_id, score, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [rideId, u.id, ride.driver_id, score, comment]
    );
    const rating = ratingResult.rows[0];

    const aggRows = await client.query(
      `SELECT COALESCE(AVG(score), 0) AS avg_score, COUNT(*)::int AS total_ratings
       FROM ratings WHERE driver_id = $1`,
      [ride.driver_id]
    );

    await client.query(
      `UPDATE driver_profiles
       SET average_rating = $1, total_rides = $2, updated_at = NOW()
       WHERE user_id = $3`,
      [
        parseFloat(aggRows.rows[0].avg_score),
        aggRows.rows[0].total_ratings,
        ride.driver_id,
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;
    res.status(201).json({ rating });
  } catch (err: any) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        console.error("POST /api/ratings rollback error:", rollbackErr.message);
      });
    }
    console.error("POST /api/ratings error:", err.message);
    res.status(500).json({ error: "Failed to submit rating" });
  } finally {
    client.release();
  }
});

export default router;
