"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const socket_io_1 = require("socket.io");
const database_1 = require("./config/database");
const firebase_1 = require("./config/firebase");
// ── Import routes ──
const users_1 = __importDefault(require("./routes/users"));
const rides_1 = __importDefault(require("./routes/rides"));
const payments_1 = __importDefault(require("./routes/payments"));
const drivers_1 = __importDefault(require("./routes/drivers"));
const earnings_1 = __importDefault(require("./routes/earnings"));
const safety_1 = __importDefault(require("./routes/safety"));
const search_1 = __importDefault(require("./routes/search"));
const disputes_1 = __importDefault(require("./routes/disputes"));
const splitFare_1 = __importDefault(require("./routes/splitFare"));
const tips_1 = __importDefault(require("./routes/tips"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const affiliates_1 = __importDefault(require("./routes/affiliates"));
const payLater_1 = __importDefault(require("./routes/payLater"));
const route_1 = __importDefault(require("./routes/route"));
const share_1 = __importStar(require("./routes/share"));
const SchedulingService_1 = require("./services/SchedulingService");
// ── Socket handlers ──
const handlers_1 = require("./socket/handlers");
const database_2 = require("./config/database");
// ── Init Express ──
// Trigger reload for ALLOWED_ORIGINS update
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = parseInt(process.env.PORT || "3000", 10);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:8081").split(",");
// ── Middleware ──
// Security headers
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
// CORS
app.use((0, cors_1.default)({
    origin: allowedOrigins,
    credentials: true,
}));
// Body parsing
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
// Logging
app.use((0, morgan_1.default)(process.env.LOG_LEVEL === "debug" ? "dev" : "combined"));
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
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
const routeLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.ROUTE_RATE_LIMIT_MAX || "300", 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many route requests, please try again later" },
});
app.use("/api/route", routeLimiter, route_1.default);
// Health check
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});
// Root endpoint for load balancer health checks
app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "vura-rider-backend" });
});
// ── Routes ──
app.use("/api/users", users_1.default);
app.use("/api/rides", rides_1.default);
app.use("/api/payments", payments_1.default);
app.use("/api/payments/pay-later", payLater_1.default);
app.use("/api/drivers", drivers_1.default);
app.use("/api/earnings", earnings_1.default);
app.use("/api/safety", safety_1.default);
app.use("/api/searches", search_1.default);
app.use("/api/disputes", disputes_1.default);
app.use("/api/split", splitFare_1.default);
app.use("/api/tips", tips_1.default);
app.use("/api/notifications", notifications_1.default);
app.use("/api/affiliates", affiliates_1.default);
app.use("/api/ratings", require("./routes/ratings").default);
app.use("/api/share", share_1.default);
// ── Public share tracking page ──
app.get("/share/:token", share_1.sharePage);
// ── Socket.IO ──
const io = new socket_io_1.Server(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true,
    },
    transports: ["websocket", "polling"],
});
exports.io = io;
(0, handlers_1.setupSocketHandlers)(io);
// Auto-book scheduled rides when their pickup time approaches (runs every 60s).
(0, SchedulingService_1.startScheduler)(io);
// ── 404 handler ──
app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
});
// ── Global error handler ──
app.use((err, _req, res, _next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
});
// ── Start server ──
async function start() {
    console.log("╔═══════════════════════════════════════╗");
    console.log("║       Vura Rider Backend Server       ║");
    console.log("╚═══════════════════════════════════════╝");
    // 1. Test database connection
    const dbConnected = await (0, database_1.testConnection)();
    if (!dbConnected) {
        console.warn("⚠ DB connection failed — server will still start but DB features won't work");
    }
    else {
        // Bootstrap: create the core tables if this is a fresh/empty database.
        // (Previously these were pre-created manually; the app now self-heals.)
        try {
            await (0, database_2.execute)(`
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
            await (0, database_2.execute)(`
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
            await (0, database_2.execute)(`
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
            await (0, database_2.execute)(`
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
            await (0, database_2.execute)(`
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
            await (0, database_2.execute)(`
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
            await (0, database_2.execute)(`
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
            console.log("✓ Schema bootstrapped");
        }
        catch (err) {
            console.warn("⚠ Schema bootstrap skipped:", err);
        }
        // One-time migration — runs only at boot, never per request (previously
        // this DDL ran on every /api/users/sync call and slowed down app start).
        try {
            await (0, database_2.execute)(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS id_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS id_document_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS license_document_name VARCHAR(255)
      `);
            await (0, database_2.execute)(`
        ALTER TABLE rides
        ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'x',
        ADD COLUMN IF NOT EXISTS announced BOOLEAN DEFAULT FALSE
      `);
            await (0, database_2.execute)(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          ride_id UUID NOT NULL,
          sender_id UUID NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
            console.log("✓ Schema up to date");
        }
        catch (err) {
            console.warn("⚠ Schema migration skipped:", err);
        }
    }
    // 2. Init Firebase Admin
    try {
        (0, firebase_1.getFirebaseApp)();
    }
    catch (err) {
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
//# sourceMappingURL=index.js.map