import "dotenv/config";

import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { Server as SocketIOServer } from "socket.io";
import { testConnection } from "./config/database";
import { getFirebaseApp } from "./config/firebase";

// ── Import routes ──
import usersRouter from "./routes/users";
import ridesRouter from "./routes/rides";
import paymentsRouter from "./routes/payments";
import driversRouter from "./routes/drivers";
import earningsRouter from "./routes/earnings";
import safetyRouter from "./routes/safety";
import searchRouter from "./routes/search";
import disputesRouter from "./routes/disputes";
import splitFareRouter from "./routes/splitFare";
import tipsRouter from "./routes/tips";
import notificationsRouter from "./routes/notifications";
import affiliatesRouter from "./routes/affiliates";
import payLaterRouter from "./routes/payLater";
import routeRouter from "./routes/route";
import shareRouter, { sharePage } from "./routes/share";
import { startScheduler, stopScheduler } from "./services/SchedulingService";

// ── Socket handlers ──
import { setupSocketHandlers } from "./socket/handlers";
import { execute } from "./config/database";

// ── Init Express ──
// Trigger reload for ALLOWED_ORIGINS update
const app = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT || "3000", 10);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:8081").split(",");

// ── Middleware ──

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan(process.env.LOG_LEVEL === "debug" ? "dev" : "combined"));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api", limiter);

// Routing endpoint sits BEFORE the global limiter so route lookups (which
// are cached and called several times per ride screen) aren't throttled by
// the strict 100/15min auth-limit. It gets its own lenient limiter instead.
const routeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.ROUTE_RATE_LIMIT_MAX || "300", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many route requests, please try again later" },
});
app.use("/api/route", routeLimiter, routeRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Root endpoint for load balancer health checks
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "vura-rider-backend" });
});

// ── Routes ──
app.use("/api/users", usersRouter);
app.use("/api/rides", ridesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/payments/pay-later", payLaterRouter);
app.use("/api/drivers", driversRouter);
app.use("/api/earnings", earningsRouter);
app.use("/api/safety", safetyRouter);
app.use("/api/searches", searchRouter);
app.use("/api/disputes", disputesRouter);
app.use("/api/split", splitFareRouter);
app.use("/api/tips", tipsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/affiliates", affiliatesRouter);
app.use("/api/ratings", require("./routes/ratings").default);
app.use("/api/share", shareRouter);

// ── Public share tracking page ──
app.get("/share/:token", sharePage);

// ── Socket.IO ──
const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

setupSocketHandlers(io);

// Auto-book scheduled rides when their pickup time approaches (runs every 60s).
startScheduler(io);

export { io };

// ── 404 handler ──
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Global error handler ──
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start server ──
async function start() {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║       Vura Rider Backend Server       ║");
  console.log("╚═══════════════════════════════════════╝");

  // 1. Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.warn("⚠ DB connection failed — server will still start but DB features won't work");
  } else {
    // One-time migration — runs only at boot, never per request (previously
    // this DDL ran on every /api/users/sync call and slowed down app start).
    try {
      await execute(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS id_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS id_document_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS license_document_name VARCHAR(255)
      `);
      await execute(`
        ALTER TABLE rides
        ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'x',
        ADD COLUMN IF NOT EXISTS announced BOOLEAN DEFAULT FALSE
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          ride_id UUID NOT NULL,
          sender_id UUID NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      console.log("✓ Schema up to date");
    } catch (err) {
      console.warn("⚠ Schema migration skipped:", err);
    }
  }

  // 2. Init Firebase Admin
  try {
    getFirebaseApp();
  } catch (err) {
    console.warn("⚠ Firebase Admin init failed — auth will not work", err);
  }

  // 3. Start listening
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`✓ Server running on http://localhost:${PORT}`);
    console.log(`✓ Allowed origins: ${allowedOrigins.join(", ")}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
