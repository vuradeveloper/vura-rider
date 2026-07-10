import { Server, Socket } from "socket.io";
import { query, queryOne } from "../config/database";
import pool from "../config/database";

const AUTO_CANCEL_MS = 2 * 60 * 1000; // 2 minutes

export function registerPassengerHandlers(io: Server, socket: Socket, user: any) {
  let cancelTimer: NodeJS.Timeout | null = null;

  // ── passenger:connect ──
  socket.on("passenger:connect", () => {
    socket.emit("passenger:connect:ack", { success: true, userId: user.id });
    console.log(`[passenger] ${user.id} connected`);
  });

  // ── passenger:ride:request ──
  socket.on(
    "passenger:ride:request",
    async (data: {
      pickupAddress: string;
      pickupLat: number;
      pickupLng: number;
      destinationAddress: string;
      destinationLat: number;
      destinationLng: number;
    }) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Check no active ride
        const active = await client.query(
          `SELECT id FROM rides
           WHERE passenger_id = $1 AND status NOT IN ('completed', 'cancelled')`,
          [user.id]
        );

        if (active.rows.length > 0) {
          await client.query("ROLLBACK");
          socket.emit("ride:requested:ack", {
            success: false,
            reason: "You already have an active ride",
          });
          return;
        }

        // Create ride
        const ride = await client.query(
          `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng,
                              destination_address, destination_lat, destination_lng, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'searching')
           RETURNING *`,
          [
            user.id,
            data.pickupAddress,
            data.pickupLat,
            data.pickupLng,
            data.destinationAddress,
            data.destinationLat,
            data.destinationLng,
          ]
        );

        await client.query("COMMIT");

        const rideId = ride.rows[0].id;

        socket.emit("ride:requested:ack", { success: true, rideId });

        // Find nearby drivers and broadcast
        const nearbyDrivers = await query(
          `SELECT u.id AS user_id
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
             ) <= 10`,
          [data.pickupLat, data.pickupLng]
        );

        if (nearbyDrivers.length === 0) {
          socket.emit("ride:no:drivers", { rideId });
        } else {
          // Broadcast to each nearby driver
          for (const d of nearbyDrivers) {
            io.to(`user:${d.user_id}`).emit("ride:new:request", {
              rideId,
              passenger: {
                id: user.id,
                name: user.full_name ?? "Passenger",
              },
              pickup: {
                address: data.pickupAddress,
                lat: data.pickupLat,
                lng: data.pickupLng,
              },
              destination: {
                address: data.destinationAddress,
                lat: data.destinationLat,
                lng: data.destinationLng,
              },
              estimatedFare: calculateFare(data.pickupLat, data.pickupLng, data.destinationLat, data.destinationLng),
            });
          }
        }

        // Auto-cancel after 2 minutes if no driver accepts
        cancelTimer = setTimeout(async () => {
          try {
            const rideRow = await queryOne(
              `SELECT * FROM rides WHERE id = $1`,
              [rideId]
            );

            if (rideRow && rideRow.status === "searching") {
              await query(
                `UPDATE rides SET status = 'cancelled', cancelled_by = 'system',
                 cancel_reason = 'No drivers accepted', updated_at = NOW()
                 WHERE id = $1`,
                [rideId]
              );
              socket.emit("ride:expired", { rideId });
            }
          } catch (_) {}
        }, AUTO_CANCEL_MS);
      } catch (err: any) {
        await client.query("ROLLBACK");
        console.error("passenger:ride:request error:", err.message);
        socket.emit("error", { message: "Failed to request ride" });
      } finally {
        client.release();
      }
    }
  );

  // ── passenger:ride:cancel ──
  socket.on(
    "passenger:ride:cancel",
    async (data: { rideId: string; reason?: string }) => {
      try {
        if (cancelTimer) {
          clearTimeout(cancelTimer);
          cancelTimer = null;
        }

        const ride = await queryOne(
          `UPDATE rides SET status = 'cancelled', cancelled_by = 'passenger',
           cancel_reason = $1, updated_at = NOW()
           WHERE id = $2 AND passenger_id = $3
           RETURNING driver_id`,
          [data.reason ?? null, data.rideId, user.id]
        );

        if (!ride) {
          socket.emit("error", { message: "Ride not found or not yours" });
          return;
        }

        if (ride.driver_id) {
          io.to(`user:${ride.driver_id}`).emit("ride:cancelled", {
            rideId: data.rideId,
            cancelledBy: "passenger",
            reason: data.reason ?? "Passenger cancelled",
          });
        }

        socket.emit("ride:cancelled", {
          rideId: data.rideId,
          cancelledBy: "passenger",
          reason: data.reason ?? "You cancelled the ride",
        });
      } catch (err: any) {
        socket.emit("error", {
          message: "Failed to cancel ride",
        });
      }
    }
  );

  // ── chat:message ──
  socket.on(
    "chat:message",
    async (data: { rideId: string; message: string }) => {
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
          user.id === ride.passenger_id ? ride.driver_id : ride.passenger_id;

        io.to(`user:${targetUser}`).emit("chat:message", {
          rideId: data.rideId,
          from: user.id,
          role: user.role,
          message: data.message,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        socket.emit("error", {
          message: "Failed to send message",
        });
      }
    }
  );
}

// Simple fare estimator
function calculateFare(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  // Base fare $2 + $1.5 per km
  return Math.round((2 + distanceKm * 1.5) * 100) / 100;
}
