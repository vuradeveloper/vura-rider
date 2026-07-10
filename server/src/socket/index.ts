import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyToken } from "../config/firebase";
import { query, queryOne } from "../config/database";
import { registerDriverHandlers } from "./driver";
import { registerPassengerHandlers } from "./passenger";

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        const allowed = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? [];
        if (!origin || allowed.length === 0 || allowed.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  // Auth middleware for Socket.io
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const decoded = await verifyToken(token);
      const dbUser = await queryOne(
        `SELECT * FROM users WHERE firebase_uid = $1`,
        [decoded.uid]
      );

      if (!dbUser) {
        return next(new Error("User not found. Call POST /api/users/sync first."));
      }

      (socket as any).user = dbUser;
      next();
    } catch (err: any) {
      console.error("Socket auth error:", err.message);
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket as any).user;
    console.log(`[socket] ${user.role} connected: ${user.id} (${user.full_name ?? user.phone})`);

    // Join personal room
    socket.join(`user:${user.id}`);

    if (user.role === "driver") {
      registerDriverHandlers(io, socket, user);
    } else {
      registerPassengerHandlers(io, socket, user);
    }

    socket.on("disconnect", () => {
      if (user.role === "driver") {
        // Mark driver offline on disconnect
        query(
          `UPDATE driver_profiles SET is_online = FALSE, updated_at = NOW() WHERE user_id = $1`,
          [user.id]
        ).catch(() => {});

        // Notify any active passenger
        queryOne(
          `SELECT r.id, r.passenger_id FROM rides r
           WHERE r.driver_id = $1 AND r.status NOT IN ('completed', 'cancelled')
           ORDER BY r.created_at DESC LIMIT 1`,
          [user.id]
        ).then((ride) => {
          if (ride) {
            io.to(`user:${ride.passenger_id}`).emit("driver:disconnected", {
              rideId: ride.id,
            });
          }
        });
      }
      console.log(`[socket] ${user.role} disconnected: ${user.id}`);
    });
  });

  return io;
}
