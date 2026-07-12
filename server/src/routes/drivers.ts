import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { query, queryOne } from "../config/database";
import { DriverProfile, DriverStats, UserWithDriver } from "../types";
import {
  asTrimmedString,
  isLatitude,
  isLongitude,
  parseFiniteNumber,
} from "../utils/validation";

const router = Router();

// ── Update driver profile (vehicle / license) ──
router.patch("/profile", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = req.user!.dbUser;
    if (u.role !== "driver") {
      res.status(403).json({ error: "Only drivers can update driver profile" });
      return;
    }

    const {
      license_number,
      vehicle_make,
      vehicle_model,
      vehicle_year,
      vehicle_color,
      license_plate,
    } = req.body;

    const vehicleYear =
      vehicle_year === undefined || vehicle_year === null
        ? null
        : parseFiniteNumber(vehicle_year);
    const maxVehicleYear = new Date().getFullYear() + 1;

    if (
      vehicleYear !== null &&
      (!Number.isInteger(vehicleYear) ||
        vehicleYear < 1980 ||
        vehicleYear > maxVehicleYear)
    ) {
      res.status(400).json({ error: "vehicle_year must be a valid year" });
      return;
    }

    const updated = await queryOne<DriverProfile>(
      `UPDATE driver_profiles
       SET license_number = COALESCE($1, license_number),
           vehicle_make = COALESCE($2, vehicle_make),
           vehicle_model = COALESCE($3, vehicle_model),
           vehicle_year = COALESCE($4, vehicle_year),
           vehicle_color = COALESCE($5, vehicle_color),
           license_plate = COALESCE($6, license_plate),
           updated_at = NOW()
       WHERE user_id = $7
       RETURNING *`,
      [
        asTrimmedString(license_number, { maxLength: 64 }),
        asTrimmedString(vehicle_make, { maxLength: 64 }),
        asTrimmedString(vehicle_model, { maxLength: 64 }),
        vehicleYear,
        asTrimmedString(vehicle_color, { maxLength: 32 }),
        asTrimmedString(license_plate, { maxLength: 32 }),
        u.id,
      ]
    );

    res.json({ profile: updated });
  } catch (err: any) {
    console.error("PATCH /api/drivers/profile error:", err.message);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ── Dashboard stats ──
router.get("/stats", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = req.user!.dbUser;
    if (u.role !== "driver") {
      res.status(403).json({ error: "Driver-only endpoint" });
      return;
    }

    const driverRows = await query(
      `SELECT total_rides, average_rating FROM driver_profiles WHERE user_id = $1`,
      [u.id]
    );

    const todayRows = await query(
      `SELECT COALESCE(COUNT(*),0) AS rides, COALESCE(SUM(net_earnings),0) AS earned
       FROM driver_earnings
       WHERE driver_id = $1 AND created_at::date = CURRENT_DATE`,
      [u.id]
    );

    const monthRows = await query(
      `SELECT COALESCE(COUNT(*),0) AS rides, COALESCE(SUM(net_earnings),0) AS earned
       FROM driver_earnings
       WHERE driver_id = $1 AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)`,
      [u.id]
    );

    const allRows = await query(
      `SELECT COALESCE(COUNT(*),0) AS rides, COALESCE(SUM(net_earnings),0) AS earned
       FROM driver_earnings WHERE driver_id = $1`,
      [u.id]
    );

    const stats: DriverStats = {
      today: {
        rides: parseInt(todayRows[0]?.rides ?? 0),
        earned: parseFloat(todayRows[0]?.earned ?? 0),
      },
      thisMonth: {
        rides: parseInt(monthRows[0]?.rides ?? 0),
        earned: parseFloat(monthRows[0]?.earned ?? 0),
      },
      allTime: {
        rides: parseInt(allRows[0]?.rides ?? 0),
        earned: parseFloat(allRows[0]?.earned ?? 0),
      },
      rating: {
        average: parseFloat((driverRows[0]?.average_rating ?? 0).toString()),
        total: parseInt((driverRows[0]?.total_rides ?? 0).toString()),
      },
    };

    res.json(stats);
  } catch (err: any) {
    console.error("GET /api/drivers/stats error:", err.message);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// ── Nearby online drivers (REST fallback) ──
router.get("/nearby", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius: radiusRaw = 10 } = req.query;
    if (!lat || !lng) {
      res.status(400).json({ error: "lat and lng are required" });
      return;
    }

    const r = parseFiniteNumber(radiusRaw);
    const latitude = parseFiniteNumber(lat);
    const longitude = parseFiniteNumber(lng);

    if (
      r === null ||
      latitude === null ||
      longitude === null ||
      r <= 0 ||
      r > 50 ||
      !isLatitude(latitude) ||
      !isLongitude(longitude)
    ) {
      res.status(400).json({ error: "lat, lng, and radius must be valid numbers" });
      return;
    }

    const drivers = await query(
      `SELECT u.id, u.full_name, dp.vehicle_make, dp.vehicle_model,
              dp.vehicle_color, dp.license_plate, dp.current_lat, dp.current_lng,
              dp.current_heading, dp.average_rating
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_online = TRUE
         AND dp.current_lat IS NOT NULL
         AND dp.current_lng IS NOT NULL
         AND dp.last_location_at > NOW() - INTERVAL '2 minutes'
         AND (
           6371 * acos(
             cos(radians($1)) * cos(radians(dp.current_lat)) *
             cos(radians(dp.current_lng) - radians($2)) +
             sin(radians($1)) * sin(radians(dp.current_lat))
           )
         ) <= $3`,
      [latitude, longitude, r]
    );

    res.json({ drivers });
  } catch (err: any) {
    console.error("GET /api/drivers/nearby error:", err.message);
    res.status(500).json({ error: "Failed to find nearby drivers" });
  }
});

export default router;
