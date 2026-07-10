import { Server, Socket } from "socket.io";
import { query, queryOne } from "../config/database";
import pool from "../config/database";

export function registerDriverHandlers(io: Server, socket: Socket, user: any) {
  let rideTimeout: NodeJS.Timeout | null = null;
  let currentRideId: string | null = null;

  // ── driver:online ──
  socket.on("driver:online", async () => {
    try {
      await query(
        `UPDATE driver_profiles SET is_online = TRUE, updated_at = NOW() WHERE user_id = $1`,
        [user.id]
      );
      socket.emit("driver:online:ack", { success: true });
      console.log(`[driver] ${user.id} is now online`);
    } catch (err: any) {
      socket.emit("error", { message: "Failed to go online" });
    }
  });

  // ── driver:offline ──
  socket.on("driver:offline", async () => {
    try {
      await query(
        `UPDATE driver_profiles SET is_online = FALSE, updated_at = NOW() WHERE user_id = $1`,
        [user.id]
      );
      socket.emit("driver:offline:ack", { success: true });
    } catch (err: any) {
      socket.emit("error", { message: "Failed to go offline" });
    }
  });

  // ── driver:location (every ~3s) ──
  socket.on("driver:location", async (data: { lat: number; lng: number; heading?: number; speed?: number }) => {
    try {
      await query(
        `UPDATE driver_profiles
         SET current_lat = $1, current_lng = $2, current_heading = $3,
             current_speed = $4, last_location_at = NOW(), updated_at = NOW()
         WHERE user_id = $5`,
        [data.lat, data.lng, data.heading ?? null, data.speed ?? null, user.id]
      );

      // Relay to passenger on active ride
      if (currentRideId) {
        const ride = await queryOne(
          `SELECT passenger_id FROM rides WHERE id = $1`,
          [currentRideId]
        );
        if (ride) {
          io.to(`user:${ride.passenger_id}`).emit("driver:location:update", {
            lat: data.lat,
            lng: data.lng,
            heading: data.heading ?? null,
            speed: data.speed ?? null,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (err: any) {
      console.error("driver:location error:", err.message);
    }
  });

  // ── driver:ride:accept ──
  socket.on("driver:ride:accept", async (data: { rideId: string }) => {
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Lock the ride row to prevent double-accept
        const ride = await client.query(
          `SELECT r.*, p.full_name AS passenger_name, p.phone AS passenger_phone
           FROM rides r
           JOIN users p ON p.id = r.passenger_id
           WHERE r.id = $1 AND r.status = 'searching'
           FOR UPDATE`,
          [data.rideId]
        );

        if (ride.rows.length === 0) {
          await client.query("ROLLBACK");
          socket.emit("driver:ride:accept:ack", { success: false, reason: "Ride already taken or expired" });
          return;
        }

        const r = ride.rows[0];

        // Get driver profile info
        const driverProfile = await client.query(
          `SELECT dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
                  dp.current_lat, dp.current_lng, dp.current_heading, dp.average_rating
           FROM driver_profiles dp WHERE dp.user_id = $1`,
          [user.id]
        );

        await client.query(
          `UPDATE rides SET driver_id = $1, status = 'accepted', accepted_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [user.id, data.rideId]
        );

        await client.query("COMMIT");

        currentRideId = data.rideId;
        if (rideTimeout) clearTimeout(rideTimeout);

        // Confirm to driver
        socket.emit("driver:ride:accept:ack", { success: true, rideId: data.rideId });

        // Notify passenger
        const dp = driverProfile.rows[0] ?? {};
        io.to(`user:${r.passenger_id}`).emit("ride:accepted", {
          rideId: data.rideId,
          driver: {
            id: user.id,
            name: user.full_name ?? "Driver",
            phone: user.phone,
            lat: dp.current_lat,
            lng: dp.current_lng,
            heading: dp.current_heading,
            rating: dp.average_rating,
            vehicle: `${dp.vehicle_color ?? ""} ${dp.vehicle_make ?? ""} ${dp.vehicle_model ?? ""}`.trim() || null,
            license_plate: dp.license_plate,
          },
          eta: 5, // minutes, can calculate later with Google Maps
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error("driver:ride:accept error:", err.message);
      socket.emit("error", { message: "Failed to accept ride" });
    }
  });

  // ── driver:arrived ──
  socket.on("driver:arrived", async (data: { rideId: string }) => {
    try {
      await query(
        `UPDATE rides SET status = 'driver_arrived', arrived_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND driver_id = $2`,
        [data.rideId, user.id]
      );

      const ride = await queryOne(`SELECT passenger_id FROM rides WHERE id = $1`, [data.rideId]);
      if (ride) {
        io.to(`user:${ride.passenger_id}`).emit("ride:driver:arrived", { rideId: data.rideId });
      }
    } catch (err: any) {
      socket.emit("error", { message: "Failed to mark arrived" });
    }
  });

  // ── driver:trip:start ──
  socket.on("driver:trip:start", async (data: { rideId: string }) => {
    try {
      await query(
        `UPDATE rides SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND driver_id = $2`,
        [data.rideId, user.id]
      );

      const ride = await queryOne(`SELECT passenger_id FROM rides WHERE id = $1`, [data.rideId]);
      if (ride) {
        io.to(`user:${ride.passenger_id}`).emit("ride:started", { rideId: data.rideId });
      }
    } catch (err: any) {
      socket.emit("error", { message: "Failed to start trip" });
    }
  });

  // ── driver:trip:complete ──
  socket.on(
    "driver:trip:complete",
    async (data: { rideId: string; fare: number; distanceKm: number; durationMins: number }) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const ride = await client.query(
          `SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'in_progress'`,
          [data.rideId, user.id]
        );

        if (ride.rows.length === 0) {
          await client.query("ROLLBACK");
          socket.emit("error", { message: "Ride not found or not in progress" });
          return;
        }

        const commission = data.fare * 0.25;
        const serviceFee = Math.round(Math.min(commission, 5) * 100) / 100; // 25% capped at R5
        const rideRequestFee = Math.round(data.fare * 0.04 * 100) / 100; // 4% ride request fee
        const netEarnings = Math.round((data.fare - serviceFee) * 100) / 100;
        const riderTotal = Math.round((data.fare + rideRequestFee) * 100) / 100;

        await client.query(
          `UPDATE rides SET status = 'completed', fare = $1, ride_request_fee = $2,
           distance_km = $3, duration_mins = $4, completed_at = NOW(), updated_at = NOW()
           WHERE id = $5`,
          [data.fare, rideRequestFee, data.distanceKm, data.durationMins, data.rideId]
        );

        await client.query(
          `INSERT INTO driver_earnings (driver_id, ride_id, gross_fare, service_fee, ride_request_fee, net_earnings, distance_km, duration_mins)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [user.id, data.rideId, data.fare, serviceFee, rideRequestFee, netEarnings, data.distanceKm, data.durationMins]
        );

        await client.query("COMMIT");

        currentRideId = null;

        const r = ride.rows[0];
        io.to(`user:${r.passenger_id}`).emit("ride:completed", {
          rideId: data.rideId,
          fare: data.fare,
          rideRequestFee,
          riderTotal,
          distanceKm: data.distanceKm,
          durationMins: data.durationMins,
        });

        socket.emit("ride:completed", {
          rideId: data.rideId,
          fare: data.fare,
          netEarnings,
          rideRequestFee,
          riderTotal,
          distanceKm: data.distanceKm,
          durationMins: data.durationMins,
        });
      } catch (err: any) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );

  // ── driver:ride:cancel ──
  socket.on("driver:ride:cancel", async (data: { rideId: string; reason?: string }) => {
    try {
      const ride = await queryOne(
        `UPDATE rides SET status = 'cancelled', cancelled_by = 'driver',
         cancel_reason = $1, updated_at = NOW()
         WHERE id = $2 AND driver_id = $3
         RETURNING *`,
        [data.reason ?? null, data.rideId, user.id]
      );

      if (!ride) {
        socket.emit("error", { message: "Ride not found or not yours" });
        return;
      }

      currentRideId = null;
      if (rideTimeout) clearTimeout(rideTimeout);

      await query(
        `UPDATE driver_profiles SET is_online = TRUE, updated_at = NOW() WHERE user_id = $1`,
        [user.id]
      );

      io.to(`user:${ride.passenger_id}`).emit("ride:cancelled", {
        rideId: data.rideId,
        cancelledBy: "driver",
        reason: data.reason ?? "Driver cancelled",
      });

      socket.emit("driver:ride:cancel:ack", { success: true });
    } catch (err: any) {
      socket.emit("error", { message: "Failed to cancel ride" });
    }
  });

  // ── chat:message ──
  socket.on("chat:message", async (data: { rideId: string; message: string }) => {
    try {
      const ride = await queryOne(
        `SELECT passenger_id, driver_id FROM rides WHERE id = $1`,
        [data.rideId]
      );

      if (!ride) {
        socket.emit("error", { message: "Ride not found" });
        return;
      }

      const targetUser =
        user.id === ride.driver_id ? ride.passenger_id : ride.driver_id;

      io.to(`user:${targetUser}`).emit("chat:message", {
        rideId: data.rideId,
        from: user.id,
        role: user.role,
        message: data.message,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      socket.emit("error", { message: "Failed to send message" });
    }
  });
}
