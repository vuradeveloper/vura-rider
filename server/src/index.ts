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
import ridesRouter, { cleanupStaleRides } from "./routes/rides";
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
import emailRouter from "./routes/email";
import shareRouter, { sharePage } from "./routes/share";
import payoutsRouter from "./routes/payouts";
import documentsRouter from "./routes/documents";
import devLogsRouter from "./routes/devLogs";
import devDispatchRouter from "./routes/devDispatch";
import vehicleImagesRouter from "./routes/vehicleImagesAdmin";
import { ensureVehicleImageTables, startVehicleImageWorker } from "./services/vehicleImages";
import adminRouter from "./routes/admin";
import { startScheduler, stopScheduler } from "./services/SchedulingService";
import { startOfferWorker } from "./services/offerWorker";
import { startOsmPlaceSync, syncOsmPlaces, getOsmSyncStatus } from "./services/OsmPlaceSyncService";

// ── Socket handlers ──
import { setupSocketHandlers } from "./socket/handlers";
import { execute } from "./config/database";

// ── Init Express ──
// Trigger reload for ALLOWED_ORIGINS update
const app = express();
const server = http.createServer(app);

// The app sits behind the AWS ALB / nginx which terminate TLS and forward
// HTTP to this Node server. `trust proxy` makes Express read the forwarded
// protocol/host headers so `req.protocol`/`req.get("host")` return the public
// HTTPS values — otherwise generated absolute URLs (e.g. share links) wrongly
// use "http://..." and time out in browsers (the site only answers on 443).
app.set("trust proxy", true);

const PORT = parseInt(process.env.PORT || "3000", 10);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:8081,http://localhost:8082,http://localhost:19006").split(",");

// ── Middleware ──

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Body parsing — 30MB so base64 document uploads (≤15MB binary → ~20MB)
// fit without a 413. Regular API calls are tiny; the extra headroom is cheap.
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan(process.env.LOG_LEVEL === "debug" ? "dev" : "combined"));

// Device-log endpoint sits BEFORE the global limiter — logging must never
// steal from the app's request budget (which caused 429 storms) nor be
// throttled itself. The write/read key header still gates it.
app.use("/api/dev/logs", devLogsRouter);

// Dispatch inspector (read-only, same read key): see the whole offer trail for a
// ride without digging through CloudWatch — GET /api/dev/dispatch?key=…&rideId=…
app.use("/api/dev/dispatch", devDispatchRouter);

// Vehicle photos: our own copy of every cached car image (public, <img>-able) plus
// the password-gated review page. Mounted BEFORE the global limiter for the same
// reason as the dev routes: an image request must never eat the app's API budget.
app.use("/api", vehicleImagesRouter);

// Create the cache tables and start the queue drainer (one CarsXE call per
// cache_key, ever, and never past the budget). Best-effort: a database hiccup
// here must not stop the API from booting.
ensureVehicleImageTables().catch((err) =>
  console.error("[vehicleImages] table ensure failed:", err?.message || err)
);
startVehicleImageWorker();

// Rate limiting — generous limits so the driver's high-frequency polling (1s
// while online) and socket polling-transport don't 429 the client. The old
// 300/15min cap was exhausted within 5 minutes by the every-second ride poll,
// which caused constant "Too many requests" errors and broke every other API
// call (stats, earnings, wallet). 6000/15min = 400/min, plenty of headroom.
// NOTE: the deployed server/.env (and EB env props) once shipped with
// RATE_LIMIT_MAX_REQUESTS=100 — clamp the floor so a stale/old value can
// never re-create the 429 storm on a fresh deploy.
const rateMaxRaw = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "6000", 10);
const rateMax = Math.max(Number.isFinite(rateMaxRaw) ? rateMaxRaw : 6000, 3000);
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
  max: rateMax,
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

// OSM places auto-sync status + manual trigger (admin/debug aid).
app.get("/api/osm-places/status", (_req, res) => {
  res.json({ ...getOsmSyncStatus(), area: "Johannesburg metro", intervalH: 6 });
});
app.post("/api/osm-places/sync", async (_req, res) => {
  try {
    const result = await syncOsmPlaces();
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Sync failed" });
  }
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
// Alias so search also answers at /api/search (no 's') — the
// rider app calls /api/search/geocode + /api/search/reverse.
app.use("/api/search", searchRouter);
app.use("/api/disputes", disputesRouter);
app.use("/api/split", splitFareRouter);
app.use("/api/tips", tipsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/payouts", payoutsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/affiliates", affiliatesRouter);
app.use("/api/ratings", require("./routes/ratings").default);
app.use("/api/share", shareRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/email", emailRouter);

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

// Expose the socket server so REST routes (e.g. ride car-sim broadcast) can emit
// to ride rooms without a circular import.
(global as any).__vuraIo = io;

// Auto-book scheduled rides when their pickup time approaches (runs every 60s).
startScheduler(io);

// Auto-sync new/updated named places from OpenStreetMap into community_places
// (first import ~15s after boot, then every 6h) so buildings that get named on
// OSM over time automatically become searchable in the app.
startOsmPlaceSync();

// Clean up rides stuck in an "active" state for hours (crash / forgotten demo
// ride) — without this a stuck "driver_arrived" ride surfaces as "Trip in
// progress" on every login.
setTimeout(() => {
  cleanupStaleRides().then((n) => {
    if (n > 0) console.log(`[StaleRides] expired ${n} stale ride(s) on boot`);
  });
}, 5000);
setInterval(() => {
  cleanupStaleRides().catch(() => {});
}, 15 * 60 * 1000);

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
    // Bootstrap: create the core tables if this is a fresh/empty database.
    // (Previously these were pre-created manually; the app now self-heals.)
    try {
      await execute(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          firebase_uid VARCHAR(128) UNIQUE,
          full_name VARCHAR(255),
          email VARCHAR(255),
          phone VARCHAR(50),
          role VARCHAR(20) DEFAULT 'passenger',
          profile_photo_url TEXT,
          id_number VARCHAR(50),
          id_document_name VARCHAR(255),
          license_document_name VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS rides (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          passenger_id UUID REFERENCES users(id),
          driver_id UUID,
          pickup_address TEXT,
          pickup_lat DOUBLE PRECISION,
          pickup_lng DOUBLE PRECISION,
          destination_address TEXT,
          destination_lat DOUBLE PRECISION,
          destination_lng DOUBLE PRECISION,
          waypoints JSONB,
          status VARCHAR(20) DEFAULT 'searching',
          estimated_fare NUMERIC(10,2),
          actual_fare NUMERIC(10,2),
          platform_fee NUMERIC(10,2),
          distance_km NUMERIC(10,2),
          duration_mins NUMERIC(10,2),
          cancelled_by VARCHAR(50),
          cancel_reason TEXT,
          cancelled_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          payment_status VARCHAR(20),
          payment_method VARCHAR(20),
          scheduled_at TIMESTAMPTZ,
          tier VARCHAR(20) DEFAULT 'x',
          announced BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS driver_profiles (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id),
          license_number VARCHAR(50),
          vehicle_make VARCHAR(100),
          vehicle_model VARCHAR(100),
          vehicle_year INTEGER,
          vehicle_color VARCHAR(50),
          license_plate VARCHAR(20),
          is_online BOOLEAN DEFAULT FALSE,
          current_lat DOUBLE PRECISION,
          current_lng DOUBLE PRECISION,
          current_heading DOUBLE PRECISION,
          rating_avg NUMERIC(3,2) DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS driver_earnings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          driver_id UUID NOT NULL REFERENCES users(id),
          ride_id UUID,
          gross_amount NUMERIC(10,2) DEFAULT 0,
          fee NUMERIC(10,2) DEFAULT 0,
          request_fee NUMERIC(10,2) DEFAULT 0,
          net_amount NUMERIC(10,2) DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS payments (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id UUID REFERENCES users(id),
          ride_id UUID REFERENCES rides(id),
          reference VARCHAR(100),
          amount NUMERIC(10,2),
          currency VARCHAR(3) DEFAULT 'ZAR',
          status VARCHAR(20),
          provider VARCHAR(20),
          raw_response JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS saved_cards (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id),
          card_type VARCHAR(20),
          last4 VARCHAR(4),
          bank VARCHAR(100),
          exp_month INTEGER,
          exp_year INTEGER,
          card_number_masked VARCHAR(30),
          transaction_index VARCHAR(100),
          is_default BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
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
      await execute(`
        CREATE TABLE IF NOT EXISTS driver_documents (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          driver_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          doc_type        VARCHAR(40) NOT NULL CHECK (doc_type IN (
                            'drivers_license', 'id_document', 'prdp',
                            'criminal_record', 'license_disk',
                            'carscan_report', 'vehicle_scan'
                          )),
          file_name       VARCHAR(255),
          mime_type       VARCHAR(100),
          s3_key          TEXT NOT NULL,
          s3_bucket       VARCHAR(255),
          size_bytes      INTEGER,
          status          VARCHAR(20) NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN ('pending_review', 'approved', 'rejected')),
          note            TEXT,
          reviewed_at     TIMESTAMPTZ,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`
        CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON driver_documents(driver_id)
      `);
      await execute(`
        CREATE INDEX IF NOT EXISTS idx_driver_documents_type ON driver_documents(doc_type)
      `);
      // Remote device-log sink (debugging). Apps batch POSTs here and the local
      // log viewer polls this — see routes/devLogs.ts.
      await execute(`
        CREATE TABLE IF NOT EXISTS dev_logs (
          id          BIGSERIAL PRIMARY KEY,
          app         VARCHAR(20)  NOT NULL,
          device_id   VARCHAR(120),
          level       VARCHAR(10)  NOT NULL DEFAULT 'info',
          tag         VARCHAR(120),
          message     TEXT,
          data        JSONB,
          created_at  TIMESTAMPTZ  DEFAULT NOW()
        )
      `);
      await execute(`
        CREATE INDEX IF NOT EXISTS idx_dev_logs_id ON dev_logs(id)
      `);
      console.log("✓ Schema bootstrapped");
    } catch (err) {
      console.warn("⚠ Schema bootstrap skipped:", err);
    }

    // One-time migration — runs only at boot, never per request (previously
    // this DDL ran on every /api/users/sync call and slowed down app start).
    try {
      await execute(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS id_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS id_document_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS license_document_name VARCHAR(255)
      `);
      // The bootstrap above is NOT the full production schema: the old database had
      // accumulated columns from earlier migrations, and the code SELECTs them. On a
      // fresh database `GET /api/rides/:id` returned 500 "column r.route_data does not
      // exist" (found 27 Sep 2026, right after the account move) because `route_data`
      // was only ever created lazily by the route-saving handler — and a boot that
      // never saves a route leaves the column missing. Keep the rides columns the code
      // relies on in the boot migration so a brand-new database matches the code.
      await execute(`
        ALTER TABLE rides
        ADD COLUMN IF NOT EXISTS waypoints JSONB,
        ADD COLUMN IF NOT EXISTS route_data JSONB
      `);
      await execute(`
        ALTER TABLE rides
        ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'x',
        ADD COLUMN IF NOT EXISTS announced BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS device_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(10,2) DEFAULT 0
      `);
      // Driver verification status — gates "Go Online" until docs are approved.
      await execute(`
        ALTER TABLE driver_profiles
        ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'pending'
      `);
      // Driver cancellation-rate counter — incremented every time a driver
      // cancels an accepted ride (used for quality control / rematch stats).
      await execute(`
        ALTER TABLE driver_profiles
        ADD COLUMN IF NOT EXISTS cancellations_count INT DEFAULT 0
      `);
      // Backfill: drivers who already uploaded ID/license docs become approved.
      await execute(`
        UPDATE driver_profiles dp
        SET verification_status = 'approved'
        FROM users u
        WHERE dp.user_id = u.id
          AND COALESCE(u.license_document_name, u.id_document_name) IS NOT NULL
          AND dp.verification_status = 'pending'
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
      // ── Dispatch tables ──────────────────────────────────────────────────────
      // Targeted offers: one row per (ride, driver) with a 15s deadline. This is
      // what makes expiry/re-offer/no_drivers possible and what lets the flow
      // resume from the DB after a restart (see services/dispatch.ts).
      await execute(`
        CREATE TABLE IF NOT EXISTS ride_offers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
          driver_id UUID NOT NULL REFERENCES users(id),
          status VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','declined','expired')),
          expires_at TIMESTAMPTZ NOT NULL,
          round INT DEFAULT 1,
          decline_reason VARCHAR(60),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (ride_id, driver_id)
        )
      `);
      await execute(`CREATE INDEX IF NOT EXISTS idx_ride_offers_pending ON ride_offers(status, expires_at)`);
      await execute(`CREATE INDEX IF NOT EXISTS idx_ride_offers_ride ON ride_offers(ride_id)`);
      await execute(`CREATE INDEX IF NOT EXISTS idx_ride_offers_driver ON ride_offers(driver_id)`);
      // Native push tokens (one row per device). The legacy push_tokens table keeps
      // serving the Expo app; this one is FCM for the Capacitor builds.
      await execute(`
        CREATE TABLE IF NOT EXISTS device_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          platform VARCHAR(20),
          push_token TEXT NOT NULL UNIQUE,
          is_active BOOLEAN DEFAULT TRUE,
          last_seen_at TIMESTAMPTZ DEFAULT NOW(),
          invalidated_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id) WHERE is_active`);
      // Every push we attempt, so delivery can be traced per ride.
      await execute(`
        CREATE TABLE IF NOT EXISTS notifications_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID,
          type VARCHAR(40),
          ride_id UUID,
          title VARCHAR(200),
          body TEXT,
          sent_at TIMESTAMPTZ DEFAULT NOW(),
          delivery_status VARCHAR(20),
          error TEXT,
          provider VARCHAR(20)
        )
      `);
      await execute(`CREATE INDEX IF NOT EXISTS idx_notifications_log_user ON notifications_log(user_id, sent_at DESC)`);
      // The dispatch trail: ride_requested -> candidates_found -> offer_sent ->
      // offer_expired/offer_declined -> ride_accepted / no_drivers.
      await execute(`
        CREATE TABLE IF NOT EXISTS ride_events (
          id BIGSERIAL PRIMARY KEY,
          ride_id UUID,
          driver_id UUID,
          event VARCHAR(60) NOT NULL,
          detail JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`CREATE INDEX IF NOT EXISTS idx_ride_events_ride ON ride_events(ride_id, id DESC)`);
      // Dispatch state on the tables that already existed.
      await execute(`
        ALTER TABLE driver_profiles
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'offline',
        ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ
      `);
      // One profile row per driver: the online/offline endpoint upserts with
      // ON CONFLICT (user_id), which needs a unique index — and duplicates would
      // break dispatch (two rows for one driver = two statuses).
      await execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_profiles_user ON driver_profiles(user_id)
      `).catch((err: any) => console.warn("⚠ driver_profiles unique index skipped:", err?.message));
      // CATALOGUE-DERIVED vehicle shape (never typed by the driver) and the snapshot
      // of the car stamped onto the ride at accept time, so trip history keeps
      // showing the car that actually did that trip after the driver changes cars.
      await execute(`
        ALTER TABLE driver_profiles
        ADD COLUMN IF NOT EXISTS body_type VARCHAR(20),
        ADD COLUMN IF NOT EXISTS vehicle_category VARCHAR(20)
      `).catch((err: any) => console.warn("⚠ driver_profiles body_type migration skipped:", err?.message));
      await execute(`
        ALTER TABLE rides
        ADD COLUMN IF NOT EXISTS vehicle_make VARCHAR(100),
        ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(100),
        ADD COLUMN IF NOT EXISTS vehicle_color VARCHAR(50),
        ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20),
        ADD COLUMN IF NOT EXISTS vehicle_body_type VARCHAR(20)
      `).catch((err: any) => console.warn("⚠ rides vehicle snapshot migration skipped:", err?.message));
      await execute(`
        ALTER TABLE rides
        ADD COLUMN IF NOT EXISTS offer_round INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS search_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS no_drivers_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS version INT DEFAULT 0
      `);
      // Backfill so the new status column agrees with the old is_online boolean and
      // with trips already in flight (a driver mid-trip must not look available).
      await execute(`
        UPDATE driver_profiles SET status = 'on_trip'
         WHERE EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = driver_profiles.user_id
                        AND r.status IN ('accepted','driver_arrived','in_progress'))
      `);
      await execute(`
        UPDATE driver_profiles SET status = 'available'
         WHERE is_online = TRUE AND COALESCE(status,'offline') = 'offline'
           AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = driver_profiles.user_id
                            AND r.status IN ('accepted','driver_arrived','in_progress'))
      `);
      console.log("✓ Schema up to date");
    } catch (err) {
      console.warn("⚠ Schema migration skipped:", err);
    }
  }

  // Driver dispatch runs on the DB, not on setTimeout (a restart must not strand
  // a rider waiting for an offer that will never expire).
  startOfferWorker(io);

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
