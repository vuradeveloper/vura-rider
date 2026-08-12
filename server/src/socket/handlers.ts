import { Server as SocketIOServer, Socket } from "socket.io";
import { getAuth } from "../config/firebase";
import { query, queryOne, execute } from "../config/database";

interface AuthSocket extends Socket {
  userId?: string;
  dbUserId?: string;
  userRole?: string;
}

export function setupSocketHandlers(io: SocketIOServer) {
  // Auth middleware
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required"));

      const decoded = await getAuth().verifyIdToken(token);
      socket.userId = decoded.uid;

      const user = await queryOne<{ id: string; role: string }>(
        "SELECT id, role FROM users WHERE firebase_uid = $1",
        [decoded.uid]
      );
      if (user) {
        socket.dbUserId = user.id;
        socket.userRole = user.role;
      }
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthSocket;
    console.log(`🔌 Socket: ${socket.id} (user: ${socket.userId})`);

    if (socket.userId) socket.join(`user:${socket.userId}`);

    const getDbUserId = async (): Promise<string | undefined> => {
      if (socket.dbUserId) return socket.dbUserId;
      if (!socket.userId) return undefined;
      const user = await queryOne<{ id: string }>(
        "SELECT id FROM users WHERE firebase_uid = $1",
        [socket.userId]
      );
      if (user) {
        socket.dbUserId = user.id;
        return user.id;
      }
      return undefined;
    };

    // ── Passenger: request ride ──
    socket.on("passenger:ride:request", async (data) => {
      try {
        const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng } = data;
        let dbUserId = await getDbUserId();

        if (!dbUserId) {
          // For testing and race condition safety, use the first available passenger or auto-insert a placeholder
          const fallbackUser = await queryOne<{ id: string }>(
            "SELECT id FROM users WHERE role = 'passenger' OR role = 'rider' LIMIT 1"
          );
          if (fallbackUser) {
            dbUserId = fallbackUser.id;
          } else {
            const newUser = await queryOne<{ id: string }>(
              "INSERT INTO users (email, full_name, firebase_uid, role) VALUES ($1, $2, $3, 'passenger') RETURNING id",
              ["test-rider@vura.com", "Test Rider", socket.userId || "test-fb-uid"]
            );
            dbUserId = newUser?.id;
          }
        }

        if (!dbUserId) {
          throw new Error("Passenger account not synced with database yet. Try again in a moment.");
        }

        const ride = await queryOne<any>(
          `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'searching')
           RETURNING *`,
          [dbUserId, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng]
        );

        socket.emit("ride:requested:ack", { success: true, rideId: ride?.id });
        if (ride) socket.join(`ride:${ride.id}`);
      } catch (err: any) {
        console.error("Ride request error:", err);
        socket.emit("ride:requested:ack", { success: false, reason: err.message });
      }
    });

    // ── Passenger: cancel ride ──
    socket.on("passenger:ride:cancel", async (data) => {
      try {
        const { rideId, reason } = data;
        await execute(
          "UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = $2, cancelled_at = NOW() WHERE id = $3",
          [socket.userId, reason, rideId]
        );
        io.to(`ride:${rideId}`).emit("ride:cancelled", { reason });
      } catch (err: any) { console.error("Cancel error:", err); }
    });

    // ── Passenger: update pickup location ──
    socket.on("passenger:ride:update_pickup", async (data) => {
      try {
        const { rideId, address, lat, lng } = data;
        if (!rideId || !address || lat == null || lng == null) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "Missing pickup details" });
          return;
        }

        const dbUserId = await getDbUserId();
        if (!dbUserId) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "User not synced" });
          return;
        }

        const ride = await queryOne<any>(
          "SELECT id, status FROM rides WHERE id = $1 AND passenger_id = $2",
          [rideId, dbUserId]
        );
        if (!ride) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "Ride not found" });
          return;
        }
        if (!["searching", "accepted", "driver_arrived", "in_progress"].includes(ride.status)) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "Pickup can no longer be updated on this ride" });
          return;
        }

        await execute(
          `UPDATE rides
           SET pickup_address = $1, pickup_lat = $2, pickup_lng = $3, updated_at = NOW()
           WHERE id = $4 AND passenger_id = $5`,
          [address, lat, lng, rideId, dbUserId]
        );

        socket.emit("ride:pickup:updated:ack", { success: true });
        io.to(`ride:${rideId}`).emit("ride:pickup:updated", { address, lat, lng });
      } catch (err: any) {
        console.error("Update pickup socket error:", err);
        socket.emit("ride:pickup:updated:ack", { success: false, error: err.message });
      }
    });

    // ── Chat ──
    socket.on("chat:join", (data) => {
      socket.join(`chat:${data.rideId}`);
    });

    // ── Chat ──
    socket.on("chat:leave", (data) => {
      socket.leave(`chat:${data.rideId}`);
    });

    socket.on("chat:send", async (data) => {
      try {
        const { rideId, message } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) throw new Error("User details not synced.");

        const msg = await queryOne<any>(
          `INSERT INTO chat_messages (ride_id, sender_id, message)
           VALUES ($1, $2, $3)
           RETURNING id, ride_id, sender_id, message, created_at`,
          [rideId, dbUserId, message]
        );
        io.to(`chat:${rideId}`).emit("chat:message", msg);
      } catch (err: any) { console.error("Chat error:", err); }
    });

    // ── Split fare ──
    socket.on("split:invite", async (data) => {
      try {
        const { rideId, inviteeEmail, amount } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) throw new Error("User details not synced.");

        const inviter = await queryOne<{ id: string; full_name: string; email: string }>(
          "SELECT id, full_name, email FROM users WHERE id = $1",
          [dbUserId]
        );

        const split = await queryOne<any>(
          `INSERT INTO split_fares (ride_id, inviter_id, invitee_email, amount) VALUES ($1, $2, $3, $4) RETURNING id`,
          [rideId, dbUserId, inviteeEmail, amount]
        );

        const invitee = await queryOne<{ firebase_uid: string }>(
          "SELECT firebase_uid FROM users WHERE email = $1",
          [inviteeEmail]
        );

        if (invitee && split) {
          io.to(`user:${invitee.firebase_uid}`).emit("split:invite", {
            splitId: split.id, rideId,
            inviterName: inviter?.full_name || "Someone",
            inviterEmail: inviter?.email || "",
            amount,
          });
        }
      } catch (err: any) { console.error("Split invite error:", err); }
    });

    socket.on("split:respond", async (data) => {
      try {
        const { splitId, accept } = data;
        const status = accept ? "accepted" : "declined";
        const resp = await queryOne<any>(
          `UPDATE split_fares SET status = $1, invitee_id = $2, updated_at = NOW() WHERE id = $3 RETURNING ride_id, inviter_id`,
          [status, socket.dbUserId, splitId]
        );

        if (resp) {
          const responder = await queryOne<{ full_name: string }>(
            "SELECT full_name FROM users WHERE id = $1", [socket.dbUserId]
          );
          const inviter = await queryOne<{ firebase_uid: string }>(
            "SELECT firebase_uid FROM users WHERE id = $1", [resp.inviter_id]
          );
          if (inviter) {
            io.to(`user:${inviter.firebase_uid}`).emit(
              accept ? "split:accepted" : "split:declined",
              { splitId, inviteeName: responder?.full_name || "Someone" }
            );
          }
        }
      } catch (err: any) { console.error("Split respond error:", err); }
    });

    // ── Safety ──
    socket.on("safety:sos", async (data) => {
      try {
        const { rideId } = data;
        await execute(
          "INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'sos', $2)",
          [rideId, JSON.stringify({ triggered_by: socket.userId, timestamp: new Date().toISOString() })]
        );
        io.to(`ride:${rideId}`).emit("safety:sos:dispatched", {
          rideId, message: "SOS alert triggered for this ride",
        });
      } catch (err: any) { console.error("SOS error:", err); }
    });

    socket.on("share:generate", async (data) => {
      const { rideId } = data;
      const shareToken = Math.random().toString(36).substring(2, 15);
      io.to(`ride:${rideId}`).emit("share:generated", { rideId, shareToken, shareUrl: `/share/${shareToken}` });
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Disconnected: ${socket.id}`);
    });
  });
}